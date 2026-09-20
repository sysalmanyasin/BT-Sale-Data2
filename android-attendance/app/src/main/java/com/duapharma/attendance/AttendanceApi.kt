package com.duapharma.attendance

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks straight to Supabase's PostgREST endpoint with the anon key —
 * same raw HttpURLConnection + JSONObject style as android-widget's
 * WidgetAuthManager.kt, no OkHttp/Retrofit/Supabase-Kotlin dependency.
 *
 * No sign-in step, unlike WidgetAuthManager: attendance_events/
 * attendance_devices/attendance_locations run on anon-role RLS with
 * USING(true) — see the attendance_rls_fix migration file under
 * supabase/migrations in the main repo for why (this app has no real backend-enforced
 * per-device identity; "this device only writes its own staff_id" is
 * enforced by this file always sending the locally-configured
 * staff_id, not by anything the server checks).
 *
 * All functions here do blocking network I/O — always call from a
 * background thread (GeofenceBroadcastReceiver's goAsync()+thread,
 * or MainActivity's own background thread helper), never the main
 * thread.
 */
object AttendanceApi {
    private const val TAG = "AttendanceApi"

    private fun restUrl(path: String) = "${BuildConfig.SUPABASE_URL}/rest/v1/$path"

    private fun openConnection(urlStr: String, method: String): HttpURLConnection {
        val connection = URL(urlStr).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
        connection.setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
        connection.setRequestProperty("Content-Type", "application/json")
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        return connection
    }

    /** Insert one attendance_events row. Returns true on success. */
    fun postEvent(
        staffId: String,
        staffNumber: String?,
        eventType: String, // "check_in" | "check_out"
        source: String,    // "geofence" | "qr" | "manual"
        lat: Double? = null,
        lng: Double? = null,
        accuracyMeters: Double? = null,
        isMockLocation: Boolean = false,
    ): Boolean {
        val connection = openConnection(restUrl("attendance_events"), "POST")
        return try {
            connection.setRequestProperty("Prefer", "return=minimal")
            connection.doOutput = true
            val body = JSONObject().apply {
                put("staff_id", staffId)
                if (staffNumber != null) put("staff_number", staffNumber)
                put("event_type", eventType)
                put("source", source)
                if (lat != null) put("lat", lat)
                if (lng != null) put("lng", lng)
                if (accuracyMeters != null) put("accuracy_meters", accuracyMeters)
                put("is_mock_location", isMockLocation)
                put("created_by", "device")
            }
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val ok = connection.responseCode in 200..299
            if (!ok) Log.w(TAG, "postEvent failed: HTTP ${connection.responseCode}")
            ok
        } catch (e: Exception) {
            Log.e(TAG, "postEvent error", e)
            false
        } finally {
            connection.disconnect()
        }
    }

    /** Same as postEvent, but on failure queues the event in Prefs for
     *  AttendanceForegroundService's periodic flushPendingEvents() to
     *  retry later, instead of it being silently dropped (the previous
     *  behavior). Used by GeofenceBroadcastReceiver specifically, since
     *  that's the unattended path — nobody's watching to notice a
     *  failure or manually retry it. MainActivity's QR flow stays on
     *  plain postEvent: a human is standing right there and can just
     *  rescan, no queue needed. */
    fun postEventOrQueue(
        context: Context,
        staffId: String,
        staffNumber: String?,
        eventType: String,
        source: String,
        lat: Double? = null,
        lng: Double? = null,
        accuracyMeters: Double? = null,
        isMockLocation: Boolean = false,
    ): Boolean {
        val success = postEvent(staffId, staffNumber, eventType, source, lat, lng, accuracyMeters, isMockLocation)
        if (!success) {
            val event = JSONObject().apply {
                put("staff_id", staffId)
                if (staffNumber != null) put("staff_number", staffNumber)
                put("event_type", eventType)
                put("source", source)
                if (lat != null) put("lat", lat)
                if (lng != null) put("lng", lng)
                if (accuracyMeters != null) put("accuracy_meters", accuracyMeters)
                put("is_mock_location", isMockLocation)
                put("created_by", "device")
            }
            Prefs.enqueuePendingEvent(context, event)
            Log.w(TAG, "Queued $eventType for $staffId for later retry (offline or server error)")
        }
        return success
    }

    /** Retries every queued event, in the order they failed, removing
     *  each from the queue only once it actually succeeds — a partial
     *  flush (some succeed, some still can't reach the server) leaves
     *  the rest queued for next time rather than losing them. Called
     *  periodically by AttendanceForegroundService while it's alive.
     *  Deliberately resends the exact body captured when the event was
     *  first queued (including its original occurred_at, added
     *  server-side at insert time — a flush doesn't re-timestamp a
     *  late-arriving punch as "now"). */
    fun flushPendingEvents(context: Context) {
        val events = Prefs.pendingEvents(context)
        if (events.length() == 0) return
        val stillPending = JSONArray()
        for (i in 0 until events.length()) {
            val event = events.getJSONObject(i)
            val connection = openConnection(restUrl("attendance_events"), "POST")
            val ok = try {
                connection.setRequestProperty("Prefer", "return=minimal")
                connection.doOutput = true
                connection.outputStream.use { it.write(event.toString().toByteArray(Charsets.UTF_8)) }
                connection.responseCode in 200..299
            } catch (e: Exception) {
                false
            } finally {
                connection.disconnect()
            }
            if (ok) {
                Log.i(TAG, "Flushed queued event: $event")
            } else {
                stillPending.put(event)
            }
        }
        if (stillPending.length() != events.length()) {
            Prefs.replacePendingEvents(context, stillPending)
        }
    }

    /** First active attendance_locations row, or null if none configured yet. */
    fun fetchPrimaryLocation(): AttendanceLocation? {
        val connection = openConnection(
            restUrl("attendance_locations?active=eq.true&select=id,name,lat,lng,radius_meters&limit=1"),
            "GET",
        )
        return try {
            if (connection.responseCode !in 200..299) {
                Log.w(TAG, "fetchPrimaryLocation failed: HTTP ${connection.responseCode}")
                return null
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val arr = JSONArray(body)
            if (arr.length() == 0) return null
            val row = arr.getJSONObject(0)
            AttendanceLocation(
                id = row.getString("id"),
                name = row.getString("name"),
                lat = row.getDouble("lat"),
                lng = row.getDouble("lng"),
                radiusMeters = row.getInt("radius_meters"),
            )
        } catch (e: Exception) {
            Log.e(TAG, "fetchPrimaryLocation error", e)
            null
        } finally {
            connection.disconnect()
        }
    }


    /** Upsert this device's row (staff_id + label + name), so the
     *  Manager page can see it, last_seen_at stays fresh, and the
     *  ntfy notification trigger can show a real name instead of a
     *  bare staff number. Best-effort — a failure here never blocks
     *  check-in/out. */
    fun upsertDevice(staffId: String, staffNumber: String?, deviceLabel: String, staffName: String? = null) {
        val connection = openConnection(restUrl("attendance_devices"), "POST")
        try {
            connection.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal")
            connection.doOutput = true
            val body = JSONObject().apply {
                put("staff_id", staffId)
                if (staffNumber != null) put("staff_number", staffNumber)
                if (staffName != null) put("staff_name", staffName)
                put("device_label", deviceLabel)
                put("active", true)
                put("last_seen_at", java.time.Instant.now().toString())
            }
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            connection.responseCode // trigger the request
        } catch (e: Exception) {
            Log.w(TAG, "upsertDevice error (non-fatal)", e)
        } finally {
            connection.disconnect()
        }
    }

    // fetchStaffNames was removed here -- it existed only to resolve a
    // name for ManagerNotifyService's local notification text, which
    // no longer exists (ntfy push replaced it). Name resolution for
    // ntfy's notification text is handled in SQL instead, inside the
    // attendance_notify_manager() trigger itself -- see the
    // attendance_notify_manager_ntfy migration.


    /** Server-side manager PIN check via a SECURITY DEFINER Postgres
     *  function (see migration 20260918120500_attendance_manager_pin.sql)
     *  — the hash itself is never selectable through this REST API, so
     *  this can't be brute-forced offline by reading the table
     *  directly the way every other anon-open table in this schema
     *  can be. Fails closed (false) on any error — a network hiccup
     *  should never accidentally grant manager access. */
    fun verifyManagerPin(pin: String): Boolean {
        val connection = openConnection(restUrl("rpc/attendance_verify_manager_pin"), "POST")
        return try {
            connection.doOutput = true
            val body = JSONObject().apply { put("candidate", pin) }
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode !in 200..299) {
                Log.w(TAG, "verifyManagerPin failed: HTTP ${connection.responseCode}")
                return false
            }
            connection.inputStream.bufferedReader().use { it.readText() }.trim() == "true"
        } catch (e: Exception) {
            Log.e(TAG, "verifyManagerPin error", e)
            false
        } finally {
            connection.disconnect()
        }
    }
}

data class AttendanceLocation(
    val id: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val radiusMeters: Int,
)

