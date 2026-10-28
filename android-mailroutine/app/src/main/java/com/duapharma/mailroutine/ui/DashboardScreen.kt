package com.duapharma.mailroutine.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.duapharma.mailroutine.domain.Bucket
import com.duapharma.mailroutine.domain.Consent
import com.duapharma.mailroutine.domain.Explain
import com.duapharma.mailroutine.domain.Routine
import com.duapharma.mailroutine.domain.WorkItem
import com.duapharma.mailroutine.domain.ScheduleKind
import com.duapharma.mailroutine.platform.AccountStatus
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(vm: DashboardViewModel, nav: NavState) {
    val groups by vm.groups.collectAsStateWithLifecycle()
    val routines by vm.routines.collectAsStateWithLifecycle()
    val account by vm.account.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("MailRoutine") },
                actions = {
                    TextButton(onClick = { nav.push(Screen.History) }) { Text("History") }
                    IconButton(onClick = { nav.push(Screen.Settings) }) { Icon(Icons.Default.Settings, contentDescription = "Settings") }
                },
            )
        },
        floatingActionButton = { FloatingActionButton(onClick = { nav.push(Screen.Editor(null)) }) { Icon(Icons.Default.Add, contentDescription = "New routine") } },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            if (account.status != AccountStatus.CONNECTED) {
                val needsReauth = account.status == AccountStatus.NEEDS_REAUTH
                Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clickable { nav.push(Screen.Settings) },
                    colors = CardDefaults.cardColors(containerColor = MrColors.Amber.copy(alpha = 0.12f))) {
                    Column(Modifier.padding(12.dp)) {
                        Text(if (needsReauth) "Gmail needs to be re-authorized" else "Connect Gmail to send", style = MaterialTheme.typography.titleMedium)
                        Note(if (needsReauth) "Access was revoked or expired. Nothing is sent until you reauthorize in Settings." else "Routines can't send until an account is connected.")
                    }
                }
            }
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Work") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Routines (${routines.size})") })
            }
            if (tab == 0) WorkTab(groups, nav) else RoutinesTab(routines, vm, nav)
        }
    }
}

@Composable
private fun WorkTab(groups: Map<Bucket, List<WorkItem>>, nav: NavState) {
    val any = groups.values.any { it.isNotEmpty() }
    if (!any) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Nothing scheduled yet", style = MaterialTheme.typography.titleMedium)
            Note("Create a routine with the + button. Its upcoming emails will show up here.")
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentPadding = PaddingValues(bottom = 96.dp)) {
        Bucket.entries.forEach { b ->
            val rows = groups[b].orEmpty()
            if (rows.isNotEmpty()) {
                item(key = "h-$b") { SectionTitle("${bucketTitle(b)} (${rows.size})") }
                items(rows, key = { it.occurrence.id }) { row -> OccurrenceCard(row) { nav.push(Screen.Occurrence(row.occurrence.id)) } }
            }
        }
    }
}

@Composable
private fun OccurrenceCard(row: WorkItem, onClick: () -> Unit) {
    val zone = runCatching { ZoneId.of(row.routine.schedule.zoneId) }.getOrDefault(ZoneId.systemDefault())
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable(onClick = onClick)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(row.routine.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                StatusChip(row.occurrence.state)
            }
            Text(fmt(row.occurrence.dueAt), style = MaterialTheme.typography.bodyMedium)
            if (zone != ZoneId.systemDefault()) Note("${fmt(row.occurrence.dueAt, zone)} in ${row.routine.schedule.zoneId}")
            row.occurrence.lastErrorCode?.let { Note(Explain.errorCode(it), color = stateColor(row.occurrence.state)) }
        }
    }
}

@Composable
private fun RoutinesTab(routines: List<Routine>, vm: DashboardViewModel, nav: NavState) {
    if (routines.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("No routines", style = MaterialTheme.typography.titleMedium)
            Note("A routine is an email you send on a schedule, with fields you fill in each time.")
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentPadding = PaddingValues(vertical = 8.dp, bottom = 96.dp)) {
        items(routines, key = { it.id }) { r ->
            Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { nav.push(Screen.Editor(r.id)) }) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(r.name, style = MaterialTheme.typography.titleMedium)
                        Note(scheduleSummary(r))
                        Note(
                            when {
                                r.paused -> "Paused"
                                Consent.isValid(r) -> "Sends automatically"
                                else -> "You send it manually"
                            },
                            color = if (!r.paused && Consent.isValid(r)) MrColors.Blue else MrColors.Grey,
                        )
                    }
                    Switch(checked = !r.paused, onCheckedChange = { vm.setPaused(r.id, !it) })
                }
            }
        }
    }
}

fun scheduleSummary(r: Routine): String {
    val s = r.schedule
    val days = if (s.kind == ScheduleKind.DAILY) "Every day" else s.days.sorted().joinToString(", ") { it.getDisplayName(TextStyle.SHORT, Locale.getDefault()) }
    return "$days at ${s.time} (${s.zoneId})"
}
