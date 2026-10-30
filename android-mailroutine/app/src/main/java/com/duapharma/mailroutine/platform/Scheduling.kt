package com.duapharma.mailroutine.platform

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.*
import com.duapharma.mailroutine.MailRoutineApp
import com.duapharma.mailroutine.domain.SendMode
import com.duapharma.mailroutine.send.Clock
import com.duapharma.mailroutine.send.DeliveryStore
import com.duapharma.mailroutine.send.RunResult
import com.duapharma.mailroutine.send.SendScheduler
import java.time.Duration
import java.util.concurrent.TimeUnit

private val Context.container get() = (applicationContext as MailRoutineApp).container

/**
 * Local scheduling. WorkManager is *deferrable*: Doze, battery optimisation and OEM task killers can
 * delay runs, so due times are best-effort (typically within minutes, sometimes longer). A single
 * inexact alarm per next-due-time plus a 15-minute periodic sweep, boot/time-change receivers and an
 * app-start sweep together make sure overdue work is always noticed — late, but never lost.
 */
class WorkSendScheduler(private val context: Context) : SendScheduler {
    private val wm get() = WorkManager.getInstance(context)
    private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    override fun enqueueSend(occurrenceId: String, mode: SendMode, delay: Duration) {
        val delayed = !delay.isZero && !delay.isNegative
        val req = OneTimeWorkRequestBuilder<SendWorker>()
            .setInputData(workDataOf(SendWorker.KEY_ID to occurrenceId, SendWorker.KEY_MODE to mode.name))
            .setConstraints(net)
            .setInitialDelay(if (delayed) delay.toMillis() else 0, TimeUnit.MILLISECONDS)
            .build()
        // Same name + KEEP means a second request for the same occurrence is dropped while one is pending/running.
        // (The database claim is the real guard; this only avoids pointless duplicate workers.)
        if (delayed) wm.enqueueUniqueWork("send-$occurrenceId-delayed", ExistingWorkPolicy.REPLACE, req)
        else wm.enqueueUniqueWork("send-$occurrenceId", ExistingWorkPolicy.KEEP, req)
    }

    fun ensurePeriodic() {
        val req = PeriodicWorkRequestBuilder<SweepWorker>(15, TimeUnit.MINUTES).build()
        wm.enqueueUniquePeriodicWork("sweep-periodic", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun sweepNow() {
        wm.enqueueUniqueWork("sweep-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<SweepWorker>().build())
    }
}

class SweepWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = try {
        applicationContext.container.sweeper.sweep()
        applicationContext.container.alarms.rescheduleNext()
        runCatching { applicationContext.container.widgets.refresh() } // a widget problem must never fail the sweep
        Result.success()
    } catch (e: kotlin.coroutines.cancellation.CancellationException) {
        throw e
    } catch (e: Exception) {
        if (runAttemptCount < 3) Result.retry() else Result.failure()
    }
}

class SendWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString(KEY_ID) ?: return Result.failure()
        val mode = runCatching { SendMode.valueOf(inputData.getString(KEY_MODE) ?: "AUTO") }.getOrDefault(SendMode.AUTO)
        val c = applicationContext.container
        return try {
            when (val r = c.coordinator.run(id, mode)) {
                is RunResult.RetryScheduled -> {
                    c.scheduler.enqueueSend(id, mode, Duration.between(c.clock.now(), r.at))
                    Result.success()
                }
                RunResult.TryLater -> if (runAttemptCount < 5) Result.retry() else Result.success()
                // Notify directly. Do NOT call sweepNow() here: the sweeper re-enqueues blocked auto-sends, which block
                // again and would call sweepNow() again, an endless loop while the block reason persists.
                is RunResult.Blocked, is RunResult.Failed, is RunResult.Uncertain -> { c.sweeper.notifyAttentionFor(id); Result.success() }
                else -> Result.success()
            }
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            throw e // a lease left in SENDING is converted to UNCERTAIN by recovery, never resent blindly
        } catch (e: Exception) {
            Result.failure()
        }
    }

    companion object { const val KEY_ID = "occurrenceId"; const val KEY_MODE = "mode" }
}

/** Sets one inexact, doze-tolerant alarm for the next moment something needs attention. */
class AlarmScheduler(private val context: Context, private val store: DeliveryStore, private val clock: Clock) {
    suspend fun rescheduleNext() {
        val now = clock.now()
        val routines = store.activeRoutines().associateBy { it.id }
        val times = store.openOccurrences().flatMap { o ->
            val r = routines[o.routineId] ?: return@flatMap emptyList()
            if (r.paused) emptyList()
            else listOfNotNull(o.dueAt, o.dueAt.minus(Duration.ofMinutes(r.reminderLeadMinutes.toLong())), o.nextRetryAt)
        }.filter { it.isAfter(now) }
        val am = context.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(context, 1, Intent(context, AlarmReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val next = times.minOrNull()
        if (next == null) am.cancel(pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.toEpochMilli() + 1_000, pi)
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { context.container.scheduler.sweepNow() }
}

/** Boot, time-set, time-zone change and app update: re-arm everything and sweep for missed work. */
class SystemEventReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        context.container.scheduler.ensurePeriodic()
        context.container.scheduler.sweepNow()
    }
}
