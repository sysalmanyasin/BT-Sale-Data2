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
import java.util.Calendar

/**
 * Home-screen widget showing "Total Outstanding Credits" — the same
 * grand total cover-dashboard.js's tile shows (Staff Credit + Jazz Cash
 * + Patty/Expenses + every Misc/"Other Section"), plus a ranked list of
 * which staff member owes the most — mirroring js/analytics.js's
 * getCreditSectionData() and js/cover-dashboard.js's ranked Staff Credit
 * table.
 *
 * Same one-JSON-blob situation as the Sales widget (see that file's
 * header) — this fetches only the `manager`, `ledger`, and
 * `ledgerCustomTypes` keys out of `bt_salesdata.payload` via a
 * PostgREST JSON-path select, not the whole document.
 *
 * KNOWN SIMPLIFICATIONS vs. the exact web logic (documented, not
 * silently dropped):
 *  - Month selection mirrors analytics.js's latestStaffCreditMonth()
 *    (the most recent Month_Year in manager.credit, not later than the
 *    current calendar month, that has real activity). It does NOT fall
 *    back further to latestManagerMonth() (which also checks Salary/
 *    Generic/Petty/Incentive activity) — if Staff Credit itself has no
 *    data for any eligible month, this widget shows "No activity yet"
 *    even in a case where the web app's fallback chain might still find
 *    a month via one of those other domains.
 *  - Jazz Cash / Patty / Misc Section totals sum EVERY entry's category
 *    sign — correct and equivalent to LedgerStore.getCurrentBalance(),
 *    since addition doesn't care about date order, but this widget
 *    doesn't validate an entry's categoryId against a category list the
 *    way the web app implicitly does; an entry with an unrecognized
 *    categoryId contributes 0 here instead of possibly erroring there.
 */
class StaffCreditWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val SB_URL = "https://wetbugzzchkghpzmowod.supabase.co"
        private const val SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM"
        private const val CREDIT_ENDPOINT =
            "$SB_URL/rest/v1/bt_salesdata?select=payload-%3Emanager,payload-%3Eledger,payload-%3EledgerCustomTypes&id=eq.main"

        private const val APP_URL = "https://bt.duapharma.com/"

        const val ACTION_REFRESH = "com.duapharma.inventorywidget.ACTION_REFRESH_STAFFCREDIT"

        private val MONTH_NAMES = listOf(
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        )

        // Same static built-in category sign tables as js/ledger-store.js's
        // LEDGER_CATEGORIES — keep in sync if that file's config changes.
        private val JAZZCASH_SIGNS = mapOf(
            "credit" to 1, "debit" to -1, "withdrawal" to -1, "commission" to -1, "transfer" to -1
        )
        private val EXPENSE_SIGNS = mapOf(
            "bill" to 1, "fuel" to 1, "soap" to 1, "refresh" to 1,
            "extra" to 1, "guardIncentive" to 1, "pattyHO" to -1
        )
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id -> pushViews(context, appWidgetManager, id, buildPlaceholderViews(context, id)) }

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val summary = try { fetchCreditSummary() } catch (e: Exception) { null }
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
            val ids = manager.getAppWidgetIds(ComponentName(context, StaffCreditWidgetProvider::class.java))
            onUpdate(context, manager, ids)
        } else {
            super.onReceive(context, intent)
        }
    }

    // ── View building ────────────────────────────────────────────────

    private val rowIds = listOf(
        R.id.staffCreditWidgetRow1 to R.id.staffCreditWidgetRow1Val,
        R.id.staffCreditWidgetRow2 to R.id.staffCreditWidgetRow2Val,
        R.id.staffCreditWidgetRow3 to R.id.staffCreditWidgetRow3Val,
        R.id.staffCreditWidgetRow4 to R.id.staffCreditWidgetRow4Val,
    )

    private fun buildPlaceholderViews(context: Context, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.staffcredit_widget)
        wireClicks(context, views, appWidgetId)
        views.setTextViewText(R.id.staffCreditWidgetUpdatedAt, "Updating…")
        rowIds.forEach { (nameId, valId) -> views.setTextViewText(nameId, ""); views.setTextViewText(valId, "") }
        return views
    }

    private fun buildResultViews(context: Context, appWidgetId: Int, s: CreditSummary?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.staffcredit_widget)
        wireClicks(context, views, appWidgetId)

        if (s == null) {
            views.setTextViewText(R.id.staffCreditWidgetUpdatedAt, "Couldn't reach credit data — tap to open app")
            rowIds.forEach { (nameId, valId) -> views.setTextViewText(nameId, ""); views.setTextViewText(valId, "") }
        } else {
            val sign = if (s.grandTotal < 0) "−" else ""
            views.setTextViewText(
                R.id.staffCreditWidgetUpdatedAt,
                sign + "₨" + fc(Math.abs(s.grandTotal)) + " · " + (s.month.ifEmpty { "—" })
            )
            rowIds.forEachIndexed { i, (nameId, valId) ->
                val row = s.topStaff.getOrNull(i)
                views.setTextViewText(nameId, row?.name ?: "")
                views.setTextViewText(valId, row?.let { "₨" + fc(it.net) } ?: "")
            }
        }
        return views
    }

    private fun wireClicks(context: Context, views: RemoteViews, appWidgetId: Int) {
        val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL))
        val openPending = PendingIntent.getActivity(
            context, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.staffCreditWidgetRoot, openPending)

        val refreshIntent = Intent(context, StaffCreditWidgetProvider::class.java).apply { action = ACTION_REFRESH }
        val refreshPending = PendingIntent.getBroadcast(
            context, appWidgetId, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.staffCreditWidgetRefreshBtn, refreshPending)
    }

    private fun pushViews(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, views: RemoteViews) {
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun piImmutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    // ── Data fetch + calc ────────────────────────────────────────────

    data class StaffRow(val name: String, val net: Double)
    data class CreditSummary(val month: String, val grandTotal: Double, val topStaff: List<StaffRow>)

    private fun n(v: Any?): Double {
        if (v == null || v == JSONObject.NULL) return 0.0
        return when (v) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull() ?: 0.0
            else -> 0.0
        }
    }

    private fun ni(v: Any?): Long = Math.round(n(v))

    private fun fc(v: Double): String = String.format(java.util.Locale.US, "%,d", Math.round(v))

    private fun monthSortVal(monthYear: String): Int {
        val parts = monthYear.trim().split(" ")
        if (parts.size < 2) return -1
        val idx = MONTH_NAMES.indexOf(parts[0])
        val yr = parts[1].toIntOrNull() ?: return -1
        return if (idx >= 0) yr * 12 + idx else -1
    }

    private fun currentMonthVal(): Int {
        val cal = Calendar.getInstance()
        return cal.get(Calendar.YEAR) * 12 + cal.get(Calendar.MONTH)
    }

    // Sum of one ledger's opening balance + every entry's signed amount —
    // equivalent to LedgerStore.getCurrentBalance(ledgerType), since
    // summation doesn't depend on date order.
    private fun ledgerBalance(
        entries: JSONArray, ledgerType: String, openingBalances: JSONObject?, signs: Map<String, Int>
    ): Double {
        var bal = openingBalances?.let { n(it.opt(ledgerType)) } ?: 0.0
        for (i in 0 until entries.length()) {
            val e = entries.optJSONObject(i) ?: continue
            if (e.optString("ledgerType") != ledgerType) continue
            val catId = e.optString("categoryId")
            val sign = signs[catId] ?: continue // unrecognized category — see class doc
            bal += sign * n(e.opt("amount"))
        }
        return bal
    }

    private fun fetchCreditSummary(): CreditSummary? {
        val conn = URL(CREDIT_ENDPOINT).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("apikey", SB_KEY)
        conn.setRequestProperty("Authorization", "Bearer $SB_KEY")
        conn.connectTimeout = 10000
        conn.readTimeout = 10000

        val body = conn.inputStream.use { stream -> BufferedReader(InputStreamReader(stream)).readText() }
        val rows = JSONArray(body)
        if (rows.length() == 0) return null
        val root = rows.getJSONObject(0)

        val manager = root.optJSONObject("manager")
        val creditByMonth = manager?.optJSONObject("credit")

        // ── 1. Pick the latest month with real Staff Credit activity ──
        var my = ""
        if (creditByMonth != null) {
            val current = currentMonthVal()
            var bestVal = Int.MIN_VALUE
            val keys = creditByMonth.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val v = monthSortVal(key)
                if (v > current) continue
                val arr = creditByMonth.optJSONArray(key) ?: continue
                if (!monthHasCreditData(arr)) continue
                if (v > bestVal) { bestVal = v; my = key }
            }
        }

        // ── 2. Staff rows for that month ───────────────────────────────
        val staffRows = mutableListOf<StaffRow>()
        if (my.isNotEmpty()) {
            val arr = creditByMonth?.optJSONArray(my)
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val emp = arr.optJSONObject(i) ?: continue
                    val entriesTotal = emp.optJSONArray("entries")?.let { entries ->
                        (0 until entries.length()).sumOf { j -> ni(entries.optJSONObject(j)?.opt("amount")) }
                    } ?: 0L
                    val net = ni(emp.opt("prevBal")) + entriesTotal - ni(emp.opt("salary")) - ni(emp.opt("lessGeneric"))
                    if (net != 0L) staffRows.add(StaffRow(emp.optString("name", "—"), net.toDouble()))
                }
            }
        }
        val staffTotal = staffRows.sumOf { it.net }
        val rankedStaff = staffRows.sortedByDescending { it.net }

        // ── 3. Jazz Cash + Patty/Expenses (continuous, all-time, not
        //      month-scoped — same as getCreditSectionData()) ──────────
        val ledger = root.optJSONObject("ledger")
        val entries = ledger?.optJSONArray("entries") ?: JSONArray()
        val openingBalances = ledger?.optJSONObject("openingBalances")

        val jazzCashTotal = ledgerBalance(entries, "jazzcash", openingBalances, JAZZCASH_SIGNS)
        val pattyTotal = ledgerBalance(entries, "expense", openingBalances, EXPENSE_SIGNS)

        // ── 4. Every user-created "Other Section" (custom ledger types) ─
        val customTypes = root.optJSONObject("ledgerCustomTypes")
        var otherSectionsTotal = 0.0
        if (customTypes != null) {
            val keys = customTypes.keys()
            while (keys.hasNext()) {
                val ledgerType = keys.next()
                val def = customTypes.optJSONObject(ledgerType) ?: continue
                val cats = def.optJSONArray("categories") ?: continue
                val signs = mutableMapOf<String, Int>()
                for (i in 0 until cats.length()) {
                    val c = cats.optJSONObject(i) ?: continue
                    signs[c.optString("id")] = if (n(c.opt("sign")) < 0) -1 else 1
                }
                otherSectionsTotal += ledgerBalance(entries, ledgerType, openingBalances, signs)
            }
        }

        val grandTotal = staffTotal + jazzCashTotal + pattyTotal + otherSectionsTotal
        return CreditSummary(my, grandTotal, rankedStaff)
    }

    // Mirrors analytics.js's hasCreditData(): true if any employee in
    // this month's credit array has a nonzero prevBal/salary/lessGeneric,
    // or a real dated entry.
    private fun monthHasCreditData(arr: JSONArray): Boolean {
        for (i in 0 until arr.length()) {
            val emp = arr.optJSONObject(i) ?: continue
            if (ni(emp.opt("prevBal")) != 0L || ni(emp.opt("salary")) != 0L || ni(emp.opt("lessGeneric")) != 0L) return true
            val entries = emp.optJSONArray("entries") ?: continue
            for (j in 0 until entries.length()) {
                val e = entries.optJSONObject(j) ?: continue
                if (ni(e.opt("amount")) != 0L || e.has("desc") || e.has("date")) return true
            }
        }
        return false
    }
}
