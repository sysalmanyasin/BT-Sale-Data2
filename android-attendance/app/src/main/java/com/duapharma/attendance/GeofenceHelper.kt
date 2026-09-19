package com.duapharma.attendance

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * Registers ONE geofence — the pharmacy's location, fetched from
 * attendance_locations (falls back to a locally-cached copy if the
 * network call fails, so a re-registration after reboot doesn't
 * silently do nothing just because connectivity was briefly down).
 *
 * Called from: MainActivity after onboarding completes, and
 * BootReceiver after every device restart (Android forgets all
 * registered geofences on reboot — this is the #1 reason a geofence
 * silently "stops working" a few days in if nothing re-registers it).
 */
object GeofenceHelper {
    private const val TAG = "GeofenceHelper"
    const val GEOFENCE_ID = "pharmacy_primary"
    private const val CACHE_FILE = "geofence_cache"
    private const val KEY_LAT = "lat"
    private const val KEY_LNG = "lng"
    private const val KEY_RADIUS = "radius"

    fun registerFromServer(context: Context, onDone: (success: Boolean) -> Unit = {}) {
        Thread {
            // Best-effort device-info refresh, independent of the
            // geofence lookup below — runs on every path that calls
            // this function (initial setup, the manual "re-check
            // permissions" button, and BootReceiver after every
            // restart), so ManagerNotifyService's name lookup and
            // attendance_devices.last_seen_at both stay current without
            // a separate sync step or requiring a reinstall. Manager
            // phones skip this — they don't have a staff identity to
            // report and don't hold a Staff Registry name to send.
            val staffId = Prefs.staffId(context)
            // A notification-only manager phone has no staff identity
            // worth reporting; a dual-role one (Prefs.tracksOwnAttendance)
            // is about to geofence below, same as any staff phone, so it
            // needs this sync too.
            if (staffId != null && (!Prefs.isManagerMode(context) || Prefs.tracksOwnAttendance(context))) {
                AttendanceApi.upsertDevice(
                    staffId = staffId,
                    staffNumber = Prefs.staffNumber(context),
                    deviceLabel = android.os.Build.MODEL,
                    staffName = Prefs.staffName(context),
                )
            }
            val loc = AttendanceApi.fetchPrimaryLocation()
            if (loc != null) {
                cacheLocation(context, loc.lat, loc.lng, loc.radiusMeters)
                register(context, loc.lat, loc.lng, loc.radiusMeters, onDone)
            } else {
                Log.w(TAG, "No location from server, falling back to cache")
                val cached = readCachedLocation(context)
                if (cached != null) {
                    register(context, cached[0], cached[1], cached[2].toInt(), onDone)
                } else {
                    Log.w(TAG, "No cached location either — nothing to register yet. " +
                        "Add a row to attendance_locations from Manager > Attendance first.")
                    onDone(false)
                }
            }
        }.start()
    }

    private fun register(context: Context, lat: Double, lng: Double, radiusMeters: Int, onDone: (Boolean) -> Unit) {
        val geofence = Geofence.Builder()
            .setRequestId(GEOFENCE_ID)
            .setCircularRegion(lat, lng, radiusMeters.toFloat())
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            // A brief dwell-confirmation on ENTER would need
            // GEOFENCE_TRANSITION_DWELL + setLoiteringDelay — deliberately
            // left as plain ENTER/EXIT for now; the debounce window in
            // Prefs.kt is what actually absorbs boundary flapping (see
            // the spec's "flapping near the boundary" note), not a dwell
            // timer, so a genuine quick in-and-back-out (forgot keys,
            // stepped out again) still logs promptly instead of being
            // swallowed by a loitering delay.
            .build()

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(geofence)
            .build()

        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )

        val client: GeofencingClient = LocationServices.getGeofencingClient(context)
        try {
            client.addGeofences(request, pendingIntent)
                .addOnSuccessListener {
                    Log.i(TAG, "Geofence registered: lat=$lat lng=$lng radius=${radiusMeters}m")
                    onDone(true)
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "Geofence registration failed", e)
                    onDone(false)
                }
        } catch (e: SecurityException) {
            // ACCESS_FINE_LOCATION/ACCESS_BACKGROUND_LOCATION not granted —
            // caller (MainActivity) should never reach here if the
            // onboarding flow ran in order, but fail safe rather than crash.
            Log.e(TAG, "Missing location permission when registering geofence", e)
            onDone(false)
        }
    }

    private fun cacheLocation(context: Context, lat: Double, lng: Double, radius: Int) {
        context.getSharedPreferences(CACHE_FILE, Context.MODE_PRIVATE).edit()
            .putFloat(KEY_LAT, lat.toFloat())
            .putFloat(KEY_LNG, lng.toFloat())
            .putInt(KEY_RADIUS, radius)
            .apply()
    }

    private fun readCachedLocation(context: Context): DoubleArray? {
        val p = context.getSharedPreferences(CACHE_FILE, Context.MODE_PRIVATE)
        if (!p.contains(KEY_LAT)) return null
        return doubleArrayOf(
            p.getFloat(KEY_LAT, 0f).toDouble(),
            p.getFloat(KEY_LNG, 0f).toDouble(),
            p.getInt(KEY_RADIUS, 100).toDouble(),
        )
    }
}
