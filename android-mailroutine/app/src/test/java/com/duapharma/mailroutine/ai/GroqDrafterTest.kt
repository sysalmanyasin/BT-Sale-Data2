package com.duapharma.mailroutine.ai

import com.duapharma.mailroutine.gmail.HttpResult
import com.duapharma.mailroutine.gmail.HttpTransport
import com.duapharma.mailroutine.gmail.TransportException
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GroqDrafterTest {
    private val keys = setOf("amount")
    private fun groqReply(content: String?, status: Int = 200) = HttpResult(
        status,
        JSONObject().put("choices", JSONArray().put(JSONObject().put("message", JSONObject().put("role", "assistant").put("content", content ?: JSONObject.NULL)))).toString(),
    )
    private fun drafter(transport: HttpTransport, key: String? = "gsk_secret", model: String = "llama-3.3-70b-versatile") =
        GroqDrafter(transport, { key }, { model })

    private data class Call(val url: String, val headers: Map<String, String>, val body: JSONObject)
    private class Recorder(private vararg val replies: HttpResult) : HttpTransport {
        val calls = mutableListOf<Call>()
        override fun post(url: String, headers: Map<String, String>, body: ByteArray): HttpResult {
            calls += Call(url, headers, JSONObject(String(body)))
            return replies[minOf(calls.size - 1, replies.size - 1)]
        }
    }

    // ---- configuration ----

    @Test fun neverCallsTheNetworkWithoutAKey() = runBlocking {
        val rec = Recorder(groqReply("{}"))
        val d = drafter(rec, key = null)
        assertFalse(d.isConfigured)
        assertEquals(AiResult.NotConfigured, d.draft("x", "", "", keys))
        assertEquals(AiTextResult.NotConfigured, d.writeText(AiTextRequest("x", "t", "Note", true, 100)))
        assertTrue(rec.calls.isEmpty())
    }

    @Test fun blankKeyCountsAsNotConfigured() {
        assertFalse(drafter(Recorder(), key = "   ").isConfigured)
    }

    @Test fun blankInstructionIsRejectedBeforeAnyRequest() = runBlocking {
        val rec = Recorder(groqReply("{}"))
        assertTrue(drafter(rec).draft("  ", "S", "B", keys) is AiResult.Error)
        assertTrue(drafter(rec).writeText(AiTextRequest(" ", "t", "Note", true, 100)) is AiTextResult.Error)
        assertTrue(rec.calls.isEmpty())
    }

    // ---- request shape ----

    @Test fun draftRequestUsesGroqEndpointBearerAuthAndJsonMode() = runBlocking {
        val rec = Recorder(groqReply("""{"subject":"Report {{date}}","body":"Total {{amount}}"}"""))
        val r = drafter(rec).draft("weekly report", "Old subject", "Old body", keys) as AiResult.Success
        assertEquals("Report {{date}}", r.draft.subject)
        val c = rec.calls.single()
        assertEquals("https://api.groq.com/openai/v1/chat/completions", c.url)
        assertEquals("Bearer gsk_secret", c.headers["Authorization"])
        assertEquals("application/json", c.headers["Content-Type"])
        assertEquals("llama-3.3-70b-versatile", c.body.getString("model"))
        assertEquals("json_object", c.body.getJSONObject("response_format").getString("type"))
        assertTrue(c.body.has("max_completion_tokens"))
        assertFalse("max_tokens is deprecated on Groq", c.body.has("max_tokens"))
        val msgs = c.body.getJSONArray("messages")
        assertEquals("system", msgs.getJSONObject(0).getString("role"))
        assertEquals("user", msgs.getJSONObject(1).getString("role"))
        assertTrue(msgs.getJSONObject(0).getString("content").contains("{{amount}}"))
        assertTrue(msgs.getJSONObject(1).getString("content").contains("Old body"))
        assertFalse("the key must never travel in the body", c.body.toString().contains("gsk_secret"))
    }

    @Test fun chosenModelIsSent() = runBlocking {
        val rec = Recorder(groqReply("""{"subject":"s","body":"b"}"""))
        drafter(rec, model = "openai/gpt-oss-20b").draft("x", "", "", keys)
        assertEquals("openai/gpt-oss-20b", rec.calls.single().body.getString("model"))
    }

    @Test fun fieldRequestDoesNotUseJsonMode() = runBlocking {
        val rec = Recorder(groqReply("Hello team"))
        drafter(rec).writeText(AiTextRequest("fix grammar", "helo team", "Greeting", true, 200))
        assertFalse(rec.calls.single().body.has("response_format"))
    }

    // ---- reply parsing ----

    @Test fun toleratesProseAndCodeFencesAroundTheJson() = runBlocking {
        val rec = Recorder(groqReply("Sure! Here you go:\n```json\n{\"subject\":\"Hi\",\"body\":\"Total {{amount}}\"}\n```"))
        val r = drafter(rec).draft("x", "", "", keys) as AiResult.Success
        assertEquals("Hi", r.draft.subject)
    }

    @Test fun draftsWithUnknownPlaceholdersAreRejected() = runBlocking {
        val rec = Recorder(groqReply("""{"subject":"s","body":"{{ssn}}"}"""))
        assertTrue(drafter(rec).draft("x", "", "", keys) is AiResult.Error)
    }

    @Test fun nullOrBlankContentIsAFriendlyError() = runBlocking {
        for (content in listOf<String?>(null, "", "   ")) {
            val r = drafter(Recorder(groqReply(content))).draft("x", "", "", keys) as AiResult.Error
            assertEquals(ChatErrors.EMPTY, r.message)
        }
    }

    @Test fun malformedResponseBodyIsReportedWithoutLeakingIt() = runBlocking {
        val r = drafter(Recorder(HttpResult(200, "<html>oops secret-looking text</html>"))).draft("x", "", "", keys) as AiResult.Error
        assertEquals(ChatErrors.UNEXPECTED, r.message)
        assertEquals(ChatErrors.UNEXPECTED, (drafter(Recorder(HttpResult(200, """{"choices":[]}"""))).draft("x", "", "", keys) as AiResult.Error).message)
    }

    // ---- JSON-mode retry ----

    @Test fun retriesOnceWithoutJsonModeWhenGroqReturns400() = runBlocking {
        val rec = Recorder(HttpResult(400, """{"error":{"code":"json_validate_failed"}}"""), groqReply("""{"subject":"s","body":"b"}"""))
        val r = drafter(rec).draft("x", "", "", keys)
        assertTrue(r is AiResult.Success)
        assertEquals(2, rec.calls.size)
        assertTrue(rec.calls[0].body.has("response_format"))
        assertFalse(rec.calls[1].body.has("response_format"))
    }

    @Test fun doesNotRetryMoreThanOnceAndNeverForOtherStatuses() = runBlocking {
        val always400 = Recorder(HttpResult(400, ""))
        assertTrue(drafter(always400).draft("x", "", "", keys) is AiResult.Error)
        assertEquals(2, always400.calls.size)
        val always500 = Recorder(HttpResult(500, ""))
        drafter(always500).draft("x", "", "", keys)
        assertEquals(1, always500.calls.size)
        val fieldAlways400 = Recorder(HttpResult(400, ""))
        drafter(fieldAlways400).writeText(AiTextRequest("x", "t", "Note", true, 100))
        assertEquals("a request that never used JSON mode has nothing to fall back from", 1, fieldAlways400.calls.size)
    }

    // ---- errors ----

    @Test fun statusCodesMapToFriendlyMessagesWithoutLeakingTheKey() {
        fun msg(status: Int) = runBlocking { (drafter(Recorder(HttpResult(status, """{"error":"gsk_secret"}"""))).draft("x", "", "", keys) as AiResult.Error).message }
        assertEquals(ChatErrors.KEY_REJECTED, msg(401))
        assertEquals(ChatErrors.KEY_REJECTED, msg(403))
        assertTrue(msg(404).contains("model"))
        assertTrue(msg(429).contains("rate limit"))
        assertEquals("The AI service returned an error (503)", msg(503))
        listOf(401, 403, 404, 429, 503).forEach { assertFalse(msg(it).contains("gsk_secret")) }
    }

    @Test fun networkFailureIsReportedAsUnreachable() = runBlocking {
        val offline = HttpTransport { _, _, _ -> throw TransportException(false, null) }
        assertEquals(ChatErrors.UNREACHABLE, (drafter(offline).draft("x", "", "", keys) as AiResult.Error).message)
        assertEquals(ChatErrors.UNREACHABLE, (drafter(offline).writeText(AiTextRequest("x", "t", "Note", true, 100)) as AiTextResult.Error).message)
    }

    // ---- field text ----

    private fun field(rec: Recorder, instruction: String = "improve", text: String = "helo", singleLine: Boolean = true, max: Int = 200) =
        runBlocking { drafter(rec).writeText(AiTextRequest(instruction, text, "Status note", singleLine, max)) }

    @Test fun fieldTextIsReturnedTrimmed() {
        val r = field(Recorder(groqReply("  Hello team.  "))) as AiTextResult.Success
        assertEquals("Hello team.", r.text)
    }

    @Test fun fieldPromptCarriesLabelInstructionAndOnlyThatFieldsText() {
        val rec = Recorder(groqReply("ok"))
        field(rec, instruction = "make it polite", text = "send me the file")
        val user = rec.calls.single().body.getJSONArray("messages").getJSONObject(1).getString("content")
        assertTrue(user.contains("Status note"))
        assertTrue(user.contains("make it polite"))
        assertTrue(user.contains("send me the file"))
        val system = rec.calls.single().body.getJSONArray("messages").getJSONObject(0).getString("content")
        assertTrue(system.contains("single line"))
        assertTrue(system.contains("200"))
    }

    @Test fun emptyFieldIsWrittenFromTheInstruction() {
        val rec = Recorder(groqReply("The shipment is delayed by two days."))
        val r = field(rec, instruction = "say the shipment is delayed by two days", text = "") as AiTextResult.Success
        assertEquals("The shipment is delayed by two days.", r.text)
        assertTrue(rec.calls.single().body.getJSONArray("messages").getJSONObject(1).getString("content").contains("empty"))
    }

    @Test fun parseTextStripsFencesAndWrappingQuotes() {
        assertEquals("Hello", AiDraftParser.parseText("\"Hello\"", true, 100).getOrThrow())
        assertEquals("Hello", AiDraftParser.parseText("“Hello”", true, 100).getOrThrow())
        assertEquals("Hello", AiDraftParser.parseText("```\nHello\n```", true, 100).getOrThrow())
        assertEquals("Hello", AiDraftParser.parseText("```text\nHello\n```", true, 100).getOrThrow())
    }

    @Test fun parseTextKeepsInnerQuotesAndRealQuotedSpeech() {
        assertEquals("He said \"yes\" twice", AiDraftParser.parseText("He said \"yes\" twice", true, 100).getOrThrow())
        assertEquals("\"Yes\" and \"no\"", AiDraftParser.parseText("\"Yes\" and \"no\"", true, 100).getOrThrow())
    }

    @Test fun singleLineFieldsCollapseLineBreaks() {
        assertEquals("one two three", AiDraftParser.parseText("one\n\n two \r\nthree", true, 100).getOrThrow())
    }

    @Test fun multilineFieldsKeepParagraphs() {
        assertEquals("Para one.\n\nPara two.", AiDraftParser.parseText("Para one.\n\nPara two.", false, 100).getOrThrow())
    }

    @Test fun controlCharactersAreRemoved() {
        assertEquals("ab", AiDraftParser.parseText("a\u0007b", true, 100).getOrThrow())
    }

    @Test fun parseTextRejectsEmptyAndOverlong() {
        assertTrue(AiDraftParser.parseText("   ", true, 100).isFailure)
        assertTrue(AiDraftParser.parseText("```\n```", true, 100).isFailure)
        val tooLong = AiDraftParser.parseText("x".repeat(101), true, 100)
        assertTrue(tooLong.isFailure)
        assertTrue(tooLong.exceptionOrNull()!!.message!!.contains("100"))
        assertTrue(AiDraftParser.parseText("x".repeat(100), true, 100).isSuccess)
    }

    @Test fun overlongFieldResultSurfacesAsAnError() {
        assertTrue(field(Recorder(groqReply("x".repeat(500))), max = 100) is AiTextResult.Error)
    }

    // ---- other providers share the same path ----

    @Test fun anthropicDrafterAlsoSupportsFieldText() = runBlocking {
        val transport = HttpTransport { _, h, b ->
            assertEquals("k", h["x-api-key"]); assertFalse(String(b).contains("response_format"))
            HttpResult(200, JSONObject().put("content", JSONArray().put(JSONObject().put("type", "text").put("text", "Polished."))).toString())
        }
        val r = AnthropicDrafter(transport, { "k" }, { "m" }).writeText(AiTextRequest("improve", "polish me", "Note", true, 100))
        assertEquals(AiTextResult.Success("Polished."), r)
    }

    @Test fun anthropicRateLimitGetsTheFriendlyMessage() = runBlocking {
        val r = AnthropicDrafter({ _, _, _ -> HttpResult(429, "") }, { "k" }, { "m" }).draft("x", "", "", keys) as AiResult.Error
        assertTrue(r.message.contains("rate limit"))
    }

    // ---- provider routing ----

    private class Fake(override val isConfigured: Boolean, val name: String) : AiDrafter {
        override suspend fun draft(instruction: String, currentSubject: String, currentBody: String, fieldKeys: Set<String>) = AiResult.Success(AiDraft(name, "b"))
        override suspend fun writeText(request: AiTextRequest) = AiTextResult.Success(name)
    }

    @Test fun providerDrafterFollowsTheActiveProviderAtCallTime() = runBlocking {
        var active = AiProvider.GROQ
        val d = ProviderDrafter(mapOf(AiProvider.GROQ to Fake(true, "groq"), AiProvider.ANTHROPIC to Fake(false, "anthropic")), { active })
        assertTrue(d.isConfigured)
        assertEquals("groq", (d.draft("x", "", "", keys) as AiResult.Success).draft.subject)
        assertEquals(AiTextResult.Success("groq"), d.writeText(AiTextRequest("x", "t", "n", true, 10)))
        active = AiProvider.ANTHROPIC
        assertFalse(d.isConfigured)
        assertEquals("anthropic", (d.draft("x", "", "", keys) as AiResult.Success).draft.subject)
    }

    @Test fun initialProviderKeepsExistingAnthropicUsersOnAnthropic() {
        assertEquals(AiProvider.GROQ, AiProvider.initial(hasGroqKey = false, hasAnthropicKey = false))
        assertEquals(AiProvider.ANTHROPIC, AiProvider.initial(hasGroqKey = false, hasAnthropicKey = true))
        assertEquals(AiProvider.GROQ, AiProvider.initial(hasGroqKey = true, hasAnthropicKey = true))
        assertEquals(AiProvider.GROQ, AiProvider.initial(hasGroqKey = true, hasAnthropicKey = false))
    }

    @Test fun providerNamesRoundTripAndUnknownNamesAreIgnored() {
        AiProvider.entries.forEach { assertEquals(it, AiProvider.fromName(it.name)) }
        assertNull(AiProvider.fromName("OPENAI"))
        assertNull(AiProvider.fromName(null))
        assertEquals("openai/gpt-oss-120b", AiProvider.GROQ.defaultModel)
    }

    @Test fun everyDefaultIsOfferedAndNoRetiredModelIsOffered() {
        AiProvider.entries.forEach { p ->
            val ids = p.models.map { it.id }
            assertTrue("${p.name} default must be in its list", p.defaultModel in ids)
            assertEquals("no duplicate ids", ids.size, ids.toSet().size)
            assertTrue("a retired model must not be offered", ids.none { it in p.retiredModels })
            assertFalse(p.defaultModel in p.retiredModels)
        }
        assertTrue("llama-3.3-70b-versatile" in AiProvider.GROQ.retiredModels)
    }

    @Test fun gptOssGetsLowReasoningEffortOtherModelsDoNot() = runBlocking {
        val rec = Recorder(groqReply("{\"subject\":\"s\",\"body\":\"b\"}"))
        drafter(rec, model = "openai/gpt-oss-120b").draft("x", "", "", keys)
        assertEquals("low", rec.calls.single().body.getString("reasoning_effort"))
        val rec2 = Recorder(groqReply("{\"subject\":\"s\",\"body\":\"b\"}"))
        drafter(rec2, model = "qwen/qwen3.8-27b").draft("x", "", "", keys)
        assertFalse(rec2.calls.single().body.has("reasoning_effort"))
    }

    @Test fun everyActionHasAnInstructionAndSubjectIsNotAFieldAction() {
        AiAction.entries.forEach { assertTrue(it.label.isNotBlank() && it.instruction.isNotBlank()) }
        assertFalse(AiAction.NEW_SUBJECT in AiAction.forFields)
        assertTrue(AiAction.IMPROVE in AiAction.forFields)
        assertEquals(AiAction.entries.size - 1, AiAction.forFields.size)
    }
}
