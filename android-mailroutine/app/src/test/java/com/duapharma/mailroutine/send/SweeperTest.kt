package com.duapharma.mailroutine.send

import com.duapharma.mailroutine.Fx
import com.duapharma.mailroutine.FakeStore
import com.duapharma.mailroutine.MutableClock
import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.domain.OccurrenceState.*
import com.duapharma.mailroutine.gmail.GmailResult
import com.duapharma.mailroutine.gmail.GmailSender
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.time.Duration
import java.time.Instant

class SweeperTest {
    private val enqueued = mutableListOf<Triple<String, SendMode, Duration>>()
    private val reminders = mutableListOf<String>()
    private val attention = mutableListOf<String>()
    private val store = FakeStore()
    private val clock = MutableClock(Instant.parse("2026-03-02T09:30:00Z"))

    private val gmail = object : GmailSender { override suspend fun send(accessToken: String, rawMime: ByteArray): GmailResult = GmailResult.Submitted("m", null) }
    private val auth = object : AuthProvider { override suspend fun acquire() = TokenResult.Token("t") }
    private val files = object : AttachmentSource { override fun isAvailable(ref: AttachmentRef) = true; override fun read(ref: AttachmentRef) = ByteArray(1) }
    private val coordinator = SendCoordinator(store, auth, gmail, files, clock)
    private val notifier = object : Notifier {
        override fun reminder(routine: Routine, occurrence: Occurrence) { reminders += occurrence.id }
        override fun attention(routine: Routine, occurrence: Occurrence) { attention += occurrence.id + ":" + occurrence.state }
    }
    private fun sweeper() = Sweeper(store, coordinator, { id, m, d -> enqueued += Triple(id, m, d) }, notifier, clock)

    @Before fun init() { store.routines["r1"] = Fx.routine(auto = true) }

    @Test fun materialisesMissedAndUpcomingOccurrencesIdempotently() = runBlocking {
        store.routines["r1"] = Fx.routine(auto = true).copy(activeSince = Instant.parse("2026-02-27T00:00:00Z"))
        sweeper().sweep()
        val first = store.occurrences.keys.toList()
        // Feb 27, 28, Mar 1, 2 (missed/due) and Mar 3, 4 (upcoming within horizon)
        assertEquals(listOf("r1:2026-02-27", "r1:2026-02-28", "r1:2026-03-01", "r1:2026-03-02", "r1:2026-03-03", "r1:2026-03-04"), first.sorted())
        sweeper().sweep()
        assertEquals(first.size, store.occurrences.size)
    }

    @Test fun neverMaterialisesBeforeActiveSinceOrWhilePaused() = runBlocking {
        store.routines["r1"] = Fx.routine(auto = true).copy(activeSince = clock.instant)
        sweeper().sweep()
        assertTrue(store.occurrences.keys.none { it < "r1:2026-03-03" })
        store.occurrences.clear()
        store.routines["r1"] = store.routines.getValue("r1").copy(paused = true)
        sweeper().sweep()
        assertTrue(store.occurrences.isEmpty())
    }

    @Test fun lookbackIsBounded() = runBlocking {
        store.routines["r1"] = Fx.routine(auto = true).copy(activeSince = Instant.parse("2025-01-01T00:00:00Z"))
        sweeper().sweep()
        assertTrue(store.occurrences.size <= 7 + 3)
    }

    @Test fun dueAutoRoutineWithinWindowIsEnqueuedOnce() = runBlocking {
        store.occurrences["r1:2026-03-02"] = Fx.occurrence()
        sweeper().sweep()
        assertEquals(listOf("r1:2026-03-02"), enqueued.filter { it.second == SendMode.AUTO }.map { it.first }.distinct())
    }

    @Test fun missedBeyondWindowIsNotAutoSentButLeftOverdue() = runBlocking {
        clock.instant = Instant.parse("2026-03-02T13:00:00Z") // 4h after due, window 2h
        store.occurrences["r1:2026-03-02"] = Fx.occurrence()
        sweeper().sweep()
        assertTrue(enqueued.none { it.first == "r1:2026-03-02" })
        assertEquals(SCHEDULED, store.occurrences.getValue("r1:2026-03-02").state)
    }

    @Test fun manualRoutineGetsOneReminderOnly() = runBlocking {
        store.routines["r1"] = Fx.routine(auto = false)
        store.occurrences["r1:2026-03-02"] = Fx.occurrence()
        sweeper().sweep(); sweeper().sweep()
        assertEquals(1, reminders.count { it == "r1:2026-03-02" })
        assertTrue(enqueued.isEmpty())
    }

    @Test fun completeAutoRoutineGetsNoReminder() = runBlocking {
        store.occurrences["r1:2026-03-02"] = Fx.occurrence()
        sweeper().sweep()
        assertTrue(reminders.none { it == "r1:2026-03-02" })
    }

    @Test fun staleSendingRowIsRecoveredToUncertainAndUserNotifiedOnce() = runBlocking {
        store.occurrences["r1:2026-03-02"] = Fx.occurrence(state = SENDING).copy(leaseUntil = clock.instant.minusSeconds(5))
        sweeper().sweep(); sweeper().sweep()
        assertEquals(UNCERTAIN, store.occurrences.getValue("r1:2026-03-02").state)
        assertEquals(1, attention.count { it == "r1:2026-03-02:UNCERTAIN" })
        assertTrue(enqueued.none { it.first == "r1:2026-03-02" })
    }

    @Test fun failedAndBlockedDueWorkNotifiesOncePerState() = runBlocking {
        store.occurrences["r1:2026-03-02"] = Fx.occurrence(state = FAILED).copy(lastErrorCode = "REJECTED")
        sweeper().sweep(); sweeper().sweep()
        assertEquals(1, attention.size)
    }

    @Test fun retryWaitIsPassedAsDelay() = runBlocking {
        store.occurrences["r1:2026-03-02"] = Fx.occurrence(state = FAILED_RETRYABLE).copy(nextRetryAt = clock.instant.plusSeconds(120), attempts = 1)
        sweeper().sweep()
        assertEquals(Duration.ofSeconds(120), enqueued.first { it.first == "r1:2026-03-02" }.third)
    }

    @Test fun notifyAttentionForRaisesOncePerStateAndOnlyWhenTheUserIsNeeded() = runBlocking {
        val failed = Fx.occurrence(state = FAILED)
        store.occurrences[failed.id] = failed
        sweeper().notifyAttentionFor(failed.id)
        sweeper().notifyAttentionFor(failed.id)
        assertEquals(listOf(failed.id + ":FAILED"), attention)

        val scheduled = Fx.occurrence(date = java.time.LocalDate.parse("2026-03-03"), dueAt = Instant.parse("2026-03-03T09:00:00Z"))
        store.occurrences[scheduled.id] = scheduled
        val notDueBlocked = Fx.occurrence(date = java.time.LocalDate.parse("2026-03-04"), dueAt = Instant.parse("2026-03-04T09:00:00Z"), state = BLOCKED)
        store.occurrences[notDueBlocked.id] = notDueBlocked
        sweeper().notifyAttentionFor(scheduled.id)
        sweeper().notifyAttentionFor(notDueBlocked.id)
        assertEquals(1, attention.size)
    }
}
