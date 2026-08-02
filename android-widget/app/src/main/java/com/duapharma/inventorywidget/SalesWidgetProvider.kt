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
 * Home-screen widget showing the latest month's sale total, broken down
 * the same way Cover Dashboard's "Latest Month Total Sale" card does
 * (js/cover-dashboard.js's _monthSaleBreakdown()) — Cash, Banks, Credit
 * Clients (incl. free issue), and Customers.
 *
 * Unlike the Inventory widget, this app's data isn't in its own
 * Postgres table — the whole app state (MONTHLY/DAILY/STAFF/etc.) is
 * synced as ONE JSON blob in `bt_salesdata`'s `payload` column (see
 * js/supabase.js's _buildPayload()/SB_TABLE). Rather than downloading
 * that entire blob (which also holds ledger data, staff records, notes,
 * years of daily entries…), this uses a PostgREST JSON-path select —
 * `?select=payload->monthly` — so Postgres itself only returns the
 * `monthly` array, not the rest of the document.
 *
 * KNOWN SIMPLIFICATIONS vs. the web app's exact math (documented, not
 * silently dropped):
 *  - mBanks()/creditSales() in js/config.js also fold in any custom
 *    fields added via "Manage Fields" (_fmCustom) tagged as a bank or
 *    credit-client column. This widget only sums the static BANK_COLS/
 *    CLIENT_COLS lists — if custom bank/credit fields are in use, the
 *    Banks/Credit figures here will undercount by whatever those carry.
 *  - The "(till DD Mon)" suffix on the month label (which day's data the
 *    total reflects) needs the DAILY array too; skipped here to keep
 *    the fetch to one JSON path.
 */
class SalesWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val SB_URL = "https://wetbugzzchkghpzmowod.supabase.co"
        private const val SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM"
        private const val MONTHLY_ENDPOINT =
            "$SB_URL/rest/v1/bt_salesdata?select=payload-%3Emonthly&id=eq.main"

        private const val APP_URL = "https://bt.duapharma.com/"

        const val ACTION_REFRESH = "com.duapharma.inventorywidget.ACTION_REFRESH_SALES"

        // Same static lists as js/config.js's BANK_COLS / CLIENT_COLS.
        // Keep these in sync if the web app's column lists ever change.
        private val BANK_COLS = listOf("HBL", "MCB", "Alfala Bank", "Bank Al Habib", "Meezan Bank (Paysa)")
        private val CLIENT_COLS = listOf(
            "PSO", "NESPAK", "PARCO", "TEPA", "LDA", "Gourmet", "Wapda Hospital", "BTH",
            "Berger Paints", "Ecolean PK", "Style Textile", "Syed Babar Ali Foundation",
            "Rahnuma NGO", "Health Pass", "Nisar Spinning Mills", "Food Panda",
            "Askari Bank", "Askari Bank Returns"
        )
        private val MONTH_NAMES = listOf(
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        )
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id -> pushViews(context, appWidgetManager, id, buildPlaceholderViews(context, id)) }

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val summary = try { fetchSalesSummary() } catch (e: Exception) { null }
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
            val ids = manager.getAppWidgetIds(ComponentName(context, SalesWidgetProvider::class.java))
            onUpdate(context, manager, ids)
        } else {
            super.onReceive(context, intent)
        }
    }

    // ── View building ────────────────────────────────────────────────

    private fun buildPlaceholderViews(context: Context, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.sales_widget)
        wireClicks(context, views, appWidgetId)
        views.setTextViewText(R.id.salesWidgetUpdatedAt, "Updating…")
        listOf(
            R.id.salesWidgetRow1Val, R.id.salesWidgetRow2Val,
            R.id.salesWidgetRow3Val, R.id.salesWidgetRow4Val
        ).forEach { views.setTextViewText(it, "") }
        return views
    }

    private fun buildResultViews(context: Context, appWidgetId: Int, s: SalesSummary?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.sales_widget)
        wireClicks(context, views, appWidgetId)

        if (s == null) {
            views.setTextViewText(R.id.salesWidgetUpdatedAt, "Couldn't reach sales data — tap to open app")
            listOf(
                R.id.salesWidgetRow1Val, R.id.salesWidgetRow2Val,
                R.id.salesWidgetRow3Val, R.id.salesWidgetRow4Val
            ).forEach { views.setTextViewText(it, "") }
        } else {
            views.setTextViewText(R.id.salesWidgetUpdatedAt, "₨" + fc(s.total) + " · " + s.monthYear)
            views.setTextViewText(R.id.salesWidgetRow1Val, "₨" + fc(s.cash))
            views.setTextViewText(R.id.salesWidgetRow2Val, "₨" + fc(s.banks))
            views.setTextViewText(R.id.salesWidgetRow3Val, "₨" + fc(s.credit))
            views.setTextViewText(R.id.salesWidgetRow4Val, s.customers.toString())
        }
        return views
    }

    private fun wireClicks(context: Context, views: RemoteViews, appWidgetId: Int) {
        val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL))
        val openPending = PendingIntent.getActivity(
            context, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.salesWidgetRoot, openPending)

        val refreshIntent = Intent(context, SalesWidgetProvider::class.java).apply { action = ACTION_REFRESH }
        val refreshPending = PendingIntent.getBroadcast(
            context, appWidgetId, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.salesWidgetRefreshBtn, refreshPending)
    }

    private fun pushViews(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, views: RemoteViews) {
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun piImmutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    // ── Data fetch + calc ────────────────────────────────────────────

    data class SalesSummary(
        val monthYear: String, val total: Double,
        val cash: Double, val banks: Double, val credit: Double, val customers: Int
    )

    private fun n(v: Any?): Double {
        if (v == null || v == JSONObject.NULL) return 0.0
        return when (v) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull() ?: 0.0
            else -> 0.0
        }
    }

    private fun negR(v: Any?): Double { val x = n(v); return if (x > 0) -x else x }

    private fun fc(v: Double): String {
        val r = Math.round(v)
        return String.format(java.util.Locale.US, "%,d", r)
    }

    private fun monthSortVal(monthYear: String): Int {
        val parts = monthYear.trim().split(" ")
        if (parts.size < 2) return -1
        val idx = MONTH_NAMES.indexOf(parts[0])
        val yr = parts[1].toIntOrNull() ?: return -1
        return if (idx >= 0) yr * 12 + idx else -1
    }

    private fun currentMonthYear(): String {
        val cal = Calendar.getInstance()
        return MONTH_NAMES[cal.get(Calendar.MONTH)] + " " + cal.get(Calendar.YEAR)
    }

    private fun fetchSalesSummary(): SalesSummary? {
        val conn = URL(MONTHLY_ENDPOINT).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("apikey", SB_KEY)
        conn.setRequestProperty("Authorization", "Bearer $SB_KEY")
        conn.connectTimeout = 10000
        conn.readTimeout = 10000

        val body = conn.inputStream.use { stream -> BufferedReader(InputStreamReader(stream)).readText() }
        val rows = JSONArray(body)
        if (rows.length() == 0) return null
        val monthly = rows.getJSONObject(0).optJSONArray("monthly") ?: return null
        if (monthly.length() == 0) return null

        val myNow = currentMonthYear()
        var rec: JSONObject? = null
        // Prefer the exact current-calendar-month record, same as
        // cover-dashboard.js's _monthSaleBreakdown().
        for (i in 0 until monthly.length()) {
            val m = monthly.getJSONObject(i)
            if (m.optString("Month_Year") == myNow) { rec = m; break }
        }
        // Fallback: chronologically-latest MONTHLY record by Month_Year,
        // mirroring _latestMonthlyRecord()'s reduce (max sort value wins).
        if (rec == null) {
            var best: JSONObject? = null
            var bestVal = Int.MIN_VALUE
            for (i in 0 until monthly.length()) {
                val m = monthly.getJSONObject(i)
                val v = monthSortVal(m.optString("Month_Year"))
                if (v > bestVal) { bestVal = v; best = m }
            }
            rec = best
        }
        if (rec == null) return null

        val cash = n(rec.opt("Cash Sale")) + negR(rec.opt("Cash Returns"))
        val banks = BANK_COLS.sumOf { n(rec.opt(it)) }
        val credit = CLIENT_COLS.sumOf { n(rec.opt(it)) } + n(rec.opt("F/Issue"))
        val customers = n(rec.opt("Customers")).toInt()
        val total = n(rec.opt("TOTAL"))

        return SalesSummary(rec.optString("Month_Year", "—"), total, cash, banks, credit, customers)
    }
}
