package com.duapharma.closingwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Quick Add widget: live total credit (same number as the Total Credit widget),
 * four quick-add buttons (Jazz Cash / Staff Credit / Expense / New Section)
 * and the last 3 entries saved from the app/widget.
 */
class QuickActionsWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.QUICKACTIONS_REFRESH"

        private data class RowIds(val root: Int, val title: Int, val meta: Int, val amount: Int)
        private val ROWS = listOf(
            RowIds(R.id.qa_row1, R.id.qa_row1_title, R.id.qa_row1_meta, R.id.qa_row1_amount),
            RowIds(R.id.qa_row2, R.id.qa_row2_title, R.id.qa_row2_meta, R.id.qa_row2_amount),
            RowIds(R.id.qa_row3, R.id.qa_row3_title, R.id.qa_row3_meta, R.id.qa_row3_amount),
        )

        /** Redraws from cache instantly, then re-fetches the total in the background. */
        fun updateAll(context: Context) {
            val app = context.applicationContext
            thread { updateNow(app) }
        }

        private fun ids(context: Context): IntArray =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, QuickActionsWidgetProvider::class.java))

        fun updateNow(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = ids(context)
            if (ids.isEmpty()) return
            render(context, manager, ids, "Refreshing…")
            val summary = try { CreditRepository.fetchCreditSummary(context) } catch (_: Exception) { null }
            if (summary != null) AssistantStore.saveTotal(context, summary.totalOutstanding)
            render(context, manager, ids, null)
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray, note: String?) {
            val views = RemoteViews(context.packageName, R.layout.widget_quick_actions)

            val total = AssistantStore.total(context)
            views.setTextViewText(R.id.qa_total, if (total == null) "₨—" else CreditRepository.formatAmount(total.first))
            views.setTextViewText(
                R.id.qa_updated,
                note ?: if (total == null) "Tap to refresh"
                else "Updated " + SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(total.second))
            )

            val timeFmt = SimpleDateFormat("d MMM, h:mm a", Locale.getDefault())
            val entries = AssistantStore.recent(context)
            ROWS.forEachIndexed { i, row ->
                val e = entries.getOrNull(i)
                if (e == null) {
                    views.setViewVisibility(row.root, View.GONE)
                } else {
                    views.setViewVisibility(row.root, View.VISIBLE)
                    views.setTextViewText(row.title, e.title)
                    views.setTextViewText(row.meta, e.detail + " · " + timeFmt.format(Date(e.ts)))
                    views.setTextViewText(row.amount, CreditRepository.formatAmount(e.amount))
                }
            }
            views.setViewVisibility(R.id.qa_empty, if (entries.isEmpty()) View.VISIBLE else View.GONE)

            views.setOnClickPendingIntent(R.id.quick_add_action, launch(context, "jazzcash", 4101))
            views.setOnClickPendingIntent(R.id.add_credit_action, launch(context, "credit", 4102))
            views.setOnClickPendingIntent(R.id.add_expense_action, launch(context, "expense", 4103))
            views.setOnClickPendingIntent(R.id.add_section_action, launch(context, "custom", 4104))
            val refresh = Intent(context, QuickActionsWidgetProvider::class.java).setAction(ACTION_REFRESH)
            views.setOnClickPendingIntent(
                R.id.qa_header,
                PendingIntent.getBroadcast(context, 4100, refresh, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            )
            manager.updateAppWidget(ids, views)
        }

        private fun launch(context: Context, kind: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, AssistantActivity::class.java).putExtra("initial_kind", kind)
            return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread { try { updateNow(context.applicationContext) } finally { pending.finish() } }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val pending = goAsync()
            thread { try { updateNow(context.applicationContext) } finally { pending.finish() } }
        }
    }
}

/** Ask Dua widget: last answer preview, three one-tap questions, and a button to open the full screen. */
class AskDuaWidgetProvider : AppWidgetProvider() {

    companion object {
        fun updateAll(context: Context) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val ids = manager.getAppWidgetIds(ComponentName(app, AskDuaWidgetProvider::class.java))
            if (ids.isNotEmpty()) thread { render(app, manager, ids) }
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val views = RemoteViews(context.packageName, R.layout.widget_ask_dua)
            AssistantStore.lastAnswer(context)?.let { (q, a) ->
                views.setTextViewText(R.id.dua_question, "You asked: $q")
                views.setTextViewText(R.id.dua_answer, a)
            }
            views.setOnClickPendingIntent(R.id.ask_dua_open, open(context, null, 4201))
            views.setOnClickPendingIntent(R.id.dua_panel, open(context, null, 4201))
            views.setOnClickPendingIntent(R.id.dua_chip_sales, open(context, "What were today's sales?", 4202))
            views.setOnClickPendingIntent(R.id.dua_chip_expenses, open(context, "What were this month's expenses?", 4203))
            views.setOnClickPendingIntent(R.id.dua_chip_credit, open(context, "What is the total outstanding credit right now, split by section?", 4204))
            manager.updateAppWidget(ids, views)
        }

        private fun open(context: Context, prompt: String?, requestCode: Int): PendingIntent {
            val intent = Intent(context, AssistantActivity::class.java).putExtra("focus_ask_dua", true)
            if (prompt != null) intent.putExtra("ask_prompt", prompt)
            return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread { try { render(context.applicationContext, manager, ids) } finally { pending.finish() } }
    }
}
