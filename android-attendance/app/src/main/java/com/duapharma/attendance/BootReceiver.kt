package com.duapharma.attendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Android forgets every registered geofence on reboot — without this,
 * "auto attendance" quietly stops working the first time a staff
 * member's phone restarts (battery died overnight, OS update, etc.)
 * and nobody notices until someone checks the Manager page and finds
 * a multi-day gap.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!Prefs.isSetUp(context)) {
            Log.d("BootReceiver", "Device not set up yet — nothing to re-register")
            return
        }
        // Same "does this phone geofence" logic as MainActivity's
        // needsGeofence() — every plain staff phone does, and so does
        // a dual-role manager (Prefs.tracksOwnAttendance). A
        // notification-only manager phone has nothing on THIS app's
        // side to restart after boot at all — check-in notifications
        // come from the separate ntfy app now, which handles its own
        // reconnection independently of this app's lifecycle.
        val needsGeofence = !Prefs.isManagerMode(context) || Prefs.tracksOwnAttendance(context)
        if (needsGeofence) {
            Log.i("BootReceiver", "Re-registering geofence after boot")
            GeofenceHelper.registerFromServer(context)
            AttendanceForegroundService.start(context)
        } else {
            Log.d("BootReceiver", "Notification-only manager phone — nothing to restart here")
        }
    }
}
