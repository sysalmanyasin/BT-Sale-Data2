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
import java.util.Timer
import java.util.TimerTask

/**
 * A geofence registered via GeofencingClient fires at the OS/Play-
 * Services level and does NOT strictly require this app's process to
 * stay alive — but several OEM battery managers (MIUI/ColorOS/Vivo/
 * One UI) kill backgrounded apps hard enough to interfere with that
 * anyway, more often than any documented Android API limitation does
 * (see the attendance spec's permissions section). Running as a
 * foreground service — an explicit signal to the OS that this process
 * is doing something the user asked for — is the standard mitigation.
 * The actual check-in/out logic lives in GeofenceBroadcastReceiver;
 * this service ALSO runs a periodic retry-queue flush (see
 * FLUSH_INTERVAL_MS below) for events that failed to post the first
 * time — piggybacking on a service that's already alive for the
 * geofence-reliability reason above, rather than a second dedicated
 * service (which is exactly the polling-service pattern removed when
 * ManagerNotifyService was retired in favor of ntfy push).
 *
 * The persistent notification this requires is mandatory, not
 * optional — that's the whole mechanism (a foreground service without
 * a visible notification isn't really "foreground" in the sense that
 * protects it).
 */
class AttendanceForegroundService : Service() {

    companion object {
        private const val CHANNEL_ID = "attendance_tracking"
        private const val NOTIF_ID = 1001
        private const val FLUSH_INTERVAL_MS = 3 * 60 * 1000L // 3 min — frequent enough that a queued event isn't stuck long once back online, infrequent enough not to matter for battery

        fun start(context: Context) {
            val intent = Intent(context, AttendanceForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private var flushTimer: Timer? = null

    override fun onCreate() {
        super.onCreate()
        createChannelIfNeeded()
        startForeground(NOTIF_ID, buildNotification())
        // First attempt shortly after start (covers "was offline all
        // night, just regained signal on boot"), then every
        // FLUSH_INTERVAL_MS after that for the rest of this service's
        // lifetime.
        flushTimer = Timer().apply {
            scheduleAtFixedRate(object : TimerTask() {
                override fun run() {
                    AttendanceApi.flushPendingEvents(applicationContext)
                }
            }, 10_000L, FLUSH_INTERVAL_MS)
        }
    }

    override fun onDestroy() {
        flushTimer?.cancel()
        flushTimer = null
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY: ask Android to restart this service if it gets
        // killed under memory pressure (best-effort — OEM battery
        // managers can still override this).
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Attendance tracking",
            NotificationManager.IMPORTANCE_LOW, // low, not default — no sound/heads-up for a background-status notification
        ).apply {
            description = "Shows when automatic attendance check-in/out is active"
        }
        manager?.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            // TODO: swap for a proper monochrome notification icon
            // (res/drawable, white silhouette on transparent) before a
            // real release — this system icon is a scaffold placeholder.
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Attendance tracking active")
            .setContentText("Automatic check-in/out is running")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }
}
