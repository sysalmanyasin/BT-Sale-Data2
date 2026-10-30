package com.duapharma.mailroutine.platform

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import androidx.compose.ui.graphics.toArgb
import com.duapharma.mailroutine.MailRoutineApp
import com.duapharma.mailroutine.MainActivity
import com.duapharma.mailroutine.R
import com.duapharma.mailroutine.data.RoutineRepository
import com.duapharma.mailroutine.domain.Consent
import com.duapharma.mailroutine.domain.WidgetSnapshot
import com.duapharma.mailroutine.domain.WorkItem
import com.duapharma.mailroutine.send.Clock
import com.duapharma.mailroutine.ui.dayLabel
import com.duapharma.mailroutine.ui.relativeTime
import com.duapharma.mailroutine.ui.routineAccent
import com.duapharma.mailroutine.ui.timeOfDay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Instant

private val Context.container get() = (applicationContext as MailRoutineApp).container

/**
 * Home-screen widgets: "Next up" (one card) and "Upcoming" (counters + the next few emails).
 *
 * They read the same data and the same grouping as the dashboard. They refresh when the database changes
 * while the app process is alive, after every background sweep (15 min), on resize, and on the system's
 * own 30 min tick. Relative text like "in 4h 51m" can therefore be a few minutes behind between refreshes.
 */
class WidgetRefresher(
    private val context: Context,
    private val repository: RoutineRepository,
    private val clock: Clock,
) {
    private val mgr get() = AppWidgetManager.getInstance(context)

    private fun ids(cls: Class<*>) = mgr.getAppWidgetIds(ComponentName(context, cls))

    suspend fun refresh() {
        val nextIds = ids(NextUpWidgetProvider::class.java)
        val upcomingIds = ids(UpcomingWidgetProvider::class.java)
        if (nextIds.isEmpty() && upcomingIds.isEmpty()) return
        val now = clock.now()
        val routines = repository.observeRoutines().first().associateBy { it.id }
        val rows = repository.observeOccurrences().first().mapNotNull { o -> routines[o.routineId]?.let { WorkItem(it, o) } }
        val snap = WidgetSnapshot.of(rows, now)
        nextIds.forEach { mgr.updateAppWidget(it, WidgetViews.nextUp(context, snap, now)) }
        upcomingIds.forEach { mgr.updateAppWidget(it, WidgetViews.upcoming(context, snap, now, maxRows(it))) }
    }

    /** Keeps widgets in step with the database for as long as [scope] lives. */
    fun keepFresh(scope: CoroutineScope) {
        scope.launch {
            combine(repository.observeRoutines(), repository.observeOccurrences()) { _, _ -> }
                .conflate()
                .collect {
                    runCatching { refresh() }
                    delay(500)
                }
        }
    }

    private fun maxRows(widgetId: Int): Int {
        val minHeightDp = mgr.getAppWidgetOptions(widgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180)
        // 12dp padding top and bottom, ~50dp counter tiles, ~42dp per row.
        return ((minHeightDp - 24 - 50 - 6) / 42).coerceIn(0, 6)
    }

    companion object {
        fun appScope() = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }
}

private object WidgetViews {
    private const val RC_OPEN_APP = 7001
    private const val RC_NEXT = 7002

    private fun open(context: Context, occurrenceId: String?, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (occurrenceId != null) intent.putExtra(MainActivity.EXTRA_OCCURRENCE_ID, occurrenceId)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun whenText(i: Instant, now: Instant) = "${dayLabel(i, now)}, ${timeOfDay(i)} \u00B7 ${relativeTime(i, now)}"

    private fun modeText(w: WorkItem) =
        if (!w.routine.paused && Consent.isValid(w.routine)) "Sends automatically" else "You send this one"

    fun nextUp(context: Context, s: WidgetSnapshot, now: Instant): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_next_up)
        val next = s.next
        if (next == null) {
            v.setTextViewText(R.id.tv_name, "All clear")
            v.setTextViewText(R.id.tv_when, "No upcoming emails")
            v.setViewVisibility(R.id.tv_mode, View.GONE)
        } else {
            v.setTextViewText(R.id.tv_name, next.routine.name)
            v.setTextViewText(R.id.tv_when, whenText(next.occurrence.dueAt, now))
            v.setTextViewText(R.id.tv_mode, modeText(next))
            v.setViewVisibility(R.id.tv_mode, View.VISIBLE)
        }
        when {
            s.needYou > 0 -> {
                v.setTextViewText(R.id.tv_alert, "\u26A0 ${s.needYou} need you")
                v.setTextColor(R.id.tv_alert, context.getColor(R.color.widget_red))
                v.setViewVisibility(R.id.tv_alert, View.VISIBLE)
            }
            s.dueNow > 0 -> {
                v.setTextViewText(R.id.tv_alert, "${s.dueNow} due now")
                v.setTextColor(R.id.tv_alert, context.getColor(R.color.widget_amber))
                v.setViewVisibility(R.id.tv_alert, View.VISIBLE)
            }
            else -> v.setViewVisibility(R.id.tv_alert, View.GONE)
        }
        v.setOnClickPendingIntent(R.id.widget_root, open(context, next?.occurrence?.id, if (next == null) RC_OPEN_APP else RC_NEXT))
        return v
    }

    fun upcoming(context: Context, s: WidgetSnapshot, now: Instant, maxRows: Int): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_upcoming)
        v.setTextViewText(R.id.tv_need, s.needYou.toString())
        v.setTextViewText(R.id.tv_due, s.dueNow.toString())
        v.setTextViewText(R.id.tv_up, s.upcoming.toString())

        v.removeAllViews(R.id.rows)
        val items = (listOfNotNull(s.next) + s.later).take(maxRows)
        items.forEach { w ->
            val row = RemoteViews(context.packageName, R.layout.widget_row)
            row.setTextViewText(R.id.row_name, w.routine.name)
            row.setTextViewText(R.id.row_when, whenText(w.occurrence.dueAt, now))
            row.setInt(R.id.row_bar, "setBackgroundColor", routineAccent(w.routine.name).toArgb())
            row.setOnClickPendingIntent(R.id.row_root, open(context, w.occurrence.id, w.occurrence.id.hashCode()))
            v.addView(R.id.rows, row)
        }
        v.setViewVisibility(R.id.tv_empty, if (s.next == null) View.VISIBLE else View.GONE)

        val app = open(context, null, RC_OPEN_APP)
        v.setOnClickPendingIntent(R.id.widget_root, app)
        v.setOnClickPendingIntent(R.id.tile_need, app)
        v.setOnClickPendingIntent(R.id.tile_due, app)
        v.setOnClickPendingIntent(R.id.tile_up, app)
        return v
    }
}

abstract class BaseWidgetProvider : AppWidgetProvider() {
    private fun refresh(context: Context) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try { runCatching { context.container.widgets.refresh() } } finally { pending.finish() }
        }
    }

    override fun onEnabled(context: Context) = refresh(context)
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) = refresh(context)
    override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) = refresh(context)
}

class NextUpWidgetProvider : BaseWidgetProvider()
class UpcomingWidgetProvider : BaseWidgetProvider()
