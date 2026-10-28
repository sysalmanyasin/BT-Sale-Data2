package com.duapharma.mailroutine.backup

import com.duapharma.mailroutine.domain.*
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime

sealed interface BackupResult {
    data class Success(val routines: List<Routine>, val warnings: List<String>) : BackupResult
    data class Invalid(val errors: List<String>) : BackupResult
}

/**
 * Versioned, credential-free backup. Contains routine definitions only (recipients are included,
 * so treat the file as personal data). Never contains tokens, API keys, consent, attachment
 * contents/URIs or history. Imported routines come back paused with automatic sending OFF.
 */
object BackupCodec {
    const val FORMAT = "mailroutine-backup"
    const val VERSION = 1
    const val MAX_BYTES = 2_000_000
    const val MAX_ROUTINES = 200

    fun encode(routines: List<Routine>, now: Instant): String {
        val root = JSONObject()
        root.put("format", FORMAT).put("version", VERSION).put("exportedAt", now.toString())
        val arr = JSONArray()
        routines.forEach { r ->
            val o = JSONObject()
            o.put("name", r.name)
            o.put("recipients", JSONObject().put("to", JSONArray(r.recipients.to)).put("cc", JSONArray(r.recipients.cc)).put("bcc", JSONArray(r.recipients.bcc)))
            o.put("subject", r.template.subject).put("body", r.template.body)
            o.put("fields", JSONArray().also { fa ->
                r.template.fields.forEach { f ->
                    fa.put(JSONObject().put("key", f.key).put("label", f.label).put("type", f.type.name).put("required", f.required)
                        .put("defaultValue", f.defaultValue ?: JSONObject.NULL).put("choices", JSONArray(f.choices)).put("maxLength", f.maxLength))
                }
            })
            o.put("schedule", JSONObject().put("kind", r.schedule.kind.name).put("days", JSONArray(r.schedule.days.map { it.name }.sorted()))
                .put("time", r.schedule.time.toString()).put("zoneId", r.schedule.zoneId))
            o.put("maxLateMinutes", r.maxLateMinutes).put("reminderLeadMinutes", r.reminderLeadMinutes)
            o.put("attachmentNames", JSONArray(r.attachments.map { it.displayName }))
            arr.put(o)
        }
        root.put("routines", arr)
        return root.toString(2)
    }

    fun decode(text: String, now: Instant, newId: () -> String): BackupResult {
        if (text.length > MAX_BYTES) return BackupResult.Invalid(listOf("Backup file is too large"))
        val root = try { JSONObject(text) } catch (e: JSONException) { return BackupResult.Invalid(listOf("Not a valid backup file")) }
        if (root.optString("format") != FORMAT) return BackupResult.Invalid(listOf("Not a MailRoutine backup"))
        val version = root.optInt("version", -1)
        if (version < 1) return BackupResult.Invalid(listOf("Missing or invalid backup version"))
        if (version > VERSION) return BackupResult.Invalid(listOf("Backup was made by a newer app version ($version); update the app first"))
        val arr = root.optJSONArray("routines") ?: return BackupResult.Invalid(listOf("Backup has no routines list"))
        if (arr.length() > MAX_ROUTINES) return BackupResult.Invalid(listOf("Too many routines (max $MAX_ROUTINES)"))

        val errors = mutableListOf<String>()
        val warnings = mutableListOf<String>()
        val routines = mutableListOf<Routine>()
        for (i in 0 until arr.length()) {
            val label = "Routine ${i + 1}"
            val o = arr.optJSONObject(i)
            if (o == null) { errors += "$label: not an object"; continue }
            try {
                val r = parseRoutine(o, now, newId, warnings, label)
                val issues = RoutineValidator.validate(r)
                if (issues.isEmpty()) routines += r else issues.forEach { errors += "$label: ${it.message}" }
            } catch (e: IllegalArgumentException) {
                errors += "$label: ${e.message}"
            } catch (e: JSONException) {
                errors += "$label: malformed data"
            }
        }
        return if (errors.isEmpty()) BackupResult.Success(routines, warnings) else BackupResult.Invalid(errors)
    }

    private fun parseRoutine(o: JSONObject, now: Instant, newId: () -> String, warnings: MutableList<String>, label: String): Routine {
        fun strings(a: JSONArray?): List<String> {
            if (a == null) return emptyList()
            return (0 until a.length()).map { idx -> a.get(idx) as? String ?: throw IllegalArgumentException("expected text values") }
        }
        val rc = o.optJSONObject("recipients") ?: throw IllegalArgumentException("recipients missing")
        val fields = o.optJSONArray("fields") ?: JSONArray()
        val template = EmailTemplate(
            subject = o.getString("subject"),
            body = o.optString("body", ""),
            fields = (0 until fields.length()).map { idx ->
                val f = fields.optJSONObject(idx) ?: throw IllegalArgumentException("field is not an object")
                TemplateField(
                    key = f.getString("key"),
                    label = f.getString("label"),
                    type = enumOf<FieldType>(f.getString("type"), "field type"),
                    required = f.optBoolean("required", false),
                    defaultValue = if (f.isNull("defaultValue") || !f.has("defaultValue")) null else f.getString("defaultValue"),
                    choices = strings(f.optJSONArray("choices")),
                    maxLength = f.optInt("maxLength", 2000),
                )
            },
        )
        val s = o.optJSONObject("schedule") ?: throw IllegalArgumentException("schedule missing")
        val schedule = Schedule(
            kind = enumOf<ScheduleKind>(s.getString("kind"), "schedule kind"),
            days = strings(s.optJSONArray("days")).map { enumOf<DayOfWeek>(it, "weekday") }.toSet(),
            time = try { LocalTime.parse(s.getString("time")) } catch (e: Exception) { throw IllegalArgumentException("invalid time") },
            zoneId = s.getString("zoneId"),
        )
        val names = strings(o.optJSONArray("attachmentNames"))
        if (names.isNotEmpty()) warnings += "$label: ${names.size} attachment(s) were not restored; re-attach them"
        warnings += "$label: imported paused with automatic sending off"
        return Routine(
            id = newId(),
            name = o.getString("name"),
            recipients = Recipients(strings(rc.optJSONArray("to")), strings(rc.optJSONArray("cc")), strings(rc.optJSONArray("bcc"))),
            template = template,
            schedule = schedule,
            paused = true,
            activeSince = now,
            maxLateMinutes = o.optInt("maxLateMinutes", 120),
            reminderLeadMinutes = o.optInt("reminderLeadMinutes", 15),
            createdAt = now,
            updatedAt = now,
        )
    }

    private inline fun <reified E : Enum<E>> enumOf(v: String, what: String): E =
        enumValues<E>().firstOrNull { it.name == v } ?: throw IllegalArgumentException("unknown $what")
}
