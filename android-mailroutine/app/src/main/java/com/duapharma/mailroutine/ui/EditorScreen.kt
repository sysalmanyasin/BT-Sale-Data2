package com.duapharma.mailroutine.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import com.duapharma.mailroutine.domain.FieldType
import com.duapharma.mailroutine.domain.FieldValidator
import com.duapharma.mailroutine.domain.HtmlTemplate
import com.duapharma.mailroutine.domain.ScheduleKind
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun Txt(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier.fillMaxWidth(), minLines: Int = 1, supporting: String? = null, keyboard: KeyboardType = KeyboardType.Text) =
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, modifier = modifier, minLines = minLines, singleLine = minLines == 1,
        supportingText = supporting?.let { { Text(it) } }, keyboardOptions = KeyboardOptions(keyboardType = keyboard),
    )

@Composable
fun <T> Picker(label: String, current: T, options: List<T>, text: (T) -> String, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text("$label: ${text(current)}") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { o -> DropdownMenuItem(text = { Text(text(o)) }, onClick = { onPick(o); open = false }) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EditorScreen(vm: EditorViewModel, nav: NavState, isNew: Boolean) {
    val f = vm.form
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) { vm.message?.let { snackbar.showSnackbar(it); vm.message = null } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(vm::addAttachment) }
    var showConsent by remember { mutableStateOf(false) }
    var showAi by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val leave = { vm.discard(); nav.pop(); Unit }
    BackHandler { leave() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(if (isNew) "New routine" else "Edit routine") },
                navigationIcon = { TextButton(onClick = leave) { Text("Cancel") } },
                actions = { Button(onClick = { vm.save { nav.pop() } }, enabled = vm.loaded && !vm.busy, modifier = Modifier.padding(end = 8.dp)) { Text("Save") } },
            )
        },
    ) { pad ->
        if (!vm.loaded) { Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Scaffold }
        Column(Modifier.padding(pad).padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (vm.issues.isNotEmpty()) {
                Card(colors = CardDefaults.cardColors(containerColor = MrColors.Red.copy(alpha = 0.10f))) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Fix these before saving", style = MaterialTheme.typography.titleMedium, color = MrColors.Red)
                        vm.issues.forEach { Text("• ${it.message}", style = MaterialTheme.typography.bodyMedium) }
                    }
                }
            }
            Txt("Routine name", f.name, { v -> vm.edit { it.copy(name = v) } })

            SectionTitle("Recipients")
            Txt("To", f.to, { v -> vm.edit { it.copy(to = v) } }, supporting = "Separate addresses with commas")
            Txt("Cc", f.cc, { v -> vm.edit { it.copy(cc = v) } })
            Txt("Bcc", f.bcc, { v -> vm.edit { it.copy(bcc = v) } })

            SectionTitle("Schedule")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = f.kind == ScheduleKind.DAILY, onClick = { vm.edit { it.copy(kind = ScheduleKind.DAILY) } }, label = { Text("Daily") })
                FilterChip(selected = f.kind == ScheduleKind.WEEKLY, onClick = { vm.edit { it.copy(kind = ScheduleKind.WEEKLY) } }, label = { Text("Weekly") })
            }
            if (f.kind == ScheduleKind.WEEKLY) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DayOfWeek.values().forEach { d ->
                        FilterChip(
                            selected = d in f.days,
                            onClick = { vm.edit { it.copy(days = if (d in it.days) it.days - d else it.days + d) } },
                            label = { Text(d.getDisplayName(TextStyle.SHORT, Locale.getDefault())) },
                        )
                    }
                }
            }
            Txt("Time (24h, HH:mm)", f.time, { v -> vm.edit { it.copy(time = v) } })
            Txt("Time zone", f.zone, { v -> vm.edit { it.copy(zone = v) } }, supporting = "IANA name such as Asia/Karachi. The routine fires at this local time.")
            TextButton(onClick = { vm.edit { it.copy(zone = ZoneId.systemDefault().id) } }) { Text("Use this device's time zone") }

            SectionTitle("Template")
            Txt("Subject", f.subject, { v -> vm.edit { it.copy(subject = v) } }, supporting = "Use {{field_key}}, {{date}}, {{weekday}}, {{routine_name}}")
            val rich = HtmlTemplate.isHtml(f.body)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Body format", style = MaterialTheme.typography.labelLarge)
                FilterChip(selected = !rich, onClick = { vm.setRichFormat(false) }, label = { Text("Plain text") })
                FilterChip(selected = rich, onClick = { vm.setRichFormat(true) }, label = { Text("Rich (HTML)") })
            }
            if (rich) {
                val keys = f.fields.map { it.key.trim() }.filter { it.isNotEmpty() } + FieldValidator.BUILT_IN_KEYS
                HtmlBodyEditor(HtmlTemplate.content(f.body), vm.bodyVersion, keys) { v -> vm.edit { it.copy(body = HtmlTemplate.wrap(v)) } }
                Note("Recipients get a formatted email with an automatic plain-text version. Field values are inserted as plain text, never as markup.")
            } else {
                Txt("Body", f.body, { v -> vm.edit { it.copy(body = v) } }, minLines = 6)
            }
            if (vm.aiConfigured) OutlinedButton(onClick = { showAi = true }) { Text("Draft with AI…") }
            else Note("AI drafting is off. Add an API key in Settings to enable it.")

            SectionTitle("Fields you fill in each time")
            f.fields.forEachIndexed { i, fld ->
                Card {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Txt("Key (used as {{key}})", fld.key, { v -> vm.edit { it.copy(fields = it.fields.toMutableList().also { l -> l[i] = fld.copy(key = v.lowercase()) }) } })
                        Txt("Label", fld.label, { v -> vm.edit { it.copy(fields = it.fields.toMutableList().also { l -> l[i] = fld.copy(label = v) }) } })
                        Picker("Type", fld.type, FieldType.entries, { it.name.lowercase() }) { t -> vm.edit { it.copy(fields = it.fields.toMutableList().also { l -> l[i] = fld.copy(type = t) }) } }
                        if (fld.type == FieldType.CHOICE) Txt("Choices (comma separated)", fld.choices, { v -> vm.edit { it.copy(fields = it.fields.toMutableList().also { l -> l[i] = fld.copy(choices = v) }) } })
                        Txt("Default value (optional)", fld.default, { v -> vm.edit { it.copy(fields = it.fields.toMutableList().also { l -> l[i] = fld.copy(default = v) }) } })
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Switch(checked = fld.required, onCheckedChange = { v -> vm.edit { it.copy(fields = it.fields.toMutableList().also { l -> l[i] = fld.copy(required = v) }) } })
                            Spacer(Modifier.width(8.dp)); Text("Required")
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = { vm.edit { it.copy(fields = it.fields.filterIndexed { idx, _ -> idx != i }) } }) { Text("Remove", color = MrColors.Red) }
                        }
                    }
                }
            }
            OutlinedButton(onClick = { vm.edit { it.copy(fields = it.fields + FieldForm()) } }) { Text("Add field") }

            SectionTitle("Attachments")
            f.attachments.forEach { a ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text(a.displayName); Note("${a.sizeBytes / 1024} KB · ${if (a.required) "required" else "optional"}") }
                    Switch(checked = a.required, onCheckedChange = { vm.setAttachmentRequired(a, it) })
                    TextButton(onClick = { vm.removeAttachment(a) }) { Text("Remove", color = MrColors.Red) }
                }
            }
            OutlinedButton(onClick = { picker.launch(arrayOf("*/*")) }) { Text("Add file") }
            Note("Files are copied into private app storage. If the original changes, re-add it.")

            SectionTitle("Reminders and automatic sending")
            Txt("Remind me this many minutes before", f.lead, { v -> vm.edit { it.copy(lead = v) } }, keyboard = KeyboardType.Number)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = f.wantsAuto, onCheckedChange = { on -> if (on && !vm.consentActive && !vm.consentConfirmed) showConsent = true else vm.setWantsAuto(on) })
                Spacer(Modifier.width(8.dp)); Text("Send automatically when due")
            }
            if (f.wantsAuto) Txt("Only auto-send within this many minutes of the due time", f.maxLate, { v -> vm.edit { it.copy(maxLate = v) } }, keyboard = KeyboardType.Number)
            if (vm.willRevokeConsent) {
                Card(colors = CardDefaults.cardColors(containerColor = MrColors.Amber.copy(alpha = 0.12f))) {
                    Text("You changed the approved content (template, fields, recipients, attachments or schedule). Saving will switch automatic sending off until you approve the new version.", Modifier.padding(12.dp))
                }
            }

            SectionTitle("Preview")
            vm.preview()?.let { p ->
                Card {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(p.subject, style = MaterialTheme.typography.titleMedium)
                        val h = p.html
                        if (h != null) HtmlPreview(h) else Text(p.body)
                        if (p.missingKeys.isNotEmpty()) Note("«…» marks fields you'll fill in for each email.")
                    }
                }
            } ?: Note("Fix the time and numbers above to see a preview.")

            if (!isNew) {
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = { confirmDelete = true }) { Text("Delete routine", color = MrColors.Red) }
            }
            Spacer(Modifier.height(32.dp))
        }
    }

    if (showConsent) AlertDialog(
        onDismissRequest = { showConsent = false },
        title = { Text("Allow automatic sending?") },
        text = {
            Text("When this routine is due, MailRoutine will send the email from your connected Gmail account without asking you — but only if every required field is filled in, the account is authorized, recipients are valid and required attachments exist. " +
                "If you change the template, recipients, attachments or schedule later, automatic sending switches off until you approve again. You can turn it off any time.")
        },
        confirmButton = { Button(onClick = { vm.confirmConsent(); showConsent = false }) { Text("I understand, allow") } },
        dismissButton = { TextButton(onClick = { showConsent = false }) { Text("Not now") } },
    )

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete this routine?") },
        text = { Text("Its schedule, history and stored attachments will be removed. This can't be undone.") },
        confirmButton = { Button(onClick = { confirmDelete = false; vm.delete { nav.pop() } }) { Text("Delete") } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep") } },
    )

    if (showAi) {
        var instruction by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showAi = false; vm.discardAi() },
            title = { Text("Draft with AI") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt("What should the email say?", instruction, { instruction = it }, minLines = 3)
                    Note("Sent to the AI service: your instruction and the current subject/body template (placeholders only). Recipients and field values are not sent.")
                    if (vm.aiBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    vm.aiError?.let { Text(it, color = MrColors.Red) }
                    vm.aiProposal?.let { p ->
                        HorizontalDivider()
                        Text("Proposal", style = MaterialTheme.typography.titleMedium)
                        Text(p.subject, style = MaterialTheme.typography.titleSmall); Text(p.body)
                        Note("Applying only fills the editor. Nothing is saved or sent, and automatic sending needs fresh approval if the approved content changed.")
                    }
                }
            },
            confirmButton = {
                if (vm.aiProposal != null) Button(onClick = { vm.applyAi(); showAi = false }) { Text("Use in editor") }
                else Button(onClick = { vm.requestAi(instruction) }, enabled = !vm.aiBusy && instruction.isNotBlank()) { Text("Generate") }
            },
            dismissButton = { TextButton(onClick = { showAi = false; vm.discardAi() }) { Text("Close") } },
        )
    }
}
