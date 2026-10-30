package com.duapharma.mailroutine.domain

import java.time.Instant

/** Everything the home-screen widgets show, derived from the same grouping the dashboard uses. */
data class WidgetSnapshot(
    val needYou: Int,
    val dueNow: Int,
    val upcoming: Int,
    /** The soonest upcoming email, regardless of whether other things need attention. */
    val next: WorkItem?,
    /** Upcoming emails after [next], soonest first. */
    val later: List<WorkItem>,
) {
    companion object {
        val EMPTY = WidgetSnapshot(0, 0, 0, null, emptyList())

        fun of(rows: List<WorkItem>, now: Instant): WidgetSnapshot {
            val g = DashboardGrouper.group(rows, now)
            fun n(b: Bucket) = g[b].orEmpty().size
            val up = g[Bucket.UPCOMING].orEmpty().filter { !it.routine.paused }
            return WidgetSnapshot(
                needYou = n(Bucket.ATTENTION) + n(Bucket.OVERDUE),
                dueNow = n(Bucket.DUE),
                upcoming = n(Bucket.UPCOMING),
                next = up.firstOrNull(),
                later = up.drop(1),
            )
        }
    }
}
