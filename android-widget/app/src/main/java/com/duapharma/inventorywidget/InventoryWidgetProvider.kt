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
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.Date

/**
 * Home-screen widget showing the branch's current low-stock items,
 * pulled straight from the same Supabase project + table the
 * inventory-search PWA reads (inventory_products, project
 * vtcrdkqhuvxatclobsby) — same public/publishable anon key, same RLS
 * scoping. No app server of our own involved.
 *
 * This is a STARTER, not a finished production widget. Notably:
 *  - The fetch here uses goAsync() so Android won't tear down the
 *    process mid-request (a bare, un-awaited coroutine launched from
 *    onUpdate() has no such guarantee — the receiver is free to be
 *    killed the instant onUpdate() returns, before an in-flight
 *    network call completes). goAsync() only buys extra time though
 *    (a background execution limit, not indefinite) — for anything
 *    you're relying on daily, migrate to a WorkManager
 *    PeriodicWorkRequest instead (Android's recommended pattern for
 *    widget data refresh): have that do the fetch and cache the result
 *    (e.g. SharedPreferences), and have this provider just read
 *    whatever WorkManager last cached rather than fetching itself.
 *  - Only 4 rows, hardcoded to 4 fixed TextView pairs in the layout.
 *    A real scrollable list needs a ListView + a RemoteViewsService
 *    (a separate, more involved API) — worth it once this basic
 *    version is confirmed working end-to-end.
 *  - minSdk 26+ assumed (PendingIntent.FLAG_IMMUTABLE requires it;
 *    adjust piImmutableFlag()'s fallback if you need older devices).
 */
class InventoryWidgetProvider : AppWidgetProvider() {

    companion object {
        // Same project + public anon key already embedded in
        // inventory-search/app.js (INV_SUPABASE_URL /
        // INV_SUPABASE_ANON_KEY) — intentionally public, RLS scopes
        // what it can actually read, same as the web app.
        private const val SUPABASE_URL = "https://vtcrdkqhuvxatclobsby.supabase.co"
        private const val SUPABASE_ANON_KEY = "sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy"
        private const val LOW_STOCK_ENDPOINT =
            "$SUPABASE_URL/rest/v1/inventory_products" +
                "?select=name,qty,generic" +
                "&qty=gt.0&qty=lte.5" +
                "&order=qty.asc&limit=4"

        // What tapping the widget opens. Plain https link for now (opens
        // in the default browser) so this widget works even before the
        // PWA is wrapped in a Trusted Web Activity — swap for a TWA
        // deep-link intent once/if that wrapper exists.
        private const val APP_URL = "https://bt.duapharma.com/inventory-search/"

        const val ACTION_REFRESH = "com.duapharma.inventorywidget.ACTION_REFRESH"

        private val ROW_IDS = listOf(
            R.id.widgetRow1 to R.id.widgetRow1Qty,
            R.id.widgetRow2 to R.id.widgetRow2Qty,
            R.id.widgetRow3 to R.id.widgetRow3Qty,
            R.id.widgetRow4 to R.id.widgetRow4Qty,
        )
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        // Immediate placeholder for every instance — no network wait,
        // so the widget never looks frozen/blank right after being added.
        appWidgetIds.forEach { id -> pushViews(context, appWidgetManager, id, buildPlaceholderViews(context, id)) }

        // One shared fetch for however many widget instances exist —
        // they all show the same branch's data, no reason to hit
        // Supabase once per instance. goAsync() keeps this process
        // alive long enough for the fetch to finish (see class doc).
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val rows = try { fetchLowStock() } catch (e: Exception) { null }
            try {
                appWidgetIds.forEach { id -> pushViews(context, appWidgetManager, id, buildResultViews(context, id, rows)) }
            } finally {
                pendingResult.finish()
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, InventoryWidgetProvider::class.java))
            onUpdate(context, manager, ids)
        } else {
            super.onReceive(context, intent)
        }
    }

    // ── View building ────────────────────────────────────────────────

    private fun buildPlaceholderViews(context: Context, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.inventory_widget)
        wireClicks(context, views, appWidgetId)
        views.setTextViewText(R.id.widgetUpdatedAt, "Updating…")
        ROW_IDS.forEach { (nameId, qtyId) ->
            views.setTextViewText(nameId, "")
            views.setTextViewText(qtyId, "")
        }
        return views
    }

    private fun buildResultViews(context: Context, appWidgetId: Int, rows: List<LowStockRow>?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.inventory_widget)
        wireClicks(context, views, appWidgetId)

        if (rows == null) {
            views.setTextViewText(R.id.widgetUpdatedAt, "Couldn't reach inventory — tap to open app")
            ROW_IDS.forEach { (nameId, qtyId) ->
                views.setTextViewText(nameId, "")
                views.setTextViewText(qtyId, "")
            }
        } else {
            val time = DateFormat.format("h:mm a", Date())
            views.setTextViewText(
                R.id.widgetUpdatedAt,
                if (rows.isEmpty()) "No low-stock items · $time" else "Low stock · $time"
            )
            ROW_IDS.forEachIndexed { i, (nameId, qtyId) ->
                val row = rows.getOrNull(i)
                views.setTextViewText(nameId, row?.name ?: "")
                views.setTextViewText(qtyId, row?.let { "${it.qty} left" } ?: "")
            }
        }
        return views
    }

    private fun wireClicks(context: Context, views: RemoteViews, appWidgetId: Int) {
        val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL))
        val openPending = PendingIntent.getActivity(
            context, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.widgetRoot, openPending)

        val refreshIntent = Intent(context, InventoryWidgetProvider::class.java).apply { action = ACTION_REFRESH }
        val refreshPending = PendingIntent.getBroadcast(
            // Request code = appWidgetId so each instance's refresh PendingIntent is distinct.
            context, appWidgetId, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or piImmutableFlag()
        )
        views.setOnClickPendingIntent(R.id.widgetRefreshBtn, refreshPending)
    }

    private fun pushViews(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, views: RemoteViews) {
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun piImmutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    // ── Data fetch ───────────────────────────────────────────────────

    data class LowStockRow(val name: String, val qty: Int, val generic: String?)

    private fun fetchLowStock(): List<LowStockRow> {
        val conn = URL(LOW_STOCK_ENDPOINT).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("apikey", SUPABASE_ANON_KEY)
        conn.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")
        conn.connectTimeout = 8000
        conn.readTimeout = 8000

        conn.inputStream.use { stream ->
            val body = BufferedReader(InputStreamReader(stream)).readText()
            val arr = JSONArray(body)
            return (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                LowStockRow(
                    name = obj.optString("name", "—"),
                    qty = obj.optInt("qty", 0),
                    generic = if (obj.isNull("generic")) null else obj.optString("generic"),
                )
            }
        }
    }
}
