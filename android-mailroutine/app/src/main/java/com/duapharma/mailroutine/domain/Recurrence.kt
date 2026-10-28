package com.duapharma.mailroutine.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** A due slot: stable local date plus the instant it falls on in the routine's zone. */
data class Slot(val localDate: LocalDate, val dueAt: Instant)

object Recurrence {
    private const val MAX_SCAN_DAYS = 400L

    fun fires(schedule: Schedule, date: LocalDate): Boolean = when (schedule.kind) {
        ScheduleKind.DAILY -> true
        ScheduleKind.WEEKLY -> date.dayOfWeek in schedule.days
    }

    /**
     * Wall-clock time on [date] in the schedule's zone. In a DST gap java.time shifts forward by
     * the gap length (02:30 becomes 03:30); in an overlap the earlier offset is used. So a slot
     * always exists and exactly once per local date.
     */
    fun instantOn(schedule: Schedule, date: LocalDate): Instant =
        ZonedDateTime.of(date, schedule.time, ZoneId.of(schedule.zoneId)).toInstant()

    /** First slot strictly after [after], or null for an unsatisfiable schedule. */
    fun nextAfter(schedule: Schedule, after: Instant): Slot? {
        val zone = ZoneId.of(schedule.zoneId)
        val start = after.atZone(zone).toLocalDate().minusDays(1)
        var d = start
        repeat((MAX_SCAN_DAYS + 2).toInt()) {
            if (fires(schedule, d)) {
                val at = instantOn(schedule, d)
                if (at.isAfter(after)) return Slot(d, at)
            }
            d = d.plusDays(1)
        }
        return null
    }

    /** All slots with fromExclusive < dueAt <= toInclusive, ascending. */
    fun slotsBetween(schedule: Schedule, fromExclusive: Instant, toInclusive: Instant): List<Slot> {
        if (!toInclusive.isAfter(fromExclusive)) return emptyList()
        val zone = ZoneId.of(schedule.zoneId)
        var d = fromExclusive.atZone(zone).toLocalDate().minusDays(1)
        val end = toInclusive.atZone(zone).toLocalDate().plusDays(1)
        val out = mutableListOf<Slot>()
        while (!d.isAfter(end)) {
            if (fires(schedule, d)) {
                val at = instantOn(schedule, d)
                if (at.isAfter(fromExclusive) && !at.isAfter(toInclusive)) out += Slot(d, at)
            }
            d = d.plusDays(1)
        }
        return out
    }
}
