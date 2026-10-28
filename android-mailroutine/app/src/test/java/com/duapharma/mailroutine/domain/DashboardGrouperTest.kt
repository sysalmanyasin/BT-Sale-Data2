package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.Fx
import com.duapharma.mailroutine.domain.OccurrenceState.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Duration

class DashboardGrouperTest {
    private val now = Fx.NOW // 09:30Z; fixture due is 09:00Z; late window 120 min
    private val r = Fx.routine()
    private fun b(s: OccurrenceState, dueAt: java.time.Instant = Fx.occurrence().dueAt) = DashboardGrouper.bucket(r, Fx.occurrence(state = s, dueAt = dueAt), now)

    @Test fun bucketsFollowStateAndTime() {
        assertEquals(Bucket.DUE, b(SCHEDULED))
        assertEquals(Bucket.UPCOMING, b(SCHEDULED, now.plusSeconds(60)))
        assertEquals(Bucket.OVERDUE, b(SCHEDULED, now.minus(Duration.ofHours(3))))
        assertEquals(Bucket.ATTENTION, b(FAILED)); assertEquals(Bucket.ATTENTION, b(UNCERTAIN))
        assertEquals(Bucket.ATTENTION, b(BLOCKED)); assertEquals(Bucket.UPCOMING, b(BLOCKED, now.plusSeconds(60)))
        assertEquals(Bucket.COMPLETED, b(SUBMITTED)); assertEquals(Bucket.COMPLETED, b(SKIPPED))
    }

    @Test fun oldCompletedItemsAreHiddenAndOrderingIsStable() {
        val old = Fx.occurrence(state = SUBMITTED).copy(updatedAt = now.minus(Duration.ofDays(30)))
        val recent = Fx.occurrence(date = java.time.LocalDate.parse("2026-03-01"), state = SUBMITTED).copy(updatedAt = now)
        val g = DashboardGrouper.group(listOf(WorkItem(r, old), WorkItem(r, recent)), now)
        assertEquals(listOf(recent.id), g.getValue(Bucket.COMPLETED).map { it.occurrence.id })
        assertEquals(Bucket.entries.toSet(), g.keys)
    }
}
