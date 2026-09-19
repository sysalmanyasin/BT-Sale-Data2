package com.duapharma.attendance

import android.content.Context

/**
 * Plain (unencrypted) SharedPreferences — deliberately, unlike
 * android-widget's EncryptedSharedPreferences use for a Supabase
 * refresh token. Nothing stored here is a credential: staff_id/
 * staff_number/device_label are the same values already visible in
 * Staff Registry, and this app never holds a Supabase session token
 * (see AttendanceApi.kt's header comment on why — anon-role RLS, no
 * sign-in step).
 */
object Prefs {
    private const val FILE = "attendance_prefs"
    private const val KEY_STAFF_ID = "staff_id"
    private const val KEY_STAFF_NUMBER = "staff_number"
    private const val KEY_STAFF_NAME = "staff_name"
    private const val KEY_LAST_TRANSITION_MS = "last_transition_ms"
    private const val KEY_LAST_TRANSITION_TYPE = "last_transition_type"
    private const val KEY_IS_MANAGER = "is_manager"
    private const val KEY_TRACKS_OWN_ATTENDANCE = "tracks_own_attendance"
    private const val KEY_LAST_NOTIFIED_ISO = "last_notified_iso"
    private const val DEBOUNCE_WINDOW_MS = 5 * 60 * 1000L // 5 min, see spec's "flapping near the boundary" note

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun isSetUp(context: Context): Boolean = staffId(context) != null

    fun staffId(context: Context): String? = prefs(context).getString(KEY_STAFF_ID, null)
    fun staffNumber(context: Context): String? = prefs(context).getString(KEY_STAFF_NUMBER, null)
    fun staffName(context: Context): String? = prefs(context).getString(KEY_STAFF_NAME, null)

    fun saveStaff(context: Context, staffId: String, staffNumber: String, staffName: String) {
        prefs(context).edit()
            .putString(KEY_STAFF_ID, staffId)
            .putString(KEY_STAFF_NUMBER, staffNumber)
            .putString(KEY_STAFF_NAME, staffName)
            .apply()
    }

    /** True if this transition type fired within the debounce window of
     *  the last one — caller should skip writing a duplicate event. */
    fun shouldDebounce(context: Context, transitionType: String): Boolean {
        val p = prefs(context)
        val lastMs = p.getLong(KEY_LAST_TRANSITION_MS, 0L)
        val lastType = p.getString(KEY_LAST_TRANSITION_TYPE, null)
        val now = System.currentTimeMillis()
        return lastType == transitionType && (now - lastMs) < DEBOUNCE_WINDOW_MS
    }

    fun lastTransitionType(context: Context): String? =
        prefs(context).getString(KEY_LAST_TRANSITION_TYPE, null)

    fun recordTransition(context: Context, transitionType: String) {
        prefs(context).edit()
            .putLong(KEY_LAST_TRANSITION_MS, System.currentTimeMillis())
            .putString(KEY_LAST_TRANSITION_TYPE, transitionType)
            .apply()
    }

    // ── Manager mode ─────────────────────────────────────────────────
    // A per-device local flag, not a real role/permission — this app's
    // main repo deliberately has no roles system (see its README). A
    // manager phone just skips geofencing and runs ManagerNotifyService
    // instead of AttendanceForegroundService.

    fun isManagerMode(context: Context): Boolean = prefs(context).getBoolean(KEY_IS_MANAGER, false)

    fun setManagerMode(context: Context, isManager: Boolean) {
        prefs(context).edit().putBoolean(KEY_IS_MANAGER, isManager).apply()
    }

    /** True only for a manager phone that's ALSO enrolled as a staff
     *  member on itself — i.e. it both geofences its own check-in/out
     *  AND runs ManagerNotifyService. Meaningless (ignored) when
     *  isManagerMode is false, since a plain staff phone always
     *  geofences regardless of this flag. */
    fun tracksOwnAttendance(context: Context): Boolean =
        prefs(context).getBoolean(KEY_TRACKS_OWN_ATTENDANCE, false)

    fun setTracksOwnAttendance(context: Context, tracks: Boolean) {
        prefs(context).edit().putBoolean(KEY_TRACKS_OWN_ATTENDANCE, tracks).apply()
    }

    /** occurred_at of the newest check-in already notified about, so a
     *  service restart (reboot, process death) doesn't re-fire
     *  notifications for events it already showed. */
    fun lastNotifiedIso(context: Context): String {
        val existing = prefs(context).getString(KEY_LAST_NOTIFIED_ISO, null)
        if (existing != null) return existing
        val now = java.time.Instant.now().toString()
        setLastNotifiedIso(context, now)
        return now
    }

    fun setLastNotifiedIso(context: Context, iso: String) {
        prefs(context).edit().putString(KEY_LAST_NOTIFIED_ISO, iso).apply()
    }
}
