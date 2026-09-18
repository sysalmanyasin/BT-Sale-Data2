package com.duapharma.attendance

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale
import java.util.Timer
import java.util.TimerTask

/**
 * Manager-mode counterpart to AttendanceForegroundService: instead of
 * reacting to a geofence, this polls attendance_events for new
 * check_in rows and posts a local notification for each one.
 *
 * Polling, not Supabase Realtime — no extra client library needed,
 * same raw HttpURLConnection style as the rest of AttendanceApi.kt,
 * and simple enough to reason about across a flaky connection or a
 * killed/restarted process (Prefs.lastNotifiedIso is the cursor, so a
 * restart never re-notifies the same event). 60s interval is a
 * starting balance between "feels timely" and not hammering the REST
 * endpoint — tune POLL_INTERVAL_MS if that's too chatty or too slow
 * in practice.
 *
 * Same foreground-service-for-OEM-battery-manager reasoning as
 * AttendanceForegroundService — see that file's header comment. Two
 * notification channels: a low-importance "still watching" status
 * notification (required to run as a foreground service at all) and a
 * high-importance one for the actual per-check-in alerts.
 */
class ManagerNotifyService : Service() {

    companion object {
        private const val STATUS_CHANNEL_ID = "attendance_manager_status"
        private const val ALERT_CHANNEL_ID = "attendance_checkin_alerts"
        private const val STATUS_NOTIF_ID = 2001
        private const val POLL_INTERVAL_MS = 60_000L

        fun start(context: Context) {
            val intent = Intent(context, ManagerNotifyService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private var timer: Timer? = null
    private val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
    // staff_id/staff_number -> name, from attendance_devices.staff_name
    // (see AttendanceApi.fetchStaffNames). Refreshed only when there's
    // a new check-in to notify about, not every idle poll — no point
    // spending a request when there's nothing to render a name for.
    // Kept across a transient fetch failure (only overwritten on a
    // non-empty result) so one flaky poll doesn't blank out names that
    // were already known.
    private var nameCache: Map<String, String> = emptyMap()

    override fun onCreate() {
        super.onCreate()
        createChannelsIfNeeded()
        startForeground(STATUS_NOTIF_ID, buildStatusNotification())
        // TimerTask.run() executes on Timer's own background thread, not
        // the main thread, so the blocking network call in poll() is safe
        // here the same way Thread{}.start() is used elsewhere in this app.
        timer = Timer().apply {
            scheduleAtFixedRate(object : TimerTask() {
                override fun run() { poll() }
            }, 0, POLL_INTERVAL_MS)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY: ask Android to restart this service if it gets
        // killed under memory pressure — same convention as
        // AttendanceForegroundService.
        return START_STICKY
    }

    override fun onDestroy() {
        timer?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun poll() {
        val since = Prefs.lastNotifiedIso(this)
        val newCheckIns = AttendanceApi.fetchNewCheckIns(since)
        if (newCheckIns.isEmpty()) return
        val freshNames = AttendanceApi.fetchStaffNames()
        if (freshNames.isNotEmpty()) nameCache = freshNames
        newCheckIns.forEach { event -> postCheckInNotification(event) }
        // Advance the cursor past the newest event we just notified
        // about (list is oldest-first, so .last() is newest).
        Prefs.setLastNotifiedIso(this, newCheckIns.last().occurredAt)
    }

    private fun postCheckInNotification(event: CheckInEvent) {
        val manager = getSystemService(NotificationManager::class.java)
        val label = nameCache[event.staffId]
            ?: event.staffNumber?.let { nameCache[it] }
            ?: event.staffNumber
            ?: event.staffId
        val whenText = try {
            timeFormat.format(Date.from(Instant.parse(event.occurredAt)))
        } catch (e: Exception) {
            event.occurredAt
        }
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, event.occurredAt.hashCode(), openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            // TODO: swap for a proper monochrome notification icon before
            // a real release — same scaffold placeholder as the other service.
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("$label checked in")
            .setContentText("At $whenText")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        manager?.notify(event.staffId.hashCode() xor event.occurredAt.hashCode(), notification)
    }

    private fun createChannelsIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(
            NotificationChannel(
                STATUS_CHANNEL_ID,
                "Manager status",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Shows when check-in notifications are active" }
        )
        manager?.createNotificationChannel(
            NotificationChannel(
                ALERT_CHANNEL_ID,
                "Staff check-ins",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = "One alert per staff check-in" }
        )
    }

    private fun buildStatusNotification(): Notification {
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, STATUS_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Watching for check-ins")
            .setContentText("You'll be notified when staff check in")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }
}
