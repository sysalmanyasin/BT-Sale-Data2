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
}
