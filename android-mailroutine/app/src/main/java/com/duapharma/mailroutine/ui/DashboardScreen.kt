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
import kotlinx.coroutines.delay
import java.time.Instant
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.duapharma.mailroutine.domain.Bucket
import com.duapharma.mailroutine.domain.Consent
import com.duapharma.mailroutine.domain.Explain
import com.duapharma.mailroutine.domain.OccurrenceState
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
        topBar = { TopAppBar(title = { Text(if (tab == 0) "Work" else "Routines", fontWeight = FontWeight.SemiBold) }) },
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
            Icon(Icons.Default.Email, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text("Nothing scheduled yet", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Note("Create a routine with the New routine button. Its upcoming emails will show up here.")
        }
        return
    }
    // Keeps "in 12m" / "Today" labels fresh while the screen is open.
    val now by produceState(Instant.now()) { while (true) { delay(30_000); value = Instant.now() } }
    // Summary tiles double as filters: 0 = needs you, 1 = due now, 2 = upcoming; null = show everything.
    var filter by remember { mutableStateOf<Int?>(null) }
    fun count(b: Bucket) = groups[b].orEmpty().size
    val visible: Set<Bucket> = when (filter) {
        0 -> setOf(Bucket.ATTENTION, Bucket.OVERDUE)
        1 -> setOf(Bucket.DUE)
        2 -> setOf(Bucket.UPCOMING)
        else -> Bucket.entries.toSet()
    }
    val shown = Bucket.entries.filter { it in visible && groups[it].orEmpty().isNotEmpty() }
    fun toggle(i: Int) { filter = if (filter == i) null else i }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentPadding = PaddingValues(top = 4.dp, bottom = 112.dp)) {
        item(key = "summary") {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile("Need you", count(Bucket.ATTENTION) + count(Bucket.OVERDUE), MrColors.Red, Modifier.weight(1f), filter == 0) { toggle(0) }
                StatTile("Due now", count(Bucket.DUE), MrColors.Amber, Modifier.weight(1f), filter == 1) { toggle(1) }
                StatTile("Upcoming", count(Bucket.UPCOMING), MrColors.Blue, Modifier.weight(1f), filter == 2) { toggle(2) }
            }
        }
        if (shown.isEmpty()) {
            item(key = "none") { Note("Nothing here right now. Tap the highlighted tile again to show everything.") }
        }
        shown.forEach { b ->
            val rows = groups[b].orEmpty()
            item(key = "h-$b") { SectionTitle("${bucketTitle(b)} (${rows.size})") }
            if (b == Bucket.UPCOMING) {
                // Group by day so each card only needs to show the time.
                rows.groupBy { dayLabel(it.occurrence.dueAt, now) }.forEach { (day, dayRows) ->
                    item(key = "d-$day") {
                        Text(day, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 6.dp, bottom = 2.dp))
                    }
                    items(dayRows, key = { it.occurrence.id }) { row -> OccurrenceCard(row, now, showDay = false) { nav.push(Screen.Occurrence(row.occurrence.id)) } }
                }
            } else {
                items(rows, key = { it.occurrence.id }) { row -> OccurrenceCard(row, now, showDay = true) { nav.push(Screen.Occurrence(row.occurrence.id)) } }
            }
        }
    }
}

@Composable
private fun OccurrenceCard(row: WorkItem, now: Instant, showDay: Boolean, onClick: () -> Unit) {
    val zone = runCatching { ZoneId.of(row.routine.schedule.zoneId) }.getOrDefault(ZoneId.systemDefault())
    val state = row.occurrence.state
    // Plain "scheduled" gets a per-routine colour; every other state keeps its status colour.
    val accent = if (state == OccurrenceState.SCHEDULED) routineAccent(row.routine.name) else stateColor(state)
    val due = row.occurrence.dueAt
    val whenText = (if (showDay) "${dayLabel(due, now)}, ${timeOfDay(due)}" else timeOfDay(due)) + " \u00B7 " + relativeTime(due, now)
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable(onClick = onClick)) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(5.dp).fillMaxHeight().background(accent))
            Column(Modifier.padding(14.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(row.routine.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    // "Scheduled" is the default and says nothing; only show a chip when the state is worth noticing.
                    if (state != OccurrenceState.SCHEDULED) StatusChip(state)
                }
                Text(whenText, style = MaterialTheme.typography.bodyMedium)
                if (zone != ZoneId.systemDefault()) Note("${fmt(due, zone)} in ${row.routine.schedule.zoneId}")
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
                            color = if (!r.paused && Consent.isValid(r)) MrColors.Blue else MaterialTheme.colorScheme.onSurfaceVariant,
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
