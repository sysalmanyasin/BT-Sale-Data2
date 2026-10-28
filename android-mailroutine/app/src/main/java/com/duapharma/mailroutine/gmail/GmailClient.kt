package com.duapharma.mailroutine.gmail

import com.duapharma.mailroutine.domain.SendFailure
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Duration

/** Outcome of handing a message to Gmail. "Submitted" is NOT confirmed recipient delivery. */
sealed interface GmailResult {
    data class Submitted(val messageId: String, val threadId: String?) : GmailResult
    data class Failed(val failure: SendFailure) : GmailResult
}

interface GmailSender {
    suspend fun send(accessToken: String, rawMime: ByteArray): GmailResult
}

data class HttpResult(val status: Int, val body: String, val headers: Map<String, String> = emptyMap())

/** [requestMayHaveReachedServer] is false only when we failed before/while connecting. */
class TransportException(val requestMayHaveReachedServer: Boolean, cause: Throwable?) : Exception(cause?.javaClass?.simpleName)

fun interface HttpTransport {
    @Throws(TransportException::class)
    fun post(url: String, headers: Map<String, String>, body: ByteArray): HttpResult
}

class GmailHttpSender(
    private val transport: HttpTransport = UrlConnectionTransport(),
    private val baseUrl: String = "https://gmail.googleapis.com",
) : GmailSender {

    override suspend fun send(accessToken: String, rawMime: ByteArray): GmailResult = withContext(Dispatchers.IO) {
        val res = try {
            transport.post(
                "$baseUrl/upload/gmail/v1/users/me/messages/send?uploadType=media",
                mapOf("Authorization" to "Bearer $accessToken", "Content-Type" to "message/rfc822"),
                rawMime,
            )
        } catch (e: TransportException) {
            return@withContext GmailResult.Failed(
                if (e.requestMayHaveReachedServer) SendFailure.Ambiguous("IO_AFTER_SEND") else SendFailure.NotSentNetwork,
            )
        }
        classify(res)
    }

    companion object {
        /** Exposed for tests: maps an HTTP response to a result without any network. */
        fun classify(res: HttpResult): GmailResult {
            val s = res.status
            return when {
                s in 200..299 -> parseSuccess(res.body)
                s == 401 -> GmailResult.Failed(SendFailure.Auth("TOKEN_REJECTED"))
                s == 403 -> {
                    val reason = errorReason(res.body)
                    if (reason == "rateLimitExceeded" || reason == "userRateLimitExceeded")
                        GmailResult.Failed(SendFailure.RateLimited(retryAfter(res)))
                    else GmailResult.Failed(SendFailure.Auth("FORBIDDEN"))
                }
                s == 429 -> GmailResult.Failed(SendFailure.RateLimited(retryAfter(res)))
                s == 413 -> GmailResult.Failed(SendFailure.Rejected("TOO_LARGE"))
                s in 400..499 -> GmailResult.Failed(SendFailure.Rejected("HTTP_$s"))
                // 5xx: Gmail may have accepted the message before failing -> never auto-resend.
                else -> GmailResult.Failed(SendFailure.Ambiguous("HTTP_$s"))
            }
        }

        private fun parseSuccess(body: String): GmailResult = try {
            val j = JSONObject(body)
            val id = j.optString("id", "")
            if (id.isBlank()) GmailResult.Failed(SendFailure.Ambiguous("BAD_RESPONSE"))
            else GmailResult.Submitted(id, j.optString("threadId", "").ifBlank { null })
        } catch (e: Exception) {
            GmailResult.Failed(SendFailure.Ambiguous("BAD_RESPONSE"))
        }

        private fun errorReason(body: String): String? = try {
            val e = JSONObject(body).optJSONObject("error")
            e?.optJSONArray("errors")?.optJSONObject(0)?.optString("reason")?.ifBlank { null }
        } catch (ex: Exception) { null }

        private fun retryAfter(res: HttpResult): Duration? =
            res.headers.entries.firstOrNull { it.key.equals("Retry-After", true) }?.value?.trim()?.toLongOrNull()
                ?.takeIf { it in 1..86_400 }?.let(Duration::ofSeconds)
    }
}

/** Plain HttpURLConnection transport; never logs URLs, headers or bodies. */
class UrlConnectionTransport(
    private val connectTimeoutMs: Int = 20_000,
    private val readTimeoutMs: Int = 60_000,
) : HttpTransport {
    override fun post(url: String, headers: Map<String, String>, body: ByteArray): HttpResult {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = connectTimeoutMs
            conn.readTimeout = readTimeoutMs
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(body.size)
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            try { conn.connect() } catch (e: IOException) { throw TransportException(false, e) }
            try {
                conn.outputStream.use { it.write(body) }
                val status = conn.responseCode
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
                val hdrs = conn.headerFields.filterKeys { it != null }.mapValues { it.value.firstOrNull().orEmpty() }
                return HttpResult(status, text, hdrs)
            } catch (e: IOException) {
                throw TransportException(true, e)
            }
        } finally {
            conn.disconnect()
        }
    }
}
