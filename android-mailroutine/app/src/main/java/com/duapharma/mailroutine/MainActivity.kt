package com.duapharma.mailroutine

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import com.duapharma.mailroutine.ui.*

class MainActivity : ComponentActivity() {
    private val nav = NavState()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as MailRoutineApp).container
        if (savedInstanceState == null) handle(intent)
        setContent { MailRoutineTheme { Root(container, nav) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(i: Intent?) {
        i?.getStringExtra(EXTRA_OCCURRENCE_ID)?.let { nav.openOccurrence(it); i.removeExtra(EXTRA_OCCURRENCE_ID) }
    }

    companion object { const val EXTRA_OCCURRENCE_ID = "occurrenceId" }
}

@Composable
private fun Root(c: AppContainer, nav: NavState) {
    BackHandler(enabled = nav.stack.size > 1) { nav.pop() }
    when (val s = nav.current) {
        Screen.Dashboard -> DashboardScreen(viewModel(key = "dashboard", factory = vmFactory { DashboardViewModel(c) }), nav)
        is Screen.Editor -> EditorScreen(viewModel(key = "editor-${s.token}", factory = vmFactory { EditorViewModel(c, s.routineId) }), nav, isNew = s.routineId == null)
        is Screen.Occurrence -> OccurrenceScreen(viewModel(key = "occ-${s.token}", factory = vmFactory { OccurrenceViewModel(c, s.id) }), nav)
        Screen.History -> HistoryScreen(viewModel(key = "history", factory = vmFactory { HistoryViewModel(c) }), nav)
        Screen.Settings -> SettingsScreen(viewModel(key = "settings", factory = vmFactory { SettingsViewModel(c) }), nav)
    }
}
