package com.duapharma.mailroutine.ai

import com.duapharma.mailroutine.gmail.HttpResult
import com.duapharma.mailroutine.gmail.HttpTransport
import com.duapharma.mailroutine.gmail.TransportException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

sealed interface ChatReply {
    data class Text(val text: String) : ChatReply
    data object NotConfigured : ChatReply
    data class Error(val message: String) : ChatReply
}

/** One system+user exchange with a hosted model. Everything provider-specific lives behind this. */
interface ChatClient {
    val isConfigured: Boolean
    /** [json] asks the provider for a JSON object when it supports that; callers must still parse defensively. */
    suspend fun complete(system: String, user: String, maxTokens: Int, json: Boolean): ChatReply
}

/** User-facing messages for HTTP failures. Never includes the key, the request or the response body. */
object ChatErrors {
    const val KEY_REJECTED = "The AI key was rejected. Check it in Settings."
    const val UNREACHABLE = "Could not reach the AI service"
    const val UNEXPECTED = "Unexpected response from the AI service"
    const val EMPTY = "The AI returned no text. Try again or pick another model in Settings."

    fun forStatus(status: Int): String = when (status) {
        401, 403 -> KEY_REJECTED
        404 -> "The AI service doesn't know that model. Pick one from the list in Settings."
        429 -> "The AI service is busy or your rate limit was reached. Wait a minute and try again."
        else -> "The AI service returned an error ($status)"
    }
}

class AnthropicChat(
    private val transport: HttpTransport,
    private val apiKey: () -> String?,
    private val model: () -> String,
) : ChatClient {
    override val isConfigured: Boolean get() = !apiKey().isNullOrBlank()

    override suspend fun complete(system: String, user: String, maxTokens: Int, json: Boolean): ChatReply {
        val key = apiKey()?.takeIf { it.isNotBlank() } ?: return ChatReply.NotConfigured
        val body = JSONObject()
            .put("model", model())
            .put("max_tokens", maxTokens)
            .put("system", system)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", user)))
            .toString().toByteArray(Charsets.UTF_8)
        val res = try {
            withContext(Dispatchers.IO) {
                transport.post(
                    "https://api.anthropic.com/v1/messages",
                    mapOf("x-api-key" to key, "anthropic-version" to "2023-06-01", "content-type" to "application/json"),
                    body,
                )
            }
        } catch (e: TransportException) {
            return ChatReply.Error(ChatErrors.UNREACHABLE)
        }
        if (res.status !in 200..299) return ChatReply.Error(ChatErrors.forStatus(res.status))
        val text = try {
            val content = JSONObject(res.body).getJSONArray("content")
            (0 until content.length()).map { content.getJSONObject(it) }.filter { it.optString("type") == "text" }.joinToString("") { it.optString("text") }
        } catch (e: Exception) { return ChatReply.Error(ChatErrors.UNEXPECTED) }
        return ChatReply.Text(text)
    }
}

/** Groq speaks the OpenAI chat-completions dialect. https://console.groq.com/docs/api-reference#chat */
class GroqChat(
    private val transport: HttpTransport,
    private val apiKey: () -> String?,
    private val model: () -> String,
    private val baseUrl: String = "https://api.groq.com/openai/v1",
) : ChatClient {
    override val isConfigured: Boolean get() = !apiKey().isNullOrBlank()

    override suspend fun complete(system: String, user: String, maxTokens: Int, json: Boolean): ChatReply {
        val key = apiKey()?.takeIf { it.isNotBlank() } ?: return ChatReply.NotConfigured
        fun request(jsonMode: Boolean): ByteArray = JSONObject()
            .put("model", model())
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "system").put("content", system))
                .put(JSONObject().put("role", "user").put("content", user)))
            .put("max_completion_tokens", maxTokens)
            .put("temperature", 0.4) // rewriting should stay close to the input
            // gpt-oss models reason before answering and that counts against the token limit; keep it short for rewriting.
            .apply { if (model().startsWith("openai/gpt-oss")) put("reasoning_effort", "low") }
            .apply { if (jsonMode) put("response_format", JSONObject().put("type", "json_object")) }
            .toString().toByteArray(Charsets.UTF_8)

        suspend fun post(body: ByteArray): HttpResult? = try {
            withContext(Dispatchers.IO) {
                transport.post(
                    "$baseUrl/chat/completions",
                    mapOf("Authorization" to "Bearer $key", "Content-Type" to "application/json", "Accept" to "application/json", "User-Agent" to "MailRoutine-Android"),
                    body,
                )
            }
        } catch (e: TransportException) { null }

        var res = post(request(json)) ?: return ChatReply.Error(ChatErrors.UNREACHABLE)
        // Not every model accepts JSON mode, and JSON mode rejects a reply that is not valid JSON. The parser copes
        // with plain replies, so one retry without it is better than failing.
        if (json && res.status == 400) res = post(request(false)) ?: return ChatReply.Error(ChatErrors.UNREACHABLE)
        if (res.status !in 200..299) return ChatReply.Error(ChatErrors.forStatus(res.status))
        val text = try {
            val message = JSONObject(res.body).getJSONArray("choices").getJSONObject(0).getJSONObject("message")
            if (message.isNull("content")) "" else message.getString("content")
        } catch (e: Exception) { return ChatReply.Error(ChatErrors.UNEXPECTED) }
        if (text.isBlank()) return ChatReply.Error(ChatErrors.EMPTY)
        return ChatReply.Text(text)
    }
}
