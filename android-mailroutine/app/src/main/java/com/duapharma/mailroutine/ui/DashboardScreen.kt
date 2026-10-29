package com.duapharma.mailroutine.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
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
        topBar = { TopAppBar(title = { Text(if (tab == 0) "Today" else "Routines", fontWeight = FontWeight.SemiBold) }) },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(selected = tab == 0, onClick = { tab = 0 }, icon = { Icon(Icons.Default.Home, contentDescription = null) }, label = { Text("Work") })
                NavigationBarItem(selected = tab == 1, onClick = { tab = 1 }, icon = { Icon(Icons.Default.Refresh, contentDescription = null) }, label = { Text("Routines") })
                NavigationBarItem(selected = false, onClick = { nav.push(Screen.History) }, icon = { Icon(Icons.Default.DateRange, contentDescription = null) }, label = { Text("History") })
                NavigationBarItem(selected = false, onClick = { nav.push(Screen.Settings) }, icon = { Icon(Icons.Default.Settings, contentDescription = null) }, label = { Text("Settings") })
            }
        },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { nav.push(Screen.Editor(null)) }, icon = { Icon(Icons.Default.Add, contentDescription = null) }, text = { Text("New routine") }) },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            if (account.status != AccountStatus.CONNECTED) {
                val needsReauth = account.status == AccountStatus.NEEDS_REAUTH
                Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clickable { nav.push(Screen.Settings) },
                    colors = CardDefaults.cardColors(containerColor = MrColors.Amber.copy(alpha = 0.14f))) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(if (needsReauth) "Gmail needs to be re-authorized" else "Connect Gmail to send", style = MaterialTheme.typography.titleMedium)
                        Note(if (needsReauth) "Access was revoked or expired. Nothing is sent until you reauthorize in Settings." else "Routines can't send until an account is connected. Tap to set up.")
                    }
                }
            }
            if (tab == 0) WorkTab(groups, nav) else RoutinesTab(routines, vm, nav)
        }
    }
}

@Composable
private fun WorkTab(groups: Map<Bucket, List<WorkItem>>, nav: NavState) {
    val any = groups.values.any { it.isNotEmpty() }
    if (!any) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Email, contentDescription = null, tint = MrColors.Grey, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text("Nothing scheduled yet", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Note("Create a routine with the New routine button. Its upcoming emails will show up here.")
        }
        return
    }
    fun count(b: Bucket) = groups[b].orEmpty().size
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentPadding = PaddingValues(top = 4.dp, bottom = 112.dp)) {
        item(key = "summary") {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile("Need you", count(Bucket.ATTENTION) + count(Bucket.OVERDUE), MrColors.Red, Modifier.weight(1f))
                StatTile("Due now", count(Bucket.DUE), MrColors.Amber, Modifier.weight(1f))
                StatTile("Upcoming", count(Bucket.UPCOMING), MrColors.Blue, Modifier.weight(1f))
            }
        }
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
    val accent = stateColor(row.occurrence.state)
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable(onClick = onClick)) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(5.dp).fillMaxHeight().background(accent))
            Column(Modifier.padding(14.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(row.routine.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    StatusChip(row.occurrence.state)
                }
                Text(fmt(row.occurrence.dueAt), style = MaterialTheme.typography.bodyMedium)
                if (zone != ZoneId.systemDefault()) Note("${fmt(row.occurrence.dueAt, zone)} in ${row.routine.schedule.zoneId}")
                row.occurrence.lastErrorCode?.let { Note(Explain.errorCode(it), color = accent) }
            }
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
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp)) {
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
