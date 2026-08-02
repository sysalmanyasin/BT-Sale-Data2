package com.duapharma.inventorywidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Home-screen widget showing the latest Closing shift summary — Carried
 * CC, Deposits, Book Bills, Manual Returns — the same figures
 * cover-dashboard.js's "Latest Closing Summary" tile shows (built on
 * ClosingBridge.getFullDb()).
 *
 * Unlike Sales/Staff Credit (which live in bt_salesdata's single JSON
 * blob), Closing's own data is already normalized Postgres tables —
 * js/closing-bridge.js reads `sheets`/`credit_ledger`/`settings`/
 * `activity_log` straight from the SAME Supabase project (see that
 * file's header: it migrated off a Dropbox export years ago). This
 * widget only needs `sheets` (key, data), queried the same direct way.
 *
 * KNOWN SIMPLIFICATIONS vs. the exact web logic (documented, not
 * silently dropped):
 *  - Only the most recent SHEETS_FETCH_LIMIT rows (ordered by key desc)
 *    are fetched, to keep this a light, single REST call instead of
 *    downloading the full shift history. _closingBookBillsAndReturnsSince
 *    walks backward from the latest shift to the last "Final" closing —
 *    if that Final closing is further back than this window, Book
 *    Bills/Manual Returns will undercount until the next Final is saved
 *    (the app itself has the same "resets at the next Final" behavior,
 *    just with a longer lookback).
 *  - "Saved by" (from activity_log) is skipped — would need a second
 *    query.
 *  - Sorting uses each row's `seq` field if present, else the same
 *    Night/Morning/Evening fallback order _shiftSeq() uses.
 */
class ClosingWidgetProvider : AppWidgetProvider() {

    companion object {
        // Same Supabase project as Sales/Staff Credit, and the same one
        // ClosingBridge itself queries (js/closing-bridge.js).
        private const val SB_URL = "https://wetbugzzchkghpzmowod.supabase.co"
        private const val SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM"
        private const val SHEETS_FETCH_LIMIT = 30
        private const val SHEETS_ENDPOINT =
            "$SB_URL/rest/v1/sheets?select=key,data&order=key.desc&limit=$SHEETS_FETCH_LIMIT"

        private const val APP_URL = "https://bt.duapharma.com/"

        const val ACTION_REFRESH = "com.duapharma.inventorywidget.ACTION_REFRESH_CLOSING"
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id -> pushViews(context, appWidgetManager, id, buildPlaceholderViews(context, id)) }

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val summary = try { fetchClosingSummary() } catch (e: Exception) { null }
            try {
                appWidgetIds.forEach { id -> pushViews(context, appWidgetManager, id, buildResultViews(context, id, summary)) }
            } finally {
                pendingResult.finish()
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ClosingWidgetProvider::class.java))
            onUpdate(context, manager, ids)
        } else {
            super.onReceive(context, intent)
        }
    }

    // ── View building ────────────────────────────────────────────────

    private fun buildPlaceholderViews(context: Context, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.closing_widget)
        wireClicks(context, views, appWidgetId)
        views.setTextViewText(R.id.closingWidgetUpdatedAt, "Updating…")
        listOf(
            R.id.closingWidgetRow1Val, R.id.closingWidgetRow2Val,
            R.id.closingWidgetRow3Val, R.id.closingWidgetRow4Val
        ).forEach { views.setTextViewText(it, "") }
        return views
    }

    private fun buildResultViews(context: Context, appWidgetId: Int, s: ClosingSummary?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.closing_widget)
        wireClicks(context, views, appWidgetId)

        if (s == null) {
            views.setTextViewText(R.id.closingWidgetUpdatedAt, "Couldn't reach Closing — tap to open app")
            listOf(
                R.id.closingWidgetRow1Val, R.id.closingWidgetRow2Val,
                R.id.closingWidgetRow3Val, R.id.closingWidgetRow4Val
            ).forEach { views.setTextViewText(it, "") }
        } else {
            views.setTextViewText(R.id.closingWidgetUpdatedAt, s.dateShift)
            views.setTextViewText(R.id.closingWidgetRow1Val, "Rs. " + fc(s.carriedCC))
            views.setTextViewText(R.id.closingWidgetRow2Val, "Rs. " + fc(s.deposits))
            views.setTextViewText(R.id.closingWidgetRow3Val, "Rs. " + fc(s.bookBills))
            views.setTextViewText(R.id.closingWidgetRow4Val, "Rs. " + fc(s.manualReturns))
        }
        return views
    }

    private fun wireClicks(context: Context, views: RemoteViews, appWidgetId: Int) {
        val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL))
        val openPending = PendingIntent.getActivity(
            context, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.closingWidgetRoot, openPending)

        val refreshIntent = Intent(context, ClosingWidgetProvider::class.java).apply { action = ACTION_REFRESH }
        val refreshPending = PendingIntent.getBroadcast(
            context, appWidgetId, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.closingWidgetRefreshBtn, refreshPending)
    }

    private fun pushViews(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, views: RemoteViews) {
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun piImmutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    // ── Data fetch + calc ────────────────────────────────────────────

    data class ClosingSummary(
        val dateShift: String, val carriedCC: Double,
        val deposits: Double, val bookBills: Double, val manualReturns: Double
    )

    private fun n(v: Any?): Double {
        if (v == null || v == JSONObject.NULL) return 0.0
        return when (v) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull() ?: 0.0
            else -> 0.0
        }
    }

    private fun fc(v: Double): String = String.format(java.util.Locale.US, "%,d", Math.round(v))

    // Mirrors cover-dashboard.js's _shiftSeq(): tie-break fallback order
    // when a sheet record has no explicit numeric `seq`.
    private fun shiftFallbackSeq(shift: String): Int = when (shift) {
        "Night" -> 10
        "Evening" -> 9999
        else -> 20 // "Morning" and anything else
    }

    // Mirrors _sheetSortKey(): "<date>_<seq padded to 6>" as a
    // lexically-sortable string, so "2026-08-02_000020" < "2026-08-02_009999".
    private fun sortKey(key: String, rec: JSONObject): String {
        val parts = key.split("_")
        val date = parts.getOrElse(0) { "" }
        val shift = parts.getOrElse(1) { "" }
        val seq = if (rec.has("seq") && rec.get("seq") is Number) (rec.get("seq") as Number).toInt() else shiftFallbackSeq(shift)
        return date + "_" + seq.toString().padStart(6, '0')
    }

    private fun fetchClosingSummary(): ClosingSummary? {
        val conn = URL(SHEETS_ENDPOINT).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("apikey", SB_KEY)
        conn.setRequestProperty("Authorization", "Bearer $SB_KEY")
        conn.connectTimeout = 10000
        conn.readTimeout = 10000

        val body = conn.inputStream.use { stream -> BufferedReader(InputStreamReader(stream)).readText() }
        val rows = JSONArray(body)
        if (rows.length() == 0) return null

        // key -> rec, filtering out drafts (draft !== true), same as
        // _latestRealSheet()'s keys filter.
        data class Sheet(val key: String, val rec: JSONObject)
        val sheets = mutableListOf<Sheet>()
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            val key = row.optString("key")
            val rec = row.optJSONObject("data") ?: continue
            sheets.add(Sheet(key, rec))
        }
        // Draft filter: keep only rec.draft !== true, matching
        // _latestRealSheet()'s `rec.draft !== true` check exactly.
        val real = sheets.filter { !it.rec.optBoolean("draft", false) }
        if (real.isEmpty()) return null

        val sorted = real.sortedBy { sortKey(it.key, it.rec) }
        val latest = sorted.last()
        val parts = latest.key.split("_")
        val date = parts.getOrElse(0) { "" }
        val shift = parts.getOrElse(1) { "" }

        // Walk backward from latest to the last 'final' closing inclusive,
        // summing inBook1+inBook2 (Book Bills) and posRet1+posRet2+posRet3
        // (Manual Returns) — mirrors _closingBookBillsAndReturnsSince().
        var totalBooks = 0.0
        var totalManRet = 0.0
        val latestIdx = sorted.indexOfFirst { it.key == latest.key }
        for (i in latestIdx downTo 0) {
            val rec = sorted[i].rec
            totalBooks += n(rec.opt("inBook1")) + n(rec.opt("inBook2"))
            totalManRet += n(rec.opt("posRet1")) + n(rec.opt("posRet2")) + n(rec.opt("posRet3"))
            if (rec.optString("profileMode") == "final") break
        }

        val carriedCC = n(latest.rec.opt("outPrevCC"))
        val deposits = n(latest.rec.opt("outTotalF"))
        val dateShiftLabel = formatDate(date) + " · " + shift

        return ClosingSummary(dateShiftLabel, carriedCC, deposits, totalBooks, totalManRet)
    }

    private fun formatDate(iso: String): String {
        // iso like "2026-08-02" -> "2 Aug 2026", matching _clFmtDate()'s
        // en-PK short-month formatting closely enough for a widget line.
        return try {
            val p = iso.split("-")
            val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
            val y = p[0]; val m = p[1].toInt(); val d = p[2].toInt()
            "$d ${months[m - 1]} $y"
        } catch (e: Exception) { iso }
    }
}
