package com.duapharma.mailroutine.domain

import java.time.Duration
import java.time.Instant

enum class Bucket { ATTENTION, OVERDUE, DUE, UPCOMING, COMPLETED }

data class WorkItem(val routine: Routine, val occurrence: Occurrence)

object DashboardGrouper {
    fun bucket(r: Routine, o: Occurrence, now: Instant): Bucket = when (o.state) {
        OccurrenceState.FAILED, OccurrenceState.UNCERTAIN -> Bucket.ATTENTION
        OccurrenceState.BLOCKED -> if (o.dueAt.isAfter(now)) Bucket.UPCOMING else Bucket.ATTENTION
        OccurrenceState.SUBMITTED, OccurrenceState.CONFIRMED_SENT, OccurrenceState.SKIPPED -> Bucket.COMPLETED
        OccurrenceState.SENDING -> Bucket.DUE
        OccurrenceState.SCHEDULED, OccurrenceState.FAILED_RETRYABLE ->
            when {
                o.dueAt.isAfter(now) -> Bucket.UPCOMING
                Duration.between(o.dueAt, now) <= Duration.ofMinutes(r.maxLateMinutes.toLong()) -> Bucket.DUE
                else -> Bucket.OVERDUE
            }
    }

    fun group(rows: List<WorkItem>, now: Instant, completedWithin: Duration = Duration.ofDays(7)): Map<Bucket, List<WorkItem>> {
        val visible = rows.filter { !(it.occurrence.state.isTerminal && it.occurrence.updatedAt.isBefore(now.minus(completedWithin))) }
        val grouped = visible.groupBy { bucket(it.routine, it.occurrence, now) }
        return Bucket.entries.associateWith { b ->
            val list = grouped[b].orEmpty()
            when (b) {
                Bucket.ATTENTION, Bucket.COMPLETED -> list.sortedByDescending { it.occurrence.updatedAt }
                else -> list.sortedBy { it.occurrence.dueAt }
            }
        }
    }
}
