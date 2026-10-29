package com.duapharma.mailroutine.ai

import com.duapharma.mailroutine.domain.FieldValidator
import com.duapharma.mailroutine.domain.Limits
import com.duapharma.mailroutine.domain.Placeholders
import com.duapharma.mailroutine.gmail.HttpTransport
import org.json.JSONObject

data class AiDraft(val subject: String, val body: String)

sealed interface AiResult {
    data class Success(val draft: AiDraft) : AiResult
    data object NotConfigured : AiResult
    data class Error(val message: String) : AiResult
}

/** Text typed into one field of a single email (as opposed to the reusable template). */
data class AiTextRequest(
    val instruction: String,
    /** What is in the field now; may be empty when the model should write it from the instruction alone. */
    val text: String,
    val fieldLabel: String,
    val singleLine: Boolean,
    val maxLength: Int,
)

sealed interface AiTextResult {
    data class Success(val text: String) : AiTextResult
    data object NotConfigured : AiTextResult
    data class Error(val message: String) : AiTextResult
}

interface AiDrafter {
    val isConfigured: Boolean
    /** Returns a *proposal*. Nothing is saved or applied by this call. */
    suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>): AiResult
    /** Writes or rewrites the text of one field. Also only a proposal. */
    suspend fun writeText(request: AiTextRequest): AiTextResult
}

/** Prompt construction and strict response parsing; pure so it can be unit tested. */
object AiDraftParser {
    const val DRAFT_MAX_TOKENS = 2048

    fun systemPrompt(fieldKeys: Set<String>): String {
        val allowed = (fieldKeys + FieldValidator.BUILT_IN_KEYS).sorted().joinToString(", ") { "{{$it}}" }
        return "You draft reusable work-email templates. Reply with ONLY a JSON object {\"subject\": string, \"body\": string}. " +
            "The subject must be one line. Use only these placeholders for variable content: $allowed. " +
            "Never invent recipients, names, figures or other personal data; use placeholders instead. Plain text only. " +
            "Write in the language of the instruction or of the current text. " +
            "When a current subject or body is given, edit it as instructed instead of starting over, and return any part you were not asked to change exactly as it was."
    }

    fun userPrompt(instruction: String, subject: String, body: String): String =
        "Instruction: ${instruction.take(1000)}\n\nCurrent subject: ${subject.take(Limits.MAX_SUBJECT)}\nCurrent body:\n${body.take(5000)}"

    fun parse(text: String, fieldKeys: Set<String>): Result<AiDraft> = runCatching {
        val start = text.indexOf('{'); val end = text.lastIndexOf('}')
        require(start in 0 until end) { "The assistant did not return a draft" }
        val j = JSONObject(text.substring(start, end + 1))
        val subject = j.optString("subject", "").replace(Regex("[\\r\\n]+"), " ").trim()
        val body = j.optString("body", "").replace("\r\n", "\n").trim()
        require(subject.isNotEmpty()) { "Draft has no subject" }
        require(subject.length <= Limits.MAX_SUBJECT && body.length <= Limits.MAX_BODY) { "Draft is too long" }
        val known = fieldKeys + FieldValidator.BUILT_IN_KEYS
        val unknown = (Placeholders.keysIn(subject) + Placeholders.keysIn(body)).filter { it !in known }.toSet()
        require(unknown.isEmpty()) { "Draft uses unknown placeholders: ${unknown.joinToString { "{{$it}}" }}" }
        AiDraft(subject, body)
    }

    // ---- single-field text ----

    fun textSystemPrompt(singleLine: Boolean, maxLength: Int): String =
        "You help someone write work emails. You receive the text of ONE field of an email and an instruction. " +
            "Return ONLY the resulting text for that field: no quotation marks around it, no markdown, no explanation, " +
            "and no greeting or sign-off unless the text already has one. " +
            "Keep every name, number, date and amount exactly as given and never invent new ones. " +
            "Write in the same language as the text unless the instruction asks for another language. " +
            (if (singleLine) "The result must be a single line. " else "Plain text; separate paragraphs with a blank line. ") +
            "Keep it under $maxLength characters."

    fun textUserPrompt(r: AiTextRequest): String =
        "Field: ${r.fieldLabel.take(80)}\nInstruction: ${r.instruction.take(1000)}\n\n" +
            "Text:\n" + (r.text.take(5000).ifBlank { "(empty - write it from the instruction)" })

    /** Cleans what a model typically wraps around an answer and enforces the field's limits. */
    fun parseText(raw: String, singleLine: Boolean, maxLength: Int): Result<String> = runCatching {
        var t = raw.replace("\r\n", "\n").replace('\r', '\n').trim()
        if (t.startsWith("```")) t = t.removePrefix("```").substringAfter('\n', "").removeSuffix("```").trim()
        if (t.length >= 2 && QUOTE_PAIRS.any { (a, b) -> t.first() == a && t.last() == b } && t.count { it == '"' || it == '“' || it == '”' } == 2) {
            t = t.substring(1, t.length - 1).trim()
        }
        t = t.filter { !it.isISOControl() || it == '\n' || it == '\t' }
        if (singleLine) t = t.replace(Regex("\\s*\\n+\\s*"), " ").trim()
        require(t.isNotEmpty()) { "The assistant did not return any text" }
        require(t.length <= maxLength) { "The result is longer than this field allows ($maxLength characters). Ask for a shorter version." }
        t
    }

    private val QUOTE_PAIRS = listOf('"' to '"', '“' to '”')
}

/** Drafting and field-writing on top of any [ChatClient]; this is the only place prompts meet providers. */
class LlmDrafter(private val chat: ChatClient) : AiDrafter {
    override val isConfigured: Boolean get() = chat.isConfigured

    override suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>): AiResult {
        if (!chat.isConfigured) return AiResult.NotConfigured
        if (instruction.isBlank()) return AiResult.Error("Describe what the email should say")
        val reply = chat.complete(
            AiDraftParser.systemPrompt(fieldKeys),
            AiDraftParser.userPrompt(instruction, currentSubject, currentBody),
            AiDraftParser.DRAFT_MAX_TOKENS, json = true,
        )
        return when (reply) {
            ChatReply.NotConfigured -> AiResult.NotConfigured
            is ChatReply.Error -> AiResult.Error(reply.message)
            is ChatReply.Text -> AiDraftParser.parse(reply.text, fieldKeys).fold({ AiResult.Success(it) }, { AiResult.Error(it.message ?: "Invalid draft") })
        }
    }

    override suspend fun writeText(request: AiTextRequest): AiTextResult {
        if (!chat.isConfigured) return AiTextResult.NotConfigured
        if (request.instruction.isBlank()) return AiTextResult.Error("Tell the AI what to do with this text")
        val reply = chat.complete(
            AiDraftParser.textSystemPrompt(request.singleLine, request.maxLength),
            AiDraftParser.textUserPrompt(request),
            (request.maxLength / 2).coerceIn(512, 4096), json = false,
        )
        return when (reply) {
            ChatReply.NotConfigured -> AiTextResult.NotConfigured
            is ChatReply.Error -> AiTextResult.Error(reply.message)
            is ChatReply.Text -> AiDraftParser.parseText(reply.text, request.singleLine, request.maxLength)
                .fold({ AiTextResult.Success(it) }, { AiTextResult.Error(it.message ?: "Invalid text") })
        }
    }
}

class AnthropicDrafter(
    transport: HttpTransport,
    apiKey: () -> String?,
    model: () -> String,
) : AiDrafter by LlmDrafter(AnthropicChat(transport, apiKey, model))

class GroqDrafter(
    transport: HttpTransport,
    apiKey: () -> String?,
    model: () -> String,
) : AiDrafter by LlmDrafter(GroqChat(transport, apiKey, model))

/** Sends each call to whichever provider is selected right now, so a settings change applies immediately. */
class ProviderDrafter(
    private val drafters: Map<AiProvider, AiDrafter>,
    private val active: () -> AiProvider,
) : AiDrafter {
    private val current: AiDrafter get() = drafters.getValue(active())
    override val isConfigured: Boolean get() = current.isConfigured
    override suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>) =
        current.draft(instruction, currentSubject, currentBody, fieldKeys)
    override suspend fun writeText(request: AiTextRequest) = current.writeText(request)
}
