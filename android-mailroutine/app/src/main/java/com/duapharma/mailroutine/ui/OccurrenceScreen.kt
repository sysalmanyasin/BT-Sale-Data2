package com.duapharma.mailroutine.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.platform.AccountStatus
import java.time.ZoneId

private val EDITABLE = setOf(OccurrenceState.SCHEDULED, OccurrenceState.BLOCKED, OccurrenceState.FAILED_RETRYABLE, OccurrenceState.FAILED)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OccurrenceScreen(vm: OccurrenceViewModel, nav: NavState) {
    val occ by vm.occurrence.collectAsStateWithLifecycle()
    val routine by vm.routine.collectAsStateWithLifecycle()
    val attempts by vm.attempts.collectAsStateWithLifecycle()
    val account by vm.account.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) { vm.message?.let { snackbar.showSnackbar(it); vm.message = null } }
    var confirmSend by remember { mutableStateOf(false) }
    var confirmResend by remember { mutableStateOf(false) }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { TopAppBar(title = { Text(routine?.name ?: "Email") }, navigationIcon = { TextButton(onClick = { nav.pop() }) { Text("Back") } }) },
    ) { pad ->
        val o = occ; val r = routine
        if (o == null || r == null) { Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text("Not found") }; return@Scaffold }
        val values = vm.values.toMap()
        val rendered = remember(values, r, o.localDate) { Placeholders.render(r.template, values, r.name, o.localDate) }
        val editable = o.state in EDITABLE
        val zone = runCatching { ZoneId.of(r.schedule.zoneId) }.getOrDefault(ZoneId.systemDefault())

        Column(Modifier.padding(pad).padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text("Due ${fmt(o.dueAt)}", style = MaterialTheme.typography.titleMedium)
                    if (zone != ZoneId.systemDefault()) Note("${fmt(o.dueAt, zone)} in ${r.schedule.zoneId}")
                }
                StatusChip(o.state)
            }
            o.lastErrorCode?.let { Text(Explain.errorCode(it), color = stateColor(o.state)) }

            when (o.state) {
                OccurrenceState.UNCERTAIN -> Card(colors = CardDefaults.cardColors(containerColor = MrColors.Amber.copy(alpha = 0.12f))) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Check before doing anything", style = MaterialTheme.typography.titleMedium)
                        Text("Open Gmail and look in Sent for this email. MailRoutine will not resend on its own because that could send it twice.")
                        Button(onClick = { vm.confirmSent() }) { Text("It was sent") }
                        OutlinedButton(onClick = { confirmResend = true }) { Text("It was not sent — allow resending") }
                        TextButton(onClick = { vm.skip() }) { Text("Skip this one") }
                    }
                }
                OccurrenceState.SUBMITTED -> Note(Explain.SUBMITTED_NOTE + (o.gmailMessageId?.let { "  Gmail message ID: $it" } ?: ""), MrColors.Green)
                OccurrenceState.CONFIRMED_SENT -> Note("You confirmed this email was sent.", MrColors.Green)
                else -> {}
            }
            if (!o.state.isTerminal && account.status != AccountStatus.CONNECTED) {
                Note(if (account.status == AccountStatus.NEEDS_REAUTH) "Gmail access needs to be re-authorized in Settings before this can be sent." else "Connect a Gmail account in Settings before this can be sent.", MrColors.Amber)
            }

            if (r.template.fields.isNotEmpty()) SectionTitle("Fill in")
            r.template.fields.forEach { fld ->
                FieldInput(fld, vm.values[fld.key].orEmpty(), enabled = editable) { v -> vm.values[fld.key] = v }
            }

            SectionTitle("Preview")
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(rendered.subject, style = MaterialTheme.typography.titleMedium)
                    Text(rendered.body)
                    if (rendered.missingKeys.isNotEmpty()) Note("Missing: ${rendered.missingKeys.joinToString()}", MrColors.Amber)
                }
            }
            Note("To: ${r.recipients.to.joinToString()}" + (if (r.recipients.cc.isNotEmpty()) "\nCc: ${r.recipients.cc.joinToString()}" else "") + (if (r.recipients.bcc.isNotEmpty()) "\nBcc: ${r.recipients.bcc.size} hidden recipient(s)" else ""))
            r.attachments.forEach { a ->
                val ok = vm.attachmentAvailable(a)
                Note("${a.displayName} — ${if (ok) "ready" else if (a.required) "MISSING (required)" else "missing (optional, will be skipped)"}", if (ok) MrColors.Grey else MrColors.Amber)
            }

            if (editable) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { vm.save() }) { Text("Save inputs") }
                    if (o.state == OccurrenceState.FAILED || o.state == OccurrenceState.BLOCKED) OutlinedButton(onClick = { vm.resetForRetry() }) { Text("Reset") }
                }
                val canSend = o.state in StateMachine.SENDABLE
                Button(onClick = { confirmSend = true }, enabled = canSend && rendered.isComplete, modifier = Modifier.fillMaxWidth()) { Text("Send now") }
                if (o.state == OccurrenceState.FAILED) Note("A failed email isn't retried automatically. Tap Reset, fix the cause, then send.")
                if (!rendered.isComplete && canSend) Note("Fill in all required fields to enable sending.")
                TextButton(onClick = { vm.skip() }) { Text("Skip this one") }
            }

            if (attempts.isNotEmpty()) {
                SectionTitle("Attempts")
                attempts.forEach { a ->
                    Note("${fmt(a.startedAt)} · ${a.outcome.name.lowercase().replace('_', ' ')}" + (a.errorCode?.let { " · $it" } ?: "") + (a.gmailMessageId?.let { " · id $it" } ?: ""))
                }
            }
            Spacer(Modifier.height(32.dp))
        }

        if (confirmSend) AlertDialog(
            onDismissRequest = { confirmSend = false },
            title = { Text("Send this email now?") },
            text = { Text("It will be sent from your Gmail account to ${r.recipients.all.size} recipient(s).") },
            confirmButton = { Button(onClick = { confirmSend = false; vm.sendNow() }) { Text("Send") } },
            dismissButton = { TextButton(onClick = { confirmSend = false }) { Text("Cancel") } },
        )
        if (confirmResend) AlertDialog(
            onDismissRequest = { confirmResend = false },
            title = { Text("Allow resending?") },
            text = { Text("Only continue if you checked Gmail Sent and the email is not there. Otherwise the recipients may get it twice.") },
            confirmButton = { Button(onClick = { confirmResend = false; vm.confirmNotSent() }) { Text("Yes, it was not sent") } },
            dismissButton = { TextButton(onClick = { confirmResend = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun FieldInput(f: TemplateField, value: String, enabled: Boolean, onChange: (String) -> Unit) {
    val label = f.label + if (f.required) " *" else ""
    val err = if (value.isBlank()) (if (f.required && f.defaultValue.isNullOrBlank()) "Required" else null) else FieldValidator.validateValue(f, value)
    val hint = f.defaultValue?.takeIf { it.isNotBlank() }?.let { "Default: $it" }
    when (f.type) {
        FieldType.BOOLEAN -> Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(checked = value == "true" || (value.isBlank() && f.defaultValue == "true"), enabled = enabled, onCheckedChange = { onChange(it.toString()) })
            Spacer(Modifier.width(8.dp)); Text(label)
        }
        FieldType.CHOICE -> Column {
            Text(label, style = MaterialTheme.typography.labelMedium)
            Picker("Choice", value.ifBlank { f.defaultValue ?: "—" }, f.choices, { it }) { if (enabled) onChange(it) }
            if (err != null) Text(err, color = MrColors.Red, style = MaterialTheme.typography.bodySmall)
        }
        else -> OutlinedTextField(
            value = value, onValueChange = onChange, enabled = enabled, label = { Text(label) }, modifier = Modifier.fillMaxWidth(),
            isError = err != null, singleLine = f.type != FieldType.MULTILINE, minLines = if (f.type == FieldType.MULTILINE) 3 else 1,
            supportingText = { Text(err ?: hint ?: if (f.type == FieldType.DATE) "YYYY-MM-DD" else "") },
            keyboardOptions = KeyboardOptions(keyboardType = if (f.type == FieldType.NUMBER) KeyboardType.Decimal else KeyboardType.Text),
        )
    }
}
