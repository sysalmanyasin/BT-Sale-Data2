package com.duapharma.closingwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class QuickActionsWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.widget_quick_actions)
            views.setOnClickPendingIntent(R.id.quick_add_action, launch(context, "jazzcash", 4101))
            views.setOnClickPendingIntent(R.id.add_credit_action, launch(context, "credit", 4102))
            views.setOnClickPendingIntent(R.id.add_expense_action, launch(context, "expense", 4103))
            manager.updateAppWidget(id, views)
        }
    }
    private fun launch(context: Context, kind: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, AssistantActivity::class.java).putExtra("initial_kind", kind)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}

class AskDuaWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.widget_ask_dua)
            val intent = Intent(context, AssistantActivity::class.java).putExtra("focus_ask_dua", true)
            val pending = PendingIntent.getActivity(context, 4201, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.ask_dua_open, pending)
            manager.updateAppWidget(id, views)
        }
    }
}
