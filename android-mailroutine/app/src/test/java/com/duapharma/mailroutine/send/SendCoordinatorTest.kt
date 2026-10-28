package com.duapharma.mailroutine.send

import com.duapharma.mailroutine.Fx
import com.duapharma.mailroutine.FakeStore
import com.duapharma.mailroutine.MutableClock
import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.domain.OccurrenceState.*
import com.duapharma.mailroutine.gmail.GmailResult
import com.duapharma.mailroutine.gmail.GmailSender
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.time.Duration

class SendCoordinatorTest {
    private class FakeGmail(var result: () -> GmailResult = { GmailResult.Submitted("gm-1", "th-1") }) : GmailSender {
        private val counter = java.util.concurrent.atomic.AtomicInteger(); val calls get() = counter.get(); @Volatile var lastMime: String? = null
        override suspend fun send(accessToken: String, rawMime: ByteArray): GmailResult { counter.incrementAndGet(); lastMime = String(rawMime); return result() }
    }
    private class FakeAuth(var r: TokenResult = TokenResult.Token("tok")) : AuthProvider { override suspend fun acquire() = r }
    private class FakeFiles(val available: Set<String> = emptySet()) : AttachmentSource {
        override fun isAvailable(ref: AttachmentRef) = ref.id in available
        override fun read(ref: AttachmentRef) = if (ref.id in available) ByteArray(3) { 1 } else null
    }

    private lateinit var store: FakeStore
    private lateinit var gmail: FakeGmail
    private lateinit var auth: FakeAuth
    private val clock = MutableClock()

    @Before fun setUp() {
        store = FakeStore(); gmail = FakeGmail(); auth = FakeAuth(); clock.instant = Fx.NOW
        store.routines["r1"] = Fx.routine(auto = true)
        store.occurrences[Fx.occurrence().id] = Fx.occurrence()
    }

    private fun coordinator(files: AttachmentSource = FakeFiles()) = SendCoordinator(store, auth, gmail, files, clock)
    private val id = Fx.occurrence().id

    @Test fun successRecordsSubmittedWithMessageId() = runBlocking {
        val r = coordinator().run(id, SendMode.AUTO)
        assertEquals(RunResult.Submitted("gm-1"), r)
        val o = store.occurrences.getValue(id)
        assertEquals(SUBMITTED, o.state); assertEquals("gm-1", o.gmailMessageId); assertEquals(1, o.attempts)
        assertEquals(listOf(AttemptOutcome.SUBMITTED), store.attempts.map { it.outcome })
        assertTrue(gmail.lastMime!!.contains("Subject: Report 2026-03-02"))
    }

    @Test fun startedAttemptIsPersistedBeforeNetworkCall() = runBlocking {
        var startedSeen = false
        gmail.result = { startedSeen = store.attempts.any { it.outcome == AttemptOutcome.STARTED }; GmailResult.Submitted("m", null) }
        coordinator().run(id, SendMode.AUTO)
        assertTrue(startedSeen)
    }

    @Test fun missingInputBlocksAndNeverCallsGmail() = runBlocking {
        store.occurrences[id] = Fx.occurrence(values = emptyMap())
        val r = coordinator().run(id, SendMode.AUTO)
        assertTrue(r is RunResult.Blocked)
        assertEquals(0, gmail.calls)
        assertEquals(BLOCKED, store.occurrences.getValue(id).state)
        assertEquals("MISSING_INPUT", store.occurrences.getValue(id).lastErrorCode)
    }

    @Test fun repeatedBlockDoesNotSpamHistory() = runBlocking {
        store.occurrences[id] = Fx.occurrence(values = emptyMap())
        repeat(3) { coordinator().run(id, SendMode.AUTO) }
        assertEquals(1, store.attempts.size)
    }

    @Test fun revokedAuthorizationBlocksSafely() = runBlocking {
        auth.r = TokenResult.NeedsReauth
        val r = coordinator().run(id, SendMode.AUTO) as RunResult.Blocked
        assertTrue(r.reasons.contains(BlockReason.NEEDS_REAUTH))
        assertEquals(0, gmail.calls)
        assertEquals("AUTH_REQUIRED", store.occurrences.getValue(id).lastErrorCode)
    }

    @Test fun transientTokenTroubleLeavesStateUntouched() = runBlocking {
        auth.r = TokenResult.Unavailable
        assertEquals(RunResult.TryLater, coordinator().run(id, SendMode.AUTO))
        assertEquals(SCHEDULED, store.occurrences.getValue(id).state)
        assertEquals(0, gmail.calls); assertTrue(store.attempts.isEmpty())
    }

    @Test fun notConnectedBlocks() = runBlocking {
        auth.r = TokenResult.NotConnected
        assertTrue((coordinator().run(id, SendMode.MANUAL) as RunResult.Blocked).reasons.contains(BlockReason.NOT_CONNECTED))
        assertEquals(0, gmail.calls)
    }

    @Test fun gmailRejectingTokenAfterwardsBlocksForReauth() = runBlocking {
        gmail.result = { GmailResult.Failed(SendFailure.Auth("TOKEN_REJECTED")) }
        val r = coordinator().run(id, SendMode.AUTO)
        assertTrue(r is RunResult.Blocked)
        assertEquals(BLOCKED, store.occurrences.getValue(id).state)
    }

    @Test fun requiredAttachmentMissingBlocks() = runBlocking {
        store.routines["r1"] = Fx.routine(auto = true, attachments = listOf(AttachmentRef("a1", "r.pdf", 3, "application/pdf")))
        val r = coordinator(FakeFiles(emptySet())).run(id, SendMode.AUTO) as RunResult.Blocked
        assertTrue(r.reasons.contains(BlockReason.ATTACHMENT_UNAVAILABLE))
        assertEquals(0, gmail.calls)
    }

    @Test fun attachmentIsIncludedWhenAvailable() = runBlocking {
        store.routines["r1"] = Fx.routine(auto = true, attachments = listOf(AttachmentRef("a1", "r.pdf", 3, "application/pdf")))
        assertTrue(coordinator(FakeFiles(setOf("a1"))).run(id, SendMode.AUTO) is RunResult.Submitted)
        assertTrue(gmail.lastMime!!.contains("filename=\"r.pdf\""))
    }

    @Test fun networkFailureSchedulesRetryThenResendIsAllowedOnlyAfterBackoff() = runBlocking {
        gmail.result = { GmailResult.Failed(SendFailure.NotSentNetwork) }
        val r = coordinator().run(id, SendMode.AUTO) as RunResult.RetryScheduled
        assertEquals(clock.instant.plus(Duration.ofMinutes(1)), r.at)
        assertEquals(FAILED_RETRYABLE, store.occurrences.getValue(id).state)
        // too early: deferred, no second call
        assertTrue(coordinator().run(id, SendMode.AUTO) is RunResult.Deferred)
        assertEquals(1, gmail.calls)
        // after backoff, succeeds
        clock.instant = r.at; gmail.result = { GmailResult.Submitted("m2", null) }
        assertTrue(coordinator().run(id, SendMode.AUTO) is RunResult.Submitted)
        assertEquals(2, gmail.calls); assertEquals(2, store.occurrences.getValue(id).attempts)
    }

    @Test fun retriesAreBoundedThenFail() = runBlocking {
        gmail.result = { GmailResult.Failed(SendFailure.NotSentNetwork) }
        var last: RunResult = RunResult.NotFound
        repeat(RetryPolicy.MAX_ATTEMPTS) {
            val o = store.occurrences.getValue(id); clock.instant = (o.nextRetryAt ?: clock.instant)
            last = coordinator().run(id, SendMode.AUTO)
        }
        assertTrue(last is RunResult.Failed)
        assertEquals(FAILED, store.occurrences.getValue(id).state)
        assertEquals(RetryPolicy.MAX_ATTEMPTS, gmail.calls)
        assertTrue(coordinator().run(id, SendMode.AUTO) is RunResult.AlreadyHandled) // FAILED needs user reset
    }

    @Test fun ambiguousResultBecomesUncertainAndIsNeverResent() = runBlocking {
        gmail.result = { GmailResult.Failed(SendFailure.Ambiguous("HTTP_503")) }
        assertTrue(coordinator().run(id, SendMode.AUTO) is RunResult.Uncertain)
        assertEquals(UNCERTAIN, store.occurrences.getValue(id).state)
        repeat(3) { clock.instant = clock.instant.plus(Duration.ofHours(1)); assertEquals(RunResult.AlreadyHandled, coordinator().run(id, SendMode.MANUAL)) }
        assertEquals(1, gmail.calls)
    }

    @Test fun unexpectedSenderExceptionIsTreatedAsUncertain() = runBlocking {
        gmail.result = { throw IllegalStateException("boom") }
        assertTrue(coordinator().run(id, SendMode.AUTO) is RunResult.Uncertain)
    }

    @Test fun concurrentWorkersSendExactlyOnce() = runBlocking {
        val results = (1..8).map { async(kotlinx.coroutines.Dispatchers.Default) { coordinator().run(id, SendMode.AUTO) } }.awaitAll()
        assertEquals(1, results.count { it is RunResult.Submitted })
        assertEquals(1, gmail.calls)
    }

    @Test fun lostClaimDoesNotSend() = runBlocking {
        store.loseClaim = true
        assertEquals(RunResult.AlreadyHandled, coordinator().run(id, SendMode.AUTO))
        assertEquals(0, gmail.calls)
    }

    @Test fun terminalStatesAreNeverResent() = runBlocking {
        coordinator().run(id, SendMode.AUTO)
        assertEquals(RunResult.AlreadyHandled, coordinator().run(id, SendMode.MANUAL))
        assertEquals(1, gmail.calls)
    }

    @Test fun staleLeaseRecoversToUncertainNotResend() = runBlocking {
        store.occurrences[id] = Fx.occurrence(state = SENDING).copy(leaseUntil = clock.instant.minusSeconds(1))
        assertEquals(RunResult.Uncertain("LEASE_EXPIRED"), coordinator().run(id, SendMode.AUTO))
        assertEquals(UNCERTAIN, store.occurrences.getValue(id).state)
        assertEquals(0, gmail.calls)
    }

    @Test fun liveLeaseIsRespected() = runBlocking {
        store.occurrences[id] = Fx.occurrence(state = SENDING).copy(leaseUntil = clock.instant.plusSeconds(60))
        assertEquals(RunResult.AlreadyHandled, coordinator().run(id, SendMode.AUTO))
        assertEquals(SENDING, store.occurrences.getValue(id).state)
    }

    @Test fun autoModeWithoutConsentIsBlockedButManualWorks() = runBlocking {
        store.routines["r1"] = Fx.routine(auto = false)
        assertTrue(coordinator().run(id, SendMode.AUTO) is RunResult.Blocked)
        assertEquals(0, gmail.calls)
        assertTrue(coordinator().run(id, SendMode.MANUAL) is RunResult.Submitted)
    }

    @Test fun userResetAfterUncertainAllowsExplicitResend() = runBlocking {
        gmail.result = { GmailResult.Failed(SendFailure.Ambiguous()) }
        coordinator().run(id, SendMode.MANUAL)
        val u = store.occurrences.getValue(id)
        assertTrue(store.update(u.copy(state = SCHEDULED), UNCERTAIN)) // the explicit "it was not sent" reconciliation
        gmail.result = { GmailResult.Submitted("m", null) }
        assertTrue(coordinator().run(id, SendMode.MANUAL) is RunResult.Submitted)
    }

    @Test fun historyNeverContainsAddressesOrBody() = runBlocking {
        coordinator().run(id, SendMode.AUTO)
        val dump = store.attempts.joinToString { it.toString() }
        assertFalse(dump.contains("boss@example.com")); assertFalse(dump.contains("Amount: 42"))
    }
}
