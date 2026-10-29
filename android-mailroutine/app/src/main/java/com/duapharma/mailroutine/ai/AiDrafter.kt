package com.duapharma.mailroutine.ai

import com.duapharma.mailroutine.domain.FieldValidator
import com.duapharma.mailroutine.domain.Limits
import com.duapharma.mailroutine.domain.Placeholders
import com.duapharma.mailroutine.gmail.HttpTransport
import com.duapharma.mailroutine.gmail.TransportException
import org.json.JSONArray
import org.json.JSONObject

enum class AiProvider(
    val displayName: String,
    val defaultModel: String,
    internal val keyPreference: String,
    internal val modelPreference: String,
) {
    GROQ("Groq (free tier)", "openai/gpt-oss-20b", "groq_api_key", "groq_model"),
    ANTHROPIC("Anthropic", "claude-sonnet-5-5", "anthropic_api_key", "anthropic_model"),
}

data class AiDraft(val subject: String, val body: String)

sealed interface AiResult {
    data class Success(val draft: AiDraft) : AiResult
    data object NotConfigured : AiResult
    data class Error(val message: String) : AiResult
}

interface AiDrafter {
    val isConfigured: Boolean
    /** Returns a proposal. Nothing is saved or applied by this call. */
    suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>): AiResult
}

/** Prompt construction and strict response parsing; pure so it can be unit tested. */
object AiDraftParser {
    fun systemPrompt(fieldKeys: Set<String>): String {
        val allowed = (fieldKeys + FieldValidator.BUILT_IN_KEYS).sorted().joinToString(", ") { "{{$it}}" }
        return "You draft reusable work-email templates. Reply with ONLY a JSON object {\"subject\": string, \"body\": string}. " +
            "The subject must be one line. Use only these placeholders for variable content: $allowed. " +
            "Never invent recipients, names, figures or other personal data; use placeholders instead. Plain text only."
    }

    fun userPrompt(instruction: String, subject: String, body: String): String =
        "Instruction: ${instruction.take(1000)}\n\nCurrent subject: ${subject.take(Limits.MAX_SUBJECT)}\nCurrent body:\n${body.take(5000)}"

    fun parse(text: String, fieldKeys: Set<String>): Result<AiDraft> = runCatching {
        val start = text.indexOf('{'); val end = text.lastIndexOf('}')
        require(start in 0 until end) { "The assistant did not return a draft" }
        val j = JSONObject(text.substring(start, end + 1))
        val subject = j.optString("subject", "").replace(Regex("[\\r\\n]+"), " ").trim()
        val body = j.optString("body", "").replace("\\r\\n", "\\n").trim()
        require(subject.isNotEmpty()) { "Draft has no subject" }
        require(subject.length <= Limits.MAX_SUBJECT && body.length <= Limits.MAX_BODY) { "Draft is too long" }
        val known = fieldKeys + FieldValidator.BUILT_IN_KEYS
        val unknown = (Placeholders.keysIn(subject) + Placeholders.keysIn(body)).filter { it !in known }.toSet()
        require(unknown.isEmpty()) { "Draft uses unknown placeholders: ${unknown.joinToString { "{{$it}}" }}" }
        AiDraft(subject, body)
    }
}

private fun safeError(resStatus: Int): String = when (resStatus) {
    401, 403 -> "The AI key was rejected or lacks permission. Check it in Settings."
    429 -> "The AI service rate limit was reached. Wait a little or try another model/provider."
    else -> "The AI service returned an error ($resStatus)"
}

class AnthropicDrafter(
    private val transport: HttpTransport,
    private val apiKey: () -> String?,
    private val model: () -> String,
) : AiDrafter {
    override val isConfigured: Boolean get() = !apiKey().isNullOrBlank()

    override suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>): AiResult {
        val key = apiKey()?.takeIf { it.isNotBlank() } ?: return AiResult.NotConfigured
        if (instruction.isBlank()) return AiResult.Error("Describe what the email should say")
        val body = JSONObject()
            .put("model", model())
            .put("max_tokens", 1024)
            .put("system", AiDraftParser.systemPrompt(fieldKeys))
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", AiDraftParser.userPrompt(instruction, currentSubject, currentBody))))
            .toString().toByteArray(Charsets.UTF_8)
        val res = try {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                transport.post(
                    "https://api.anthropic.com/v1/messages",
                    mapOf("x-api-key" to key, "anthropic-version" to "2023-06-01", "content-type" to "application/json"),
                    body,
                )
            }
        } catch (e: TransportException) {
            return AiResult.Error("Could not reach the AI service")
        }
        if (res.status !in 200..299) return AiResult.Error(safeError(res.status))
        val text = try {
            val content = JSONObject(res.body).getJSONArray("content")
            (0 until content.length()).map { content.getJSONObject(it) }
                .filter { it.optString("type") == "text" }.joinToString("") { it.optString("text") }
        } catch (e: Exception) { return AiResult.Error("Unexpected response from the AI service") }
        return AiDraftParser.parse(text, fieldKeys).fold({ AiResult.Success(it) }, { AiResult.Error(it.message ?: "Invalid draft") })
    }
}

/** Groq's OpenAI-compatible chat completions API. Use a production model, not a preview model. */
class GroqDrafter(
    private val transport: HttpTransport,
    private val apiKey: () -> String?,
    private val model: () -> String,
) : AiDrafter {
    override val isConfigured: Boolean get() = !apiKey().isNullOrBlank()

    override suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>): AiResult {
        val key = apiKey()?.takeIf { it.isNotBlank() } ?: return AiResult.NotConfigured
        if (instruction.isBlank()) return AiResult.Error("Describe what the email should say")
        val messages = JSONArray()
            .put(JSONObject().put("role", "system").put("content", AiDraftParser.systemPrompt(fieldKeys)))
            .put(JSONObject().put("role", "user").put("content", AiDraftParser.userPrompt(instruction, currentSubject, currentBody)))
        val body = JSONObject()
            .put("model", model().trim().ifBlank { AiProvider.GROQ.defaultModel })
            .put("max_completion_tokens", 1024)
            .put("messages", messages)
            .toString().toByteArray(Charsets.UTF_8)
        val res = try {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                transport.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    mapOf("Authorization" to "Bearer $key", "content-type" to "application/json"),
                    body,
                )
            }
        } catch (e: TransportException) {
            return AiResult.Error("Could not reach Groq. Check your connection and API key.")
        }
        if (res.status !in 200..299) return AiResult.Error(safeError(res.status))
        val text = try {
            JSONObject(res.body).getJSONArray("choices").getJSONObject(0)
                .getJSONObject("message").optString("content")
        } catch (e: Exception) { return AiResult.Error("Unexpected response from Groq") }
        return AiDraftParser.parse(text, fieldKeys).fold({ AiResult.Success(it) }, { AiResult.Error(it.message ?: "Invalid draft") })
    }
}

/** Selects the configured provider without ever sending data to both providers. */
class ProviderAiDrafter(
    private val provider: () -> AiProvider,
    private val groq: AiDrafter,
    private val anthropic: AiDrafter,
) : AiDrafter {
    private fun active(): AiDrafter = when (provider()) {
        AiProvider.GROQ -> groq
        AiProvider.ANTHROPIC -> anthropic
    }
    override val isConfigured: Boolean get() = active().isConfigured
    override suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>) =
        active().draft(instruction, currentSubject, currentBody, fieldKeys)
}
