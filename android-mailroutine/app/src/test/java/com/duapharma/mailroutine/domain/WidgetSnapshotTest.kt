package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.Fx
import com.duapharma.mailroutine.domain.OccurrenceState.*
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class WidgetSnapshotTest {
    private val now = Fx.NOW // 09:30Z
    private val r = Fx.routine()
    private fun item(day: String, state: OccurrenceState = SCHEDULED, hoursAhead: Long, routine: Routine = r) =
        WorkItem(routine, Fx.occurrence(routine.id, LocalDate.parse(day), state, dueAt = now.plusSeconds(hoursAhead * 3600)))

    @Test fun emptyWhenNothingScheduled() {
        val s = WidgetSnapshot.of(emptyList(), now)
        assertEquals(WidgetSnapshot.EMPTY, s)
        assertNull(s.next)
    }

    @Test fun nextIsSoonestUpcomingAndLaterFollowsInOrder() {
        val a = item("2026-03-04", hoursAhead = 48)
        val b = item("2026-03-02", hoursAhead = 2)
        val c = item("2026-03-03", hoursAhead = 24)
        val s = WidgetSnapshot.of(listOf(a, b, c), now)
        assertEquals(3, s.upcoming)
        assertEquals(b.occurrence.id, s.next?.occurrence?.id)
        assertEquals(listOf(c.occurrence.id, a.occurrence.id), s.later.map { it.occurrence.id })
    }

    @Test fun countersMatchDashboardBuckets() {
        val failed = item("2026-03-01", FAILED, hoursAhead = -20)
        val due = item("2026-03-02", SCHEDULED, hoursAhead = 0).let { it.copy(occurrence = it.occurrence.copy(dueAt = now.minusSeconds(60))) }
        val up = item("2026-03-03", hoursAhead = 5)
        val s = WidgetSnapshot.of(listOf(failed, due, up), now)
        assertEquals(1, s.needYou); assertEquals(1, s.dueNow); assertEquals(1, s.upcoming)
        // Next up is still shown while something needs attention (the widget flags it separately).
        assertEquals(up.occurrence.id, s.next?.occurrence?.id)
    }

    @Test fun pausedRoutinesAreNeverNextUp() {
        val paused = r.copy(paused = true)
        val s = WidgetSnapshot.of(listOf(item("2026-03-02", hoursAhead = 1, routine = paused)), now)
        assertNull(s.next)
        assertTrue(s.later.isEmpty())
    }

    @Test fun completedItemsDoNotCount() {
        val s = WidgetSnapshot.of(listOf(item("2026-03-02", SUBMITTED, hoursAhead = -1), item("2026-03-01", SKIPPED, hoursAhead = -30)), now)
        assertEquals(WidgetSnapshot.EMPTY, s)
    }
}
