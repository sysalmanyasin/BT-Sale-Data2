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
        if (Prefs.isManagerMode(context)) {
            Log.i("BootReceiver", "Restarting check-in notifications after boot")
            ManagerNotifyService.start(context)
        } else {
            Log.i("BootReceiver", "Re-registering geofence after boot")
            GeofenceHelper.registerFromServer(context)
            AttendanceForegroundService.start(context)
        }
    }
}
