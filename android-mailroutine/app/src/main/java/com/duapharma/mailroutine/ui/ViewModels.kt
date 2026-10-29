package com.duapharma.mailroutine.ui

import android.app.PendingIntent
import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.duapharma.mailroutine.AppContainer
import com.duapharma.mailroutine.ai.AiDraft
import com.duapharma.mailroutine.ai.AiProvider
import com.duapharma.mailroutine.ai.AiResult
import com.duapharma.mailroutine.ai.AiTextRequest
import com.duapharma.mailroutine.ai.AiTextResult
import com.duapharma.mailroutine.backup.BackupCodec
import com.duapharma.mailroutine.backup.BackupResult
import com.duapharma.mailroutine.data.AttemptWithRoutine
import com.duapharma.mailroutine.data.SaveResult
import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.platform.AttachmentImport
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

inline fun <reified T : ViewModel> vmFactory(crossinline make: () -> T): ViewModelProvider.Factory =
    viewModelFactory { initializer { make() } }

private val minuteTicker = flow { while (true) { emit(Unit); delay(60_000) } }

class DashboardViewModel(private val c: AppContainer) : ViewModel() {
    val groups: StateFlow<Map<Bucket, List<WorkItem>>> = combine(c.repository.observeRoutines(), c.repository.observeOccurrences(), minuteTicker) { rs, os, _ ->
        val byId = rs.associateBy { it.id }
        DashboardGrouper.group(os.mapNotNull { o -> byId[o.routineId]?.let { WorkItem(it, o) } }, c.clock.now())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    val routines: StateFlow<List<Routine>> = c.repository.observeRoutines().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val account = c.auth.state

    init { c.scheduler.sweepNow() }

    fun setPaused(id: String, paused: Boolean) = viewModelScope.launch { c.repository.setPaused(id, paused); c.scheduler.sweepNow() }
}

data class FieldForm(
    val key: String = "", val label: String = "", val type: FieldType = FieldType.TEXT,
    val required: Boolean = true, val default: String = "", val choices: String = "",
)

data class EditorForm(
    val name: String = "", val to: String = "", val cc: String = "", val bcc: String = "",
    val kind: ScheduleKind = ScheduleKind.WEEKLY,
    val days: Set<java.time.DayOfWeek> = setOf(java.time.DayOfWeek.MONDAY),
    val time: String = "09:00", val zone: String = ZoneId.systemDefault().id,
    val subject: String = "", val body: String = "", val fields: List<FieldForm> = emptyList(),
    val attachments: List<AttachmentRef> = emptyList(),
    val maxLate: String = "120", val lead: String = "15", val wantsAuto: Boolean = false,
)

private val TIME_FMT = DateTimeFormatter.ofPattern("H:mm")
private fun splitAddresses(s: String) = s.split(Regex("[,;\\s]+")).map { it.trim() }.filter { it.isNotEmpty() }

class EditorViewModel(private val c: AppContainer, private val routineId: String?) : ViewModel() {
    var form by mutableStateOf(EditorForm()); private set
    var loaded by mutableStateOf(routineId == null); private set
    var issues by mutableStateOf<List<ValidationIssue>>(emptyList()); private set
    var message by mutableStateOf<String?>(null)
    var consentActive by mutableStateOf(false); private set
    var consentConfirmed by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    /** Bumped whenever the body text is replaced from outside the text field (format switch, AI draft). */
    var bodyVersion by mutableStateOf(0); private set

    var aiBusy by mutableStateOf(false); private set
    var aiProposal by mutableStateOf<AiDraft?>(null); private set
    var aiError by mutableStateOf<String?>(null); private set
    val aiConfigured get() = c.drafter.isConfigured
    val aiProviderLabel get() = c.aiSettings.provider.label

    private var existing: Routine? = null
    private val newAttachmentIds = mutableSetOf<String>()
    private val removedAttachmentIds = mutableSetOf<String>()

    init {
        if (routineId != null) viewModelScope.launch {
            val r = c.repository.routine(routineId)
            existing = r
            if (r != null) { form = r.toForm(); consentActive = Consent.isValid(r) }
            loaded = true
        }
    }

    fun edit(f: (EditorForm) -> EditorForm) { form = f(form) }

    /** Switches the body between plain text and rich (HTML), converting the current text. */
    fun setRichFormat(rich: Boolean) {
        val b = form.body
        if (rich == HtmlTemplate.isHtml(b)) return
        form = form.copy(body = if (rich) HtmlTemplate.wrap(HtmlTemplate.fromPlain(b)) else HtmlTemplate.toText(HtmlTemplate.content(b)))
        bodyVersion += 1
    }

    private fun plainBody(): String = HtmlTemplate.toText(HtmlTemplate.content(form.body)).takeIf { HtmlTemplate.isHtml(form.body) } ?: form.body

    fun setWantsAuto(on: Boolean) {
        form = form.copy(wantsAuto = on)
        if (!on) consentConfirmed = false
    }
    fun confirmConsent() { consentConfirmed = true; form = form.copy(wantsAuto = true) }

    private fun Routine.toForm() = EditorForm(
        name, recipients.to.joinToString(", "), recipients.cc.joinToString(", "), recipients.bcc.joinToString(", "),
        schedule.kind, schedule.days, schedule.time.format(DateTimeFormatter.ofPattern("HH:mm")), schedule.zoneId,
        template.subject, template.body,
        template.fields.map { FieldForm(it.key, it.label, it.type, it.required, it.defaultValue.orEmpty(), it.choices.joinToString(", ")) },
        attachments, maxLateMinutes.toString(), reminderLeadMinutes.toString(), Consent.isValid(this),
    )

    private fun templateOf(f: EditorForm) = EmailTemplate(
        f.subject, f.body,
        f.fields.map { TemplateField(it.key.trim(), it.label.trim(), it.type, it.required, it.default.ifBlank { null }, it.choices.split(',').map { s -> s.trim() }.filter { s -> s.isNotEmpty() }) },
    )

    /** Builds the routine from the form, or returns the parse problems. */
    private fun build(): Pair<Routine?, List<ValidationIssue>> {
        val f = form
        val problems = mutableListOf<ValidationIssue>()
        val time = runCatching { LocalTime.parse(f.time.trim(), TIME_FMT) }.getOrNull()
        if (time == null) problems += ValidationIssue("schedule", "Time must look like 09:30")
        val late = f.maxLate.trim().toIntOrNull()
        if (late == null) problems += ValidationIssue("autoSend", "Late window must be a number of minutes")
        val lead = f.lead.trim().toIntOrNull()
        if (lead == null) problems += ValidationIssue("reminder", "Reminder lead must be a number of minutes")
        if (problems.isNotEmpty()) return null to problems
        val now = c.clock.now()
        val old = existing
        return Routine(
            id = old?.id ?: UUID.randomUUID().toString(), name = f.name.trim(),
            recipients = Recipients(splitAddresses(f.to), splitAddresses(f.cc), splitAddresses(f.bcc)),
            template = templateOf(f),
            schedule = Schedule(f.kind, f.days, time!!, f.zone.trim()),
            attachments = f.attachments, paused = old?.paused ?: false, activeSince = old?.activeSince ?: now,
            autoSendEnabled = old?.autoSendEnabled ?: false, consent = old?.consent,
            maxLateMinutes = late!!, reminderLeadMinutes = lead!!, createdAt = old?.createdAt ?: now, updatedAt = now,
        ) to emptyList()
    }

    /** True when saving the current form would invalidate an existing automatic-send approval. */
    val willRevokeConsent: Boolean
        get() = consentActive && !consentConfirmed && build().first?.let { !Consent.isValid(it) } == true

    fun preview(): RenderedEmail? {
        val r = build().first ?: return null
        val zone = runCatching { ZoneId.of(r.schedule.zoneId) }.getOrDefault(ZoneId.systemDefault())
        return Placeholders.render(r.template, emptyMap(), r.name.ifBlank { "Routine" }, LocalDate.now(zone))
    }

    fun save(onDone: () -> Unit) {
        viewModelScope.launch {
            busy = true
            val (routine, parseIssues) = build()
            if (routine == null) { issues = parseIssues; busy = false; return@launch }
            when (val r = c.repository.save(routine)) {
                is SaveResult.Invalid -> issues = r.issues
                is SaveResult.Saved -> {
                    val id = r.routine.id
                    when {
                        form.wantsAuto && consentConfirmed -> c.repository.grantAutoSend(id)
                        !form.wantsAuto -> c.repository.revokeAutoSend(id)
                    }
                    removedAttachmentIds.forEach { c.attachments.delete(it) }
                    newAttachmentIds.clear()
                    c.scheduler.sweepNow()
                    onDone()
                }
            }
            busy = false
        }
    }

    fun delete(onDone: () -> Unit) {
        val r = existing ?: return
        viewModelScope.launch {
            c.repository.delete(r.id)
            r.attachments.forEach { c.attachments.delete(it.id) }
            c.scheduler.sweepNow()
            onDone()
        }
    }

    fun addAttachment(uri: Uri) {
        if (form.attachments.size >= Limits.MAX_ATTACHMENTS) { message = "At most ${Limits.MAX_ATTACHMENTS} attachments"; return }
        viewModelScope.launch {
            when (val r = c.attachments.import(uri, required = true)) {
                is AttachmentImport.Ok -> {
                    if (form.attachments.sumOf { it.sizeBytes } + r.ref.sizeBytes > Limits.MAX_TOTAL_ATTACHMENT_BYTES) {
                        c.attachments.delete(r.ref.id); message = "Attachments exceed ${Limits.MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB in total"
                    } else { newAttachmentIds += r.ref.id; form = form.copy(attachments = form.attachments + r.ref) }
                }
                is AttachmentImport.Rejected -> message = r.reason
            }
        }
    }

    fun removeAttachment(ref: AttachmentRef) {
        form = form.copy(attachments = form.attachments - ref)
        if (!newAttachmentIds.remove(ref.id)) removedAttachmentIds += ref.id else c.attachments.delete(ref.id)
    }

    fun setAttachmentRequired(ref: AttachmentRef, required: Boolean) {
        form = form.copy(attachments = form.attachments.map { if (it.id == ref.id) it.copy(required = required) else it })
    }

    /** The plain-text body that was sent with the last request, to tell whether the AI actually changed it. */
    private var aiSentBody: String? = null

    fun requestAi(instruction: String) {
        viewModelScope.launch {
            aiBusy = true; aiError = null
            val sent = plainBody()
            aiSentBody = sent
            when (val r = c.drafter.draft(instruction, form.subject, sent, form.fields.map { it.key.trim() }.toSet())) {
                is AiResult.Success -> aiProposal = r.draft
                AiResult.NotConfigured -> aiError = "AI drafting isn't set up. Add a key in Settings."
                is AiResult.Error -> aiError = r.message
            }
            aiBusy = false
        }
    }
    /** Copies the proposal into the editor only. Nothing is saved, and approvals are re-checked on save. */
    fun applyAi() {
        aiProposal?.let {
            // A body the AI left as it was (e.g. "New subject") is not rewritten, so rich formatting survives.
            val bodyUnchanged = it.body.trim() == aiSentBody?.trim()
            val body = when {
                bodyUnchanged -> form.body
                HtmlTemplate.isHtml(form.body) -> HtmlTemplate.wrap(HtmlTemplate.fromPlain(it.body))
                else -> it.body
            }
            form = form.copy(subject = it.subject, body = body); bodyVersion += 1
        }
        aiProposal = null
    }
    fun discardAi() { aiProposal = null; aiError = null }

    /** Removes files copied during this editing session that were never saved. */
    fun discard() { newAttachmentIds.forEach { c.attachments.delete(it) }; newAttachmentIds.clear() }
    override fun onCleared() = discard()
}

class OccurrenceViewModel(private val c: AppContainer, private val id: String) : ViewModel() {
    val occurrence: StateFlow<Occurrence?> = c.repository.observeOccurrence(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val routine: StateFlow<Routine?> = combine(c.repository.observeRoutines(), occurrence) { rs, o -> rs.firstOrNull { it.id == o?.routineId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val attempts: StateFlow<List<Attempt>> = c.repository.observeAttemptsFor(id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val account = c.auth.state
    val values = mutableStateMapOf<String, String>()
    var message by mutableStateOf<String?>(null)

    val aiConfigured get() = c.drafter.isConfigured
    val aiProviderLabel get() = c.aiSettings.provider.label
    var aiBusy by mutableStateOf(false); private set
    var aiProposal by mutableStateOf<String?>(null); private set
    var aiError by mutableStateOf<String?>(null); private set
    /** Bumped when the assist dialog closes so a reply that arrives late is dropped instead of shown in the next one. */
    private var aiRun = 0

    init {
        viewModelScope.launch { occurrence.filterNotNull().first().let { values.putAll(it.values) } }
    }

    fun attachmentAvailable(ref: AttachmentRef) = c.attachments.isAvailable(ref)

    /** Asks the AI to write or rewrite one field of this email. Sends only that field's label and text plus the instruction. */
    fun requestFieldAi(field: TemplateField, instruction: String) {
        val run = ++aiRun
        viewModelScope.launch {
            aiBusy = true; aiError = null; aiProposal = null
            val request = AiTextRequest(instruction, values[field.key].orEmpty(), field.label, field.type != FieldType.MULTILINE, field.maxLength)
            val result = c.drafter.writeText(request)
            if (run == aiRun) {
                when (result) {
                    is AiTextResult.Success -> aiProposal = result.text
                    AiTextResult.NotConfigured -> aiError = "AI isn't set up. Add a key in Settings."
                    is AiTextResult.Error -> aiError = result.message
                }
                aiBusy = false
            }
        }
    }

    /** Puts the proposal into the field (nothing is saved or sent). Returns false, keeping the dialog open, if the field wouldn't accept it. */
    fun applyFieldAi(field: TemplateField): Boolean {
        val text = aiProposal ?: return false
        FieldValidator.validateValue(field, text)?.let { aiError = it; return false }
        values[field.key] = text
        discardFieldAi()
        return true
    }

    fun discardFieldAi() { aiRun++; aiProposal = null; aiError = null; aiBusy = false }

    fun save() = viewModelScope.launch {
        message = if (c.repository.saveValues(id, values.toMap())) "Saved" else "This item can't be edited in its current state"
    }

    fun sendNow() = viewModelScope.launch {
        val o = occurrence.value ?: return@launch
        if (o.state in StateMachine.SENDABLE) {
            if (!c.repository.saveValues(id, values.toMap())) { message = "Couldn't save your inputs"; return@launch }
            c.scheduler.enqueueSend(id, SendMode.MANUAL, Duration.ZERO)
            message = "Sending…"
        }
    }
    fun skip() = viewModelScope.launch { c.repository.skip(id); c.scheduler.sweepNow() }
    fun resetForRetry() = viewModelScope.launch { c.repository.resetForRetry(id) }
    fun confirmSent() = viewModelScope.launch { c.repository.confirmSent(id) }
    fun confirmNotSent() = viewModelScope.launch { c.repository.confirmNotSent(id) }
}

class HistoryViewModel(c: AppContainer) : ViewModel() {
    val rows: StateFlow<List<AttemptWithRoutine>> = c.repository.observeAttempts().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
}

class SettingsViewModel(private val c: AppContainer) : ViewModel() {
    val account = c.auth.state
    var message by mutableStateOf<String?>(null)
    var pendingImport by mutableStateOf<BackupResult.Success?>(null); private set
    /** Provider currently shown in Settings; [aiActive] is the one actually in use until Save is tapped. */
    var aiProvider by mutableStateOf(c.aiSettings.provider); private set
    var aiActive by mutableStateOf(c.aiSettings.provider); private set
    var aiKeySet by mutableStateOf(c.aiSettings.keyFor(c.aiSettings.provider) != null); private set
    val aiStorageAvailable get() = c.aiSettings.storageAvailable
    var aiModel by mutableStateOf(c.aiSettings.modelFor(c.aiSettings.provider))

    /** Starts (re)authorization. Calls [showConsent] when Google needs to show a consent screen. */
    fun connect(showConsent: (PendingIntent) -> Unit) {
        viewModelScope.launch {
            try {
                val res = c.auth.beginAuthorization()
                val pi = res.pendingIntent
                if (res.hasResolution() && pi != null) showConsent(pi)
                else { c.auth.completeConnection(res); message = "Gmail connected" }
            } catch (e: ApiException) { message = authError(e) }
            catch (e: Exception) { message = "Couldn't reach Google. Check your connection and try again." }
        }
    }

    fun onAuthResult(resultCode: Int, data: Intent?) {
        if (resultCode == Activity.RESULT_CANCELED && data == null) { message = "Authorization was cancelled."; return }
        try { c.auth.completeConnection(c.auth.resultFromIntent(data)); message = "Gmail connected"; c.scheduler.sweepNow() }
        catch (e: Exception) { message = authError(e) }
    }

    /** Maps the real failure to an actionable message instead of one generic text. Contains no tokens or addresses. */
    private fun authError(e: Exception): String {
        val code = (e as? ApiException)?.statusCode
        return when (code) {
            CommonStatusCodes.DEVELOPER_ERROR ->
                "Google rejected this build (error 10). The Android OAuth client must match package com.duapharma.mailroutine " +
                    "(or .debug) and the SHA-1 of the certificate this APK is signed with. See README > Google OAuth configuration."
            CommonStatusCodes.NETWORK_ERROR, CommonStatusCodes.TIMEOUT ->
                "Couldn't reach Google. Check your connection and try again."
            CommonStatusCodes.CANCELED, CommonStatusCodes.INTERRUPTED -> "Authorization was cancelled."
            else ->
                "Authorization failed" + (code?.let { " (error $it)" } ?: "") +
                    ". If the consent screen is in Testing, add your account as a test user; with Google Workspace, an administrator may need to allow this app."
        }
    }

    fun disconnect() = viewModelScope.launch { c.auth.disconnect(); message = "Disconnected. Automatic sending is paused until you reconnect." }

    fun exportBackup(uri: Uri) = viewModelScope.launch {
        try {
            val text = BackupCodec.encode(c.repository.allRoutines(), c.clock.now())
            withContext(Dispatchers.IO) { c.appContext.contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray()) } ?: error("no stream") }
            message = "Backup saved. It contains recipient addresses but no credentials — keep it private."
        } catch (e: Exception) { message = "Couldn't write the backup file" }
    }

    fun readBackup(uri: Uri) = viewModelScope.launch {
        try {
            val text = withContext(Dispatchers.IO) {
                c.appContext.contentResolver.openInputStream(uri)?.use { s ->
                    // Bounded read (readNBytes needs API 33): stop just past the limit so oversized files are rejected cheaply.
                    val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(8192); var total = 0
                    while (total <= BackupCodec.MAX_BYTES) { val n = s.read(buf); if (n < 0) break; total += n; out.write(buf, 0, n) }
                    String(out.toByteArray(), Charsets.UTF_8)
                } ?: error("no stream")
            }
            when (val r = BackupCodec.decode(text, c.clock.now()) { UUID.randomUUID().toString() }) {
                is BackupResult.Success -> pendingImport = r
                is BackupResult.Invalid -> message = "Backup rejected: " + r.errors.take(3).joinToString("; ")
            }
        } catch (e: Exception) { message = "Couldn't read the backup file" }
    }

    fun confirmImport() = viewModelScope.launch {
        pendingImport?.let { c.repository.importRoutines(it.routines); message = "Imported ${it.routines.size} routine(s), paused and with automatic sending off" }
        pendingImport = null
    }
    fun cancelImport() { pendingImport = null }

    fun selectAiProvider(p: AiProvider) {
        aiProvider = p
        aiKeySet = c.aiSettings.keyFor(p) != null
        aiModel = c.aiSettings.modelFor(p)
    }

    /** A blank [key] keeps the stored one, so the model or provider can be changed without retyping it. */
    fun saveAi(key: String) {
        val s = c.aiSettings
        if (key.isNotBlank()) s.setKey(aiProvider, key)
        s.setModel(aiProvider, aiModel)
        s.provider = aiProvider
        aiActive = aiProvider
        aiKeySet = s.keyFor(aiProvider) != null
        aiModel = s.modelFor(aiProvider)
        message = if (aiKeySet) "${aiProvider.label} is now used for AI writing" else "Add an API key to turn AI writing on"
    }

    fun clearAi() { c.aiSettings.setKey(aiProvider, null); aiKeySet = false; message = "${aiProvider.label} key removed" }
}
