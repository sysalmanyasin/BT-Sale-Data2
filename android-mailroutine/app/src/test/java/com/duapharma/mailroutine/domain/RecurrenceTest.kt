package com.duapharma.mailroutine.domain

import org.junit.Assert.*
import org.junit.Test
import java.time.*

class RecurrenceTest {
    private fun weekly(zone: String, time: LocalTime, vararg d: DayOfWeek) =
        Schedule(ScheduleKind.WEEKLY, d.toSet(), time, zone)

    @Test fun dailyNextIsSameDayWhenTimeNotPassed() {
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(9, 0), "UTC")
        val n = Recurrence.nextAfter(s, Instant.parse("2026-03-02T08:00:00Z"))!!
        assertEquals(Instant.parse("2026-03-02T09:00:00Z"), n.dueAt)
        assertEquals(LocalDate.parse("2026-03-02"), n.localDate)
    }

    @Test fun dailyNextIsTomorrowWhenExactlyAtDue() {
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(9, 0), "UTC")
        val n = Recurrence.nextAfter(s, Instant.parse("2026-03-02T09:00:00Z"))!!
        assertEquals(Instant.parse("2026-03-03T09:00:00Z"), n.dueAt) // strictly after
    }

    @Test fun weeklySkipsUnselectedDays() {
        val s = weekly("UTC", LocalTime.of(10, 0), DayOfWeek.MONDAY, DayOfWeek.THURSDAY)
        val n = Recurrence.nextAfter(s, Instant.parse("2026-03-02T11:00:00Z"))!! // Monday after due
        assertEquals(LocalDate.parse("2026-03-05"), n.localDate)
        assertEquals(DayOfWeek.THURSDAY, n.localDate.dayOfWeek)
    }

    @Test fun weeklyWrapsToNextWeek() {
        val s = weekly("UTC", LocalTime.of(10, 0), DayOfWeek.MONDAY)
        val n = Recurrence.nextAfter(s, Instant.parse("2026-03-02T10:00:01Z"))!!
        assertEquals(LocalDate.parse("2026-03-09"), n.localDate)
    }

    @Test fun emptyWeeklyScheduleHasNoNext() {
        assertNull(Recurrence.nextAfter(weekly("UTC", LocalTime.NOON), Instant.parse("2026-03-02T00:00:00Z")))
    }

    @Test fun timeZoneShiftsInstant() {
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(9, 0), "Asia/Karachi") // UTC+5
        val n = Recurrence.nextAfter(s, Instant.parse("2026-03-02T00:00:00Z"))!!
        assertEquals(Instant.parse("2026-03-02T04:00:00Z"), n.dueAt)
    }

    @Test fun localDateIsInRoutineZoneNotUtc() {
        // 23:30 local in Karachi is 18:30Z the same calendar day.
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(23, 30), "Asia/Karachi")
        val n = Recurrence.nextAfter(s, Instant.parse("2026-03-02T00:00:00Z"))!!
        assertEquals(LocalDate.parse("2026-03-02"), n.localDate)
        assertEquals(Instant.parse("2026-03-02T18:30:00Z"), n.dueAt)
    }

    @Test fun dstSpringForwardGapMovesToValidTime() {
        // New York 2026-03-08 02:30 does not exist; slot still exists exactly once, at 03:30 EDT.
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(2, 30), "America/New_York")
        val slots = Recurrence.slotsBetween(s, Instant.parse("2026-03-07T12:00:00Z"), Instant.parse("2026-03-09T12:00:00Z"))
        assertEquals(listOf("2026-03-08", "2026-03-09"), slots.map { it.localDate.toString() })
        assertEquals(Instant.parse("2026-03-08T07:30:00Z"), slots[0].dueAt) // 03:30 EDT
    }

    @Test fun dstFallBackOverlapFiresOnce() {
        // 2026-11-01 01:30 occurs twice in New York; we fire once, at the first (EDT) occurrence.
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(1, 30), "America/New_York")
        val slots = Recurrence.slotsBetween(s, Instant.parse("2026-10-31T12:00:00Z"), Instant.parse("2026-11-02T12:00:00Z"))
        assertEquals(listOf("2026-11-01", "2026-11-02"), slots.map { it.localDate.toString() })
        assertEquals(Instant.parse("2026-11-01T05:30:00Z"), slots[0].dueAt)
    }

    @Test fun slotsBetweenIsExclusiveInclusive() {
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(9, 0), "UTC")
        val slots = Recurrence.slotsBetween(s, Instant.parse("2026-03-02T09:00:00Z"), Instant.parse("2026-03-04T09:00:00Z"))
        assertEquals(listOf("2026-03-03", "2026-03-04"), slots.map { it.localDate.toString() })
    }

    @Test fun slotsBetweenEmptyWhenRangeInverted() {
        val s = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(9, 0), "UTC")
        assertTrue(Recurrence.slotsBetween(s, Instant.parse("2026-03-04T00:00:00Z"), Instant.parse("2026-03-02T00:00:00Z")).isEmpty())
    }
}
