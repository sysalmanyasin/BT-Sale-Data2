package com.duapharma.mailroutine.data

import com.duapharma.mailroutine.domain.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

private fun Long.toInstant() = Instant.ofEpochMilli(this)

internal fun listToJson(l: List<String>) = JSONArray(l).toString()
internal fun jsonToList(s: String): List<String> = JSONArray(s).let { a -> (0 until a.length()).map { a.getString(it) } }

internal fun mapToJson(m: Map<String, String>) = JSONObject(m).toString()
internal fun jsonToMap(s: String): Map<String, String> = JSONObject(s).let { o -> o.keys().asSequence().associateWith { o.getString(it) } }

private fun fieldsToJson(fields: List<TemplateField>) = JSONArray().also { a ->
    fields.forEach { f ->
        a.put(JSONObject().put("key", f.key).put("label", f.label).put("type", f.type.name).put("required", f.required)
            .put("default", f.defaultValue ?: JSONObject.NULL).put("choices", JSONArray(f.choices)).put("max", f.maxLength))
    }
}.toString()

private fun jsonToFields(s: String): List<TemplateField> = JSONArray(s).let { a ->
    (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        TemplateField(
            o.getString("key"), o.getString("label"), FieldType.valueOf(o.getString("type")), o.getBoolean("required"),
            if (o.isNull("default")) null else o.getString("default"),
            o.getJSONArray("choices").let { c -> (0 until c.length()).map { c.getString(it) } }, o.getInt("max"),
        )
    }
}

private fun attachmentsToJson(l: List<AttachmentRef>) = JSONArray().also { a ->
    l.forEach { a.put(JSONObject().put("id", it.id).put("name", it.displayName).put("size", it.sizeBytes).put("mime", it.mimeType).put("required", it.required)) }
}.toString()

private fun jsonToAttachments(s: String): List<AttachmentRef> = JSONArray(s).let { a ->
    (0 until a.length()).map { i -> a.getJSONObject(i).let { AttachmentRef(it.getString("id"), it.getString("name"), it.getLong("size"), it.getString("mime"), it.getBoolean("required")) } }
}

fun Routine.toEntity() = RoutineEntity(
    id, name, listToJson(recipients.to), listToJson(recipients.cc), listToJson(recipients.bcc),
    template.subject, template.body, fieldsToJson(template.fields), attachmentsToJson(attachments),
    schedule.kind.name, schedule.days.joinToString(",") { it.name }, schedule.time.toString(), schedule.zoneId,
    paused, activeSince.toEpochMilli(), autoSendEnabled, consent?.grantedAt?.toEpochMilli(), consent?.fingerprint,
    maxLateMinutes, reminderLeadMinutes, createdAt.toEpochMilli(), updatedAt.toEpochMilli(),
)

fun RoutineEntity.toDomain() = Routine(
    id = id, name = name,
    recipients = Recipients(jsonToList(toJson), jsonToList(ccJson), jsonToList(bccJson)),
    template = EmailTemplate(subject, body, jsonToFields(fieldsJson)),
    schedule = Schedule(ScheduleKind.valueOf(scheduleKind), daysCsv.split(',').filter { it.isNotBlank() }.map { DayOfWeek.valueOf(it) }.toSet(), LocalTime.parse(time), zoneId),
    attachments = jsonToAttachments(attachmentsJson), paused = paused, activeSince = activeSinceMs.toInstant(),
    autoSendEnabled = autoSendEnabled,
    consent = if (consentAtMs != null && consentFingerprint != null) AutoSendConsent(consentAtMs.toInstant(), consentFingerprint) else null,
    maxLateMinutes = maxLateMinutes, reminderLeadMinutes = reminderLeadMinutes,
    createdAt = createdAtMs.toInstant(), updatedAt = updatedAtMs.toInstant(),
)

fun Occurrence.toEntity() = OccurrenceEntity(
    id, routineId, localDate.toString(), dueAt.toEpochMilli(), state.name, mapToJson(values), attempts,
    leaseUntil?.toEpochMilli(), nextRetryAt?.toEpochMilli(), gmailMessageId, lastErrorCode,
    reminderSentAt?.toEpochMilli(), attentionNotifiedFor?.name, updatedAt.toEpochMilli(),
)

fun OccurrenceEntity.toDomain() = Occurrence(
    id, routineId, LocalDate.parse(localDate), dueAtMs.toInstant(), OccurrenceState.valueOf(state), jsonToMap(valuesJson), attempts,
    leaseUntilMs?.toInstant(), nextRetryAtMs?.toInstant(), gmailMessageId, lastErrorCode, reminderSentAtMs?.toInstant(),
    attentionNotifiedFor?.let { OccurrenceState.valueOf(it) }, updatedAtMs.toInstant(),
)

fun Attempt.toEntity() = AttemptEntity(id, occurrenceId, startedAt.toEpochMilli(), finishedAt?.toEpochMilli(), outcome.name, errorCode, gmailMessageId, subject)
fun AttemptEntity.toDomain() = Attempt(id, occurrenceId, startedAtMs.toInstant(), finishedAtMs?.toInstant(), AttemptOutcome.valueOf(outcome), errorCode, gmailMessageId, subject)
