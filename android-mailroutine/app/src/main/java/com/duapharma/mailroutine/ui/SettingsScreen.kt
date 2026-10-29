package com.duapharma.mailroutine.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.duapharma.mailroutine.ai.AiProvider
import com.duapharma.mailroutine.platform.AccountStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: SettingsViewModel, nav: NavState) {
    val account by vm.account.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) { vm.message?.let { snackbar.showSnackbar(it); vm.message = null } }

    val authLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { vm.onAuthResult(it.data) }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> uri?.let(vm::exportBackup) }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(vm::readBackup) }
    var notificationsOn by remember { mutableStateOf(NotificationManagerCompat.from(ctx).areNotificationsEnabled()) }
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { notificationsOn = NotificationManagerCompat.from(ctx).areNotificationsEnabled() }
    var aiKey by remember { mutableStateOf("") }
    var confirmDisconnect by remember { mutableStateOf(false) }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { TopAppBar(title = { Text("Settings") }, navigationIcon = { TextButton(onClick = { nav.pop() }) { Text("Back") } }) },
    ) { pad ->
        Column(Modifier.padding(pad).padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle("Gmail account")
            Text(
                when (account.status) {
                    AccountStatus.NOT_CONNECTED -> "Not connected"
                    AccountStatus.CONNECTED -> "Connected" + (account.email?.let { " as $it" } ?: "")
                    AccountStatus.NEEDS_REAUTH -> "Authorization lost — reauthorize to send"
                },
                color = if (account.status == AccountStatus.CONNECTED) MrColors.Green else MrColors.Amber,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val connect = { vm.connect { pi -> authLauncher.launch(IntentSenderRequest.Builder(pi.intentSender).build()) } }
                when (account.status) {
                    AccountStatus.NOT_CONNECTED -> Button(onClick = { connect() }) { Text("Connect Gmail") }
                    AccountStatus.NEEDS_REAUTH -> Button(onClick = { connect() }) { Text("Reauthorize") }
                    AccountStatus.CONNECTED -> OutlinedButton(onClick = { connect() }) { Text("Reauthorize") }
                }
                if (account.status != AccountStatus.NOT_CONNECTED) OutlinedButton(onClick = { confirmDisconnect = true }) { Text("Disconnect") }
            }
            Note("MailRoutine only asks for permission to send email. It cannot read your mailbox, and it never sees your Google password. If your organization restricts third-party apps, a Workspace administrator must allow this app.")

            SectionTitle("Notifications")
            if (notificationsOn) Note("Reminders and failure alerts are on.", MrColors.Green)
            else {
                Note("Notifications are off, so reminders and failure alerts won't appear.", MrColors.Amber)
                Button(onClick = { if (Build.VERSION.SDK_INT >= 33) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow notifications") }
            }

            SectionTitle("Backup")
            Note("Exports routine definitions only: no credentials, no history, no attachments, and automatic sending is switched off on import. The file contains recipient addresses, so store it privately.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { exportLauncher.launch("mailroutine-backup.json") }) { Text("Export") }
                OutlinedButton(onClick = { importLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }) { Text("Import") }
            }

            SectionTitle("AI writing assistant (optional)")
            if (!vm.aiStorageAvailable) Note("Secure storage isn't available on this device, so AI writing stays disabled.", MrColors.Amber)
            else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Provider", style = MaterialTheme.typography.labelLarge)
                    AiProvider.entries.forEach { p ->
                        FilterChip(selected = vm.aiProvider == p, onClick = { vm.selectAiProvider(p); aiKey = "" }, label = { Text(p.label) })
                    }
                }
                Note(
                    if (vm.aiKeySet) "${vm.aiProvider.label} key saved. It is stored encrypted on this device and is never included in backups."
                    else "Disabled until you add a ${vm.aiProvider.label} API key. Suggestions never change a routine or an email by themselves.",
                )
                if (vm.aiProvider != vm.aiActive) Note("${vm.aiActive.label} is still the active provider. Tap Save to switch to ${vm.aiProvider.label}.", MrColors.Amber)
                Note(vm.aiProvider.keyHelp)
                Note("Privacy: when you use Write with AI, your instruction and the text you are working on (the template in the editor, or one field of an email) are sent to ${vm.aiProvider.label} using your key. Recipients and other fields are never sent.", MrColors.Amber)
                OutlinedTextField(value = aiKey, onValueChange = { aiKey = it }, label = { Text(if (vm.aiKeySet) "Replace ${vm.aiProvider.label} API key" else "${vm.aiProvider.label} API key") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = vm.aiModel, onValueChange = { vm.aiModel = it }, label = { Text("Model") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    supportingText = { Text("Default: ${vm.aiProvider.defaultModel}") })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { vm.saveAi(aiKey); aiKey = "" }, enabled = aiKey.isNotBlank() || vm.aiKeySet) { Text("Save") }
                    if (vm.aiKeySet) OutlinedButton(onClick = { vm.clearAi() }) { Text("Remove key") }
                }
            }

            SectionTitle("Reliability")
            Note("Android may delay or stop background work to save battery. Exempting MailRoutine from battery optimization makes automatic sends much more punctual.")
            OutlinedButton(onClick = { runCatching { ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } }) { Text("Open battery settings") }

            SectionTitle("How scheduling works")
            Note("Scheduling is local to this phone. Android may delay background work to save battery, so automatic sends can arrive minutes late, and if the phone is off or the app is force-stopped nothing is sent until it runs again. " +
                "Items that come due while the phone is off are recovered on the next start; automatic sending only covers a limited window after the due time, after that you decide. " +
                "\"Accepted by Gmail\" means Gmail took the message; it does not confirm delivery to recipients. For best reliability, exclude MailRoutine from battery optimization.")
            Spacer(Modifier.height(32.dp))
        }

        vm.pendingImport?.let { p ->
            AlertDialog(
                onDismissRequest = { vm.cancelImport() },
                title = { Text("Import ${p.routines.size} routine(s)?") },
                text = { Column(Modifier.verticalScroll(rememberScrollState())) { p.warnings.take(8).forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) } } },
                confirmButton = { Button(onClick = { vm.confirmImport() }) { Text("Import") } },
                dismissButton = { TextButton(onClick = { vm.cancelImport() }) { Text("Cancel") } },
            )
        }
        if (confirmDisconnect) AlertDialog(
            onDismissRequest = { confirmDisconnect = false },
            title = { Text("Disconnect Gmail?") },
            text = { Text("Access is revoked and nothing will be sent, including automatic emails, until you connect again.") },
            confirmButton = { Button(onClick = { confirmDisconnect = false; vm.disconnect() }) { Text("Disconnect") } },
            dismissButton = { TextButton(onClick = { confirmDisconnect = false }) { Text("Cancel") } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(vm: HistoryViewModel, nav: NavState) {
    val rows by vm.rows.collectAsStateWithLifecycle()
    Scaffold(topBar = { TopAppBar(title = { Text("Send history") }, navigationIcon = { TextButton(onClick = { nav.pop() }) { Text("Back") } }) }) { pad ->
        if (rows.isEmpty()) { Box(Modifier.padding(pad).padding(24.dp)) { Note("No send attempts yet.") }; return@Scaffold }
        LazyColumn(Modifier.padding(pad).padding(horizontal = 16.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
            items(rows, key = { it.attempt.id }) { r ->
                val a = r.attempt
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(r.routineName ?: "Deleted routine", style = MaterialTheme.typography.titleMedium)
                        if (a.subject.isNotBlank()) Text(a.subject, style = MaterialTheme.typography.bodyMedium)
                        Note("${fmt(a.startedAt)} · ${a.outcome.name.lowercase().replace('_', ' ')}")
                        a.errorCode?.let { Note(com.duapharma.mailroutine.domain.Explain.errorCode(it), MrColors.Amber) }
                        a.gmailMessageId?.let { Note("Gmail message ID: $it") }
                    }
                }
            }
        }
    }
}
