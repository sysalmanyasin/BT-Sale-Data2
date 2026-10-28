package com.duapharma.mailroutine.gmail

import com.duapharma.mailroutine.domain.SendFailure
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.time.Duration

class GmailClientTest {
    private fun ok(body: String = """{"id":"m123","threadId":"t9"}""") = HttpResult(200, body)
    private fun failure(r: GmailResult) = (r as GmailResult.Failed).failure

    @Test fun successParsesIds() {
        val r = GmailHttpSender.classify(ok()) as GmailResult.Submitted
        assertEquals("m123", r.messageId); assertEquals("t9", r.threadId)
    }

    @Test fun twoHundredWithoutIdIsAmbiguous() {
        assertTrue(failure(GmailHttpSender.classify(ok("{}"))) is SendFailure.Ambiguous)
        assertTrue(failure(GmailHttpSender.classify(ok("not json"))) is SendFailure.Ambiguous)
    }

    @Test fun statusMapping() {
        assertTrue(failure(GmailHttpSender.classify(HttpResult(401, ""))) is SendFailure.Auth)
        assertTrue(failure(GmailHttpSender.classify(HttpResult(403, """{"error":{"errors":[{"reason":"insufficientPermissions"}]}}"""))) is SendFailure.Auth)
        assertTrue(failure(GmailHttpSender.classify(HttpResult(403, """{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}"""))) is SendFailure.RateLimited)
        assertTrue(failure(GmailHttpSender.classify(HttpResult(400, ""))) is SendFailure.Rejected)
        assertEquals("TOO_LARGE", (failure(GmailHttpSender.classify(HttpResult(413, ""))) as SendFailure.Rejected).code)
        listOf(500, 502, 503, 504).forEach { assertTrue("$it", failure(GmailHttpSender.classify(HttpResult(it, ""))) is SendFailure.Ambiguous) }
    }

    @Test fun retryAfterHeaderParsed() {
        val f = failure(GmailHttpSender.classify(HttpResult(429, "", mapOf("retry-after" to "120")))) as SendFailure.RateLimited
        assertEquals(Duration.ofSeconds(120), f.retryAfter)
    }

    @Test fun transportErrorsSplitOnWhetherRequestCouldHaveArrived() = runBlocking {
        val before = GmailHttpSender({ _, _, _ -> throw TransportException(false, null) })
        val after = GmailHttpSender({ _, _, _ -> throw TransportException(true, null) })
        assertTrue(failure(before.send("t", ByteArray(1))) is SendFailure.NotSentNetwork)
        assertTrue(failure(after.send("t", ByteArray(1))) is SendFailure.Ambiguous)
    }

    @Test fun requestShapeAndTokenHandling() = runBlocking {
        var url = ""; var hdrs = emptyMap<String, String>(); var size = 0
        val s = GmailHttpSender({ u, h, b -> url = u; hdrs = h; size = b.size; ok() })
        val r = s.send("tok", ByteArray(5))
        assertTrue(r is GmailResult.Submitted)
        assertTrue(url.startsWith("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send"))
        assertEquals("Bearer tok", hdrs["Authorization"]); assertEquals("message/rfc822", hdrs["Content-Type"]); assertEquals(5, size)
    }
}
