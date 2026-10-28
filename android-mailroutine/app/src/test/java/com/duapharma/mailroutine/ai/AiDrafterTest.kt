package com.duapharma.mailroutine.ai

import com.duapharma.mailroutine.gmail.HttpResult
import com.duapharma.mailroutine.gmail.TransportException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AiDrafterTest {
    private val keys = setOf("amount")
    private fun reply(text: String) = HttpResult(200, JSONObject().put("content", org.json.JSONArray().put(JSONObject().put("type", "text").put("text", text))).toString())

    @Test fun disabledWhenNoKeyAndNeverCallsNetwork() = runBlocking {
        var called = false
        val d = AnthropicDrafter({ _, _, _ -> called = true; reply("") }, { null }, { "m" })
        assertFalse(d.isConfigured)
        assertEquals(AiResult.NotConfigured, d.draft("x", "", "", keys))
        assertFalse(called)
    }

    @Test fun parsesFencedJsonAndSendsNoRecipients() = runBlocking {
        var sent = ""
        val d = AnthropicDrafter({ _, h, b -> sent = String(b); assertEquals("k", h["x-api-key"]); reply("```json\n{\"subject\":\"Report {{date}}\",\"body\":\"Total {{amount}}\"}\n```") }, { "k" }, { "claude-sonnet-5-5" })
        val r = d.draft("weekly report", "S", "B", keys) as AiResult.Success
        assertEquals("Report {{date}}", r.draft.subject)
        assertTrue(sent.contains("claude-sonnet-5-5"))
    }

    @Test fun rejectsDraftsWithUnknownPlaceholders() {
        assertTrue(AiDraftParser.parse("""{"subject":"s","body":"{{ssn}}"}""", keys).isFailure)
    }

    @Test fun rejectsEmptyOrOversizedOrNonJson() {
        assertTrue(AiDraftParser.parse("no json here", keys).isFailure)
        assertTrue(AiDraftParser.parse("""{"subject":"","body":"b"}""", keys).isFailure)
        assertTrue(AiDraftParser.parse("""{"subject":"${"x".repeat(400)}","body":"b"}""", keys).isFailure)
    }

    @Test fun subjectNewlinesCollapsed() {
        assertEquals("a b", AiDraftParser.parse("""{"subject":"a\nb","body":"x"}""", keys).getOrThrow().subject)
    }

    @Test fun errorStatusesAreMappedWithoutLeakingKey() = runBlocking {
        val unauthorized = AnthropicDrafter({ _, _, _ -> HttpResult(401, "") }, { "secret-key" }, { "m" })
        val msg = (unauthorized.draft("x", "", "", keys) as AiResult.Error).message
        assertFalse(msg.contains("secret-key"))
        val offline = AnthropicDrafter({ _, _, _ -> throw TransportException(false, null) }, { "k" }, { "m" })
        assertTrue(offline.draft("x", "", "", keys) is AiResult.Error)
    }
}
