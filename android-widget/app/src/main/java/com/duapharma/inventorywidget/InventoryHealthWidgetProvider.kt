package com.duapharma.inventorywidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.text.format.DateFormat
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
import java.util.Date

/**
 * Home-screen widget showing whole-store inventory health — Total
 * Inventory Level, Negative Value, Never Sold (60D), Dead Stock (60D),
 * and raw Excess Stock — ported straight from js/shared/summary-calc.js's
 * computeInventoryBuckets(), the same pure function the Supabase Edge
 * Function (send-daily-whatsapp-briefing) uses server-side. Reads the
 * same `inventory_products` table/project the Low Stock widget and
 * inventory-search PWA already use.
 *
 * DELIBERATELY NOT SHOWN (documented, not silently dropped):
 *  - "Corrected Excess Stock" — the correction (retain-list + misc
 *    buffer) lives ONLY in per-device browser storage (js/excess-
 *    working.js), never synced to Supabase. summary-calc.js's own
 *    header says as much: "There is no server-reachable 'corrected
 *    excess' value today." This widget shows the RAW excess figure
 *    only, labeled as such — same distinction the app itself makes.
 *  - "Reorder Alert" (stockout counts / cover-days ranking) — a
 *    separate feature (Reorder Report) not covered by
 *    computeInventoryBuckets(). Would need its own port; out of scope
 *    here.
 *
 * Unlike the other widgets, this one needs EVERY row in
 * inventory_products (thousands of SKUs for a full stock valuation),
 * not a filtered handful — PostgREST's default page size (1000) means
 * a single unpaginated request could silently truncate the data on a
 * large catalog. fetchAllInventoryRows() below pages through with the
 * `Range` header until a page comes back short of PAGE_SIZE.
 */
class InventoryHealthWidgetProvider : AppWidgetProvider() {

    companion object {
        // Same project + public anon key as InventoryWidgetProvider /
        // inventory-search/app.js.
        private const val SUPABASE_URL = "https://vtcrdkqhuvxatclobsby.supabase.co"
        private const val SUPABASE_ANON_KEY = "sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy"
        private const val ITEMS_ENDPOINT =
            "$SUPABASE_URL/rest/v1/inventory_products" +
                "?select=qty,price,conversion_factor,last_receive_date,last_sale_date,net_qty_90_days"

        private const val PAGE_SIZE = 1000
        private const val MAX_PAGES = 30 // hard ceiling — ~30,000 SKUs, generous for a pharmacy catalog

        private const val APP_URL = "https://bt.duapharma.com/inventory-search/"

        const val ACTION_REFRESH = "com.duapharma.inventorywidget.ACTION_REFRESH_INVHEALTH"

        private const val NEVER_DEAD_WINDOW_DAYS = 60 // matches computeInventoryBuckets()'s window60
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id -> pushViews(context, appWidgetManager, id, buildPlaceholderViews(context, id)) }

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val summary = try { fetchHealthSummary() } catch (e: Exception) { null }
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
            val ids = manager.getAppWidgetIds(ComponentName(context, InventoryHealthWidgetProvider::class.java))
            onUpdate(context, manager, ids)
        } else {
            super.onReceive(context, intent)
        }
    }

    // ── View building ────────────────────────────────────────────────

    private fun buildPlaceholderViews(context: Context, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.invhealth_widget)
        wireClicks(context, views, appWidgetId)
        views.setTextViewText(R.id.invHealthWidgetUpdatedAt, "Updating…")
        listOf(
            R.id.invHealthWidgetRow1Val, R.id.invHealthWidgetRow2Val,
            R.id.invHealthWidgetRow3Val, R.id.invHealthWidgetRow4Val
        ).forEach { views.setTextViewText(it, "") }
        return views
    }

    private fun buildResultViews(context: Context, appWidgetId: Int, s: HealthSummary?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.invhealth_widget)
        wireClicks(context, views, appWidgetId)

        if (s == null) {
            views.setTextViewText(R.id.invHealthWidgetUpdatedAt, "Couldn't reach inventory — tap to open app")
            listOf(
                R.id.invHealthWidgetRow1Val, R.id.invHealthWidgetRow2Val,
                R.id.invHealthWidgetRow3Val, R.id.invHealthWidgetRow4Val
            ).forEach { views.setTextViewText(it, "") }
        } else {
            val time = DateFormat.format("h:mm a", Date())
            views.setTextViewText(R.id.invHealthWidgetUpdatedAt, "Rs. " + fc(s.totalInventoryValue) + " · $time")
            views.setTextViewText(R.id.invHealthWidgetRow1Val, "Rs. " + fc(s.negativeValue))
            views.setTextViewText(R.id.invHealthWidgetRow2Val, "Rs. " + fc(s.neverSold60Value))
            views.setTextViewText(R.id.invHealthWidgetRow3Val, "Rs. " + fc(s.deadStock60Value))
            views.setTextViewText(R.id.invHealthWidgetRow4Val, "Rs. " + fc(s.rawExcessValue))
        }
        return views
    }

    private fun wireClicks(context: Context, views: RemoteViews, appWidgetId: Int) {
        val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL))
        val openPending = PendingIntent.getActivity(
            context, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.invHealthWidgetRoot, openPending)

        val refreshIntent = Intent(context, InventoryHealthWidgetProvider::class.java).apply { action = ACTION_REFRESH }
        val refreshPending = PendingIntent.getBroadcast(
            context, appWidgetId, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.invHealthWidgetRefreshBtn, refreshPending)
    }

    private fun pushViews(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, views: RemoteViews) {
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun piImmutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    // ── Data fetch + calc ────────────────────────────────────────────

    data class HealthSummary(
        val totalInventoryValue: Double, val negativeValue: Double,
        val neverSold60Value: Double, val deadStock60Value: Double, val rawExcessValue: Double
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

    private fun isPackValid(raw: Any?): Boolean {
        val v = n(raw)
        return raw != null && raw != JSONObject.NULL && v.isFinite() && v > 0
    }

    // Mirrors _downRound(): floor(stock / pack) * pack.
    private fun downRoundQty(stock: Double, pack: Double): Double {
        val p = if (pack > 0) pack else 1.0
        val packs = Math.floor(stock / p)
        return packs * p
    }

    private fun daysSince(dateStr: String?, nowMs: Long): Long? {
        if (dateStr.isNullOrBlank()) return null
        return try {
            // last_receive_date / last_sale_date come back as "YYYY-MM-DD"
            // (or a full ISO timestamp) from PostgREST — java.sql-free
            // manual parse to avoid extra dependencies.
            val datePart = dateStr.substring(0, 10)
            val parts = datePart.split("-")
            val cal = java.util.Calendar.getInstance()
            cal.clear()
            cal.set(parts[0].toInt(), parts[1].toInt() - 1, parts[2].toInt())
            val diffMs = nowMs - cal.timeInMillis
            diffMs / 86400000L
        } catch (e: Exception) { null }
    }

    // Ports js/shared/summary-calc.js's computeInventoryBuckets() —
    // same thresholds, same eligibility rules, run over EVERY row.
    private fun fetchHealthSummary(): HealthSummary? {
        val items = fetchAllInventoryRows() ?: return null
        if (items.isEmpty()) return null

        val now = System.currentTimeMillis()
        var totalInventoryValue = 0.0
        var negativeValue = 0.0
        var neverSold60Value = 0.0
        var deadStock60Value = 0.0
        var rawExcessValue = 0.0

        for (it in items) {
            val stock = n(it.opt("qty"))
            val unitPrice = n(it.opt("price"))
            val value = stock * unitPrice
            totalInventoryValue += value
            if (stock < 0) negativeValue += value
            if (stock == 0.0) continue // zero stock — nothing to bucket, same as computeAll()

            val conversionFactor = it.opt("conversion_factor")
            val packValid = isPackValid(conversionFactor)
            val recDays = daysSince(it.optString("last_receive_date", null), now)
            val lastSale = it.optString("last_sale_date", null)
            val saleDays = daysSince(lastSale, now)
            val hasSale = !lastSale.isNullOrBlank()

            if (packValid) {
                val pack = n(conversionFactor)

                // Never sold: no sale record at all, received > window ago.
                if (!hasSale && recDays != null && recDays > NEVER_DEAD_WINDOW_DAYS) {
                    val qty = downRoundQty(stock, pack)
                    if (qty > 0) neverSold60Value += qty * unitPrice
                }

                // Dead stock: HAS sale history, but not within the
                // window, AND received more than that window ago.
                if (hasSale && saleDays != null && saleDays > NEVER_DEAD_WINDOW_DAYS &&
                    recDays != null && recDays > NEVER_DEAD_WINDOW_DAYS
                ) {
                    val qty = downRoundQty(stock, pack)
                    if (qty > 0) deadStock60Value += qty * unitPrice
                }
            }

            // 100-day excess: net_qty_90_days is a trailing 90-day net-sold
            // quantity, scaled to a 100-day target. No pack rounding.
            // Only items with stock >= 4 are eligible.
            val net90 = n(it.opt("net_qty_90_days"))
            val dailyRate = net90 / 90.0
            val target100 = dailyRate * 100.0
            val excessQty = stock - target100
            if (net90 > 0 && excessQty > 0 && stock >= 4) {
                rawExcessValue += excessQty * unitPrice
            }
        }

        return HealthSummary(totalInventoryValue, negativeValue, neverSold60Value, deadStock60Value, rawExcessValue)
    }

    // Pages through inventory_products with the `Range` header until a
    // page comes back short of PAGE_SIZE (or MAX_PAGES is hit) — a
    // single unpaginated request would silently truncate at PostgREST's
    // default row cap on a large catalog.
    private fun fetchAllInventoryRows(): List<JSONObject>? {
        val all = mutableListOf<JSONObject>()
        var offset = 0
        repeat(MAX_PAGES) {
            val conn = URL(ITEMS_ENDPOINT).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SUPABASE_ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")
            conn.setRequestProperty("Range-Unit", "items")
            conn.setRequestProperty("Range", "$offset-${offset + PAGE_SIZE - 1}")
            conn.connectTimeout = 15000
            conn.readTimeout = 15000

            val body = conn.inputStream.use { stream -> BufferedReader(InputStreamReader(stream)).readText() }
            val page = JSONArray(body)
            for (i in 0 until page.length()) all.add(page.getJSONObject(i))

            if (page.length() < PAGE_SIZE) return all // last page
            offset += PAGE_SIZE
        }
        return all // hit MAX_PAGES — return what we have rather than looping forever
    }
}
