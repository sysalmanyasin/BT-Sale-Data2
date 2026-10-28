package com.duapharma.mailroutine.send

import com.duapharma.mailroutine.FakeStore
import com.duapharma.mailroutine.Fx
import com.duapharma.mailroutine.MutableClock
import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.gmail.GmailResult
import com.duapharma.mailroutine.gmail.GmailSender
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class SendCoordinatorOomTest {
    @Test fun outOfMemoryWhilePreparingFailsCleanlyAndNeverCallsGmail() = runBlocking {
        val store = FakeStore()
        val att = AttachmentRef("a", "a.pdf", 10, "application/pdf")
        store.routines["r1"] = Fx.routine(auto = true, attachments = listOf(att))
        val occ = Fx.occurrence()
        store.occurrences[occ.id] = occ
        var called = false
        val gmail = object : GmailSender {
            override suspend fun send(accessToken: String, rawMime: ByteArray): GmailResult { called = true; return GmailResult.Submitted("m", null) }
        }
        val auth = object : AuthProvider { override suspend fun acquire() = TokenResult.Token("t") }
        val files = object : AttachmentSource {
            override fun isAvailable(ref: AttachmentRef) = true
            override fun read(ref: AttachmentRef): ByteArray? = throw OutOfMemoryError("test")
        }
        val result = SendCoordinator(store, auth, gmail, files, MutableClock()).run(occ.id, SendMode.AUTO)
        assertEquals(RunResult.Failed("OUT_OF_MEMORY"), result)
        assertFalse(called)
        assertEquals(OccurrenceState.FAILED, store.occurrences.getValue(occ.id).state)
    }
}
