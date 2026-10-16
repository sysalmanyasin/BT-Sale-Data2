package com.duapharma.closingwidget

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * Small encrypted cache shared by AssistantActivity and the two home-screen widgets:
 * last 3 entries saved from the app/widget, last known total credit, last Ask Dua answer.
 * Uses the same encrypted file as the Google session, so nothing is stored in plain text.
 */
object AssistantStore {
    private const val FILE = "assistant_staff_session"
    private const val MAX_RECENT = 3

    data class Entry(val title: String, val detail: String, val amount: Double, val ts: Long)

    fun prefs(context: Context): SharedPreferences {
        val app = context.applicationContext
        val key = MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return EncryptedSharedPreferences.create(
            app, FILE, key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private fun safe(context: Context): SharedPreferences? = try { prefs(context) } catch (_: Exception) { null }

    @Synchronized
    fun addEntry(context: Context, entry: Entry) {
        val p = safe(context) ?: return
        val list = recent(context).toMutableList()
        list.add(0, entry)
        val arr = JSONArray()
        list.take(MAX_RECENT).forEach {
            arr.put(JSONObject().put("t", it.title).put("d", it.detail).put("a", it.amount).put("ts", it.ts))
        }
        p.edit().putString("recent_entries", arr.toString()).apply()
    }

    fun recent(context: Context): List<Entry> {
        val raw = safe(context)?.getString("recent_entries", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let {
                    Entry(it.optString("t"), it.optString("d"), it.optDouble("a", 0.0), it.optLong("ts"))
                }
            }
        } catch (_: Exception) { emptyList() }
    }

    fun saveTotal(context: Context, value: Double) {
        safe(context)?.edit()?.putString("total_credit", value.toString())
            ?.putLong("total_credit_ts", System.currentTimeMillis())?.apply()
    }

    /** value to timestamp, or null if never fetched. */
    fun total(context: Context): Pair<Double, Long>? {
        val p = safe(context) ?: return null
        val v = p.getString("total_credit", null)?.toDoubleOrNull() ?: return null
        return v to p.getLong("total_credit_ts", 0L)
    }

    fun saveAnswer(context: Context, question: String, answer: String) {
        val plain = answer.replace(Regex("[*_#`]"), "").trim().take(700)
        safe(context)?.edit()?.putString("last_q", question.take(160))?.putString("last_a", plain)?.apply()
    }

    fun lastAnswer(context: Context): Pair<String, String>? {
        val p = safe(context) ?: return null
        val q = p.getString("last_q", null) ?: return null
        val a = p.getString("last_a", null) ?: return null
        return q to a
    }
}
