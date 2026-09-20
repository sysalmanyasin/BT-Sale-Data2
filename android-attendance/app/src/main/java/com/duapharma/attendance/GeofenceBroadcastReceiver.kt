package com.duapharma.attendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * Fires from Play Services' geofence monitoring — a system-level
 * mechanism, not dependent on this app's process staying alive (that's
 * the whole reason geofencing is used instead of a web PWA's
 * watchPosition(), which dies with the tab/app). AttendanceForegroundService
 * exists on top of this for the OEM-battery-manager reasons documented
 * there, not because this receiver itself needs the app "running".
 *
 * goAsync() + a background thread: BroadcastReceivers get ~10s on the
 * main thread before Android considers them ANR'd, and posting the
 * event is a network call — never do that synchronously in onReceive.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "GeofenceReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent)
        if (geofencingEvent == null) {
            Log.w(TAG, "Null GeofencingEvent")
            return
        }
        if (geofencingEvent.hasError()) {
            Log.e(TAG, "Geofencing error code: ${geofencingEvent.errorCode}")
            return
        }

        val transition = geofencingEvent.geofenceTransition
        val eventType = when (transition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "check_in"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "check_out"
            else -> {
                Log.d(TAG, "Ignoring transition type $transition")
                return
            }
        }

        val staffId = Prefs.staffId(context)
        if (staffId == null) {
            Log.w(TAG, "Geofence fired but device has no staff set up yet — ignoring")
            return
        }

        // Debounce: absorbs GPS flapping right at the boundary (see the
        // spec's note on this) — a second ENTER within the window of the
        // last one is treated as noise, not a new punch. Recorded here,
        // the moment we commit to acting on this transition — NOT only
        // on a successful post — because postEventOrQueue can now queue
        // a failure for later retry rather than dropping it; if this
        // only updated on success, an offline outage with GPS flapping
        // at the boundary would queue the SAME arrival repeatedly (each
        // flap fails to send, never marks debounce, tries again), and
        // every duplicate would land once the phone's back online.
        if (Prefs.shouldDebounce(context, eventType)) {
            Log.d(TAG, "Debounced duplicate $eventType")
            return
        }
        Prefs.recordTransition(context, eventType)

        val triggeringLocation: Location? = geofencingEvent.triggeringLocation
        val isMock = triggeringLocation != null &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            triggeringLocation.isMock

        val pending = goAsync()
        Thread {
            try {
                val success = AttendanceApi.postEventOrQueue(
                    context = context,
                    staffId = staffId,
                    staffNumber = Prefs.staffNumber(context),
                    eventType = eventType,
                    source = "geofence",
                    lat = triggeringLocation?.latitude,
                    lng = triggeringLocation?.longitude,
                    accuracyMeters = triggeringLocation?.accuracy?.toDouble(),
                    isMockLocation = isMock,
                )
                if (success) {
                    Log.i(TAG, "Posted $eventType for $staffId")
                } else {
                    // Queued for retry by AttendanceForegroundService's
                    // periodic flush — see postEventOrQueue.
                    Log.w(TAG, "$eventType for $staffId queued — will retry, not dropped")
                }
            } finally {
                pending.finish()
            }
        }.start()
    }
}
