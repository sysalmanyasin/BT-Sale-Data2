package com.duapharma.mailroutine.platform

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.duapharma.mailroutine.MainActivity
import com.duapharma.mailroutine.R
import com.duapharma.mailroutine.domain.Explain
import com.duapharma.mailroutine.domain.Occurrence
import com.duapharma.mailroutine.domain.OccurrenceState
import com.duapharma.mailroutine.domain.Routine
import com.duapharma.mailroutine.send.Notifier
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Notifications carry the routine name and a status only — never addresses, subjects or bodies. */
class AndroidNotifier(private val context: Context) : Notifier {
    init {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_REMINDERS, "Reminders", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_ATTENTION, "Needs attention", NotificationManager.IMPORTANCE_HIGH))
    }

    override fun reminder(routine: Routine, occurrence: Occurrence) {
        val due = occurrence.dueAt.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("EEE HH:mm"))
        post(CH_REMINDERS, routine, occurrence, "Due $due — tap to review and send")
    }

    override fun attention(routine: Routine, occurrence: Occurrence) {
        val text = when (occurrence.state) {
            OccurrenceState.UNCERTAIN -> "Couldn't confirm this email was sent. Check Gmail before resending."
            OccurrenceState.FAILED -> "Sending failed. " + Explain.errorCode(occurrence.lastErrorCode)
            OccurrenceState.BLOCKED -> "Not sent. " + Explain.errorCode(occurrence.lastErrorCode)
            else -> Explain.state(occurrence.state)
        }
        post(CH_ATTENTION, routine, occurrence, text)
    }

    private fun post(channel: String, routine: Routine, occurrence: Occurrence, text: String) {
        val nmc = NotificationManagerCompat.from(context)
        if (!nmc.areNotificationsEnabled()) return
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_OCCURRENCE_ID, occurrence.id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pi = PendingIntent.getActivity(context, occurrence.id.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_duapharma)
            .setContentTitle(routine.name)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try { nmc.notify(occurrence.id.hashCode(), n) } catch (e: SecurityException) { /* permission revoked meanwhile */ }
    }

    companion object {
        const val CH_REMINDERS = "reminders"
        const val CH_ATTENTION = "attention"
    }
}
