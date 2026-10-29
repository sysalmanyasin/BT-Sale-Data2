package com.duapharma.mailroutine.domain

import java.math.BigDecimal
import java.time.DateTimeException
import java.time.LocalDate
import java.time.ZoneId

object Limits {
    const val MAX_RECIPIENTS = 50
    const val MAX_ADDRESS_LENGTH = 254
    const val MAX_FIELDS = 30
    const val MAX_SUBJECT = 300
    const val MAX_BODY = 50_000
    const val MAX_NAME = 100
    const val MAX_ATTACHMENTS = 10
    const val MAX_ATTACHMENT_BYTES = 10L * 1024 * 1024
    /** Base64 inflates attachments by about a third and Gmail refuses messages over 25 MB, so keep raw attachments well under that. */
    const val MAX_TOTAL_ATTACHMENT_BYTES = 17L * 1024 * 1024
    const val MAX_CHOICES = 50
}

data class ValidationIssue(val field: String, val message: String)

object EmailValidator {
    // Pragmatic check: plain addr-spec only (no display names, quotes or comments).
    private val LOCAL = Regex("^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$")
    private val LABEL = Regex("^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")

    fun isValid(address: String): Boolean {
        if (address.isEmpty() || address.length > Limits.MAX_ADDRESS_LENGTH) return false
        if (address.any { it.isWhitespace() || it.isISOControl() }) return false // blocks CR/LF header injection
        val at = address.lastIndexOf('@')
        if (at <= 0 || at == address.length - 1) return false
        val local = address.substring(0, at)
        val domain = address.substring(at + 1)
        if (local.length > 64 || !LOCAL.matches(local)) return false
        val labels = domain.split('.')
        if (labels.size < 2) return false
        if (!labels.all { LABEL.matches(it) }) return false
        return labels.last().length >= 2 && !labels.last().all { it.isDigit() }
    }

    fun normalize(address: String) = address.trim()
}

object FieldValidator {
    val KEY = Regex("^[a-z][a-z0-9_]{0,31}$")
    val BUILT_IN_KEYS = setOf("date", "weekday", "routine_name")

    /** Validates a field *definition* (editor/backup import). */
    fun validateDefinition(f: TemplateField): List<ValidationIssue> {
        val out = mutableListOf<ValidationIssue>()
        if (!KEY.matches(f.key)) out += ValidationIssue("field.${f.key}", "Key must be lowercase letters, digits or _ (max 32), starting with a letter")
        if (f.key in BUILT_IN_KEYS) out += ValidationIssue("field.${f.key}", "Key is reserved")
        if (f.label.isBlank() || f.label.length > 80) out += ValidationIssue("field.${f.key}", "Label must be 1–80 characters")
        if (f.maxLength !in 1..10_000) out += ValidationIssue("field.${f.key}", "Max length must be 1–10000")
        if (f.type == FieldType.CHOICE) {
            if (f.choices.isEmpty() || f.choices.size > Limits.MAX_CHOICES) out += ValidationIssue("field.${f.key}", "Choice fields need 1–${Limits.MAX_CHOICES} choices")
            if (f.choices.any { it.isBlank() || it.length > 100 } || f.choices.toSet().size != f.choices.size) out += ValidationIssue("field.${f.key}", "Choices must be unique, non-blank and ≤100 chars")
        }
        f.defaultValue?.let { d -> validateValue(f, d, allowBlank = true)?.let { out += ValidationIssue("field.${f.key}", "Default: $it") } }
        return out
    }

    private val TIME_24H = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")

    /** Returns an error message, or null when [raw] is acceptable for [f]. Blank handled by caller for required. */
    fun validateValue(f: TemplateField, raw: String, allowBlank: Boolean = false): String? {
        if (raw.isBlank()) return if (allowBlank || !f.required) null else "Required"
        if (raw.length > f.maxLength) return "Too long (max ${f.maxLength})"
        if (f.type != FieldType.MULTILINE && raw.any { it == '\n' || it == '\r' }) return "Must be a single line"
        if (raw.any { it.isISOControl() && it != '\n' && it != '\r' && it != '\t' }) return "Contains control characters"
        return when (f.type) {
            FieldType.TEXT, FieldType.MULTILINE -> null
            FieldType.NUMBER -> if (runCatching { BigDecimal(raw.trim()) }.isSuccess) null else "Not a number"
            FieldType.DATE -> if (runCatching { LocalDate.parse(raw.trim()) }.isSuccess) null else "Use YYYY-MM-DD"
            FieldType.TIME -> if (TIME_24H.matches(raw.trim())) null else "Use 24-hour HH:mm, 00:00 to 23:59"
            FieldType.BOOLEAN -> if (raw.trim() == "true" || raw.trim() == "false") null else "Must be true or false"
            FieldType.CHOICE -> if (raw in f.choices) null else "Not one of the allowed choices"
        }
    }

    /** Effective value: explicit input, else the default; blank counts as missing. */
    fun effectiveValue(f: TemplateField, values: Map<String, String>): String? =
        values[f.key]?.takeIf { it.isNotBlank() } ?: f.defaultValue?.takeIf { it.isNotBlank() }

    /** Validates a set of values against all fields, reporting missing required and malformed values. */
    fun validateValues(fields: List<TemplateField>, values: Map<String, String>): List<ValidationIssue> {
        val out = mutableListOf<ValidationIssue>()
        for (f in fields) {
            val v = effectiveValue(f, values)
            if (v == null) {
                if (f.required) out += ValidationIssue(f.key, "${f.label} is required")
            } else validateValue(f, v)?.let { out += ValidationIssue(f.key, "${f.label}: $it") }
        }
        return out
    }
}

object RoutineValidator {
    fun validate(r: Routine): List<ValidationIssue> {
        val out = mutableListOf<ValidationIssue>()
        if (r.name.isBlank() || r.name.length > Limits.MAX_NAME) out += ValidationIssue("name", "Name must be 1–${Limits.MAX_NAME} characters")

        val rc = r.recipients
        if (rc.to.isEmpty()) out += ValidationIssue("to", "At least one To recipient is required")
        if (rc.all.size > Limits.MAX_RECIPIENTS) out += ValidationIssue("recipients", "At most ${Limits.MAX_RECIPIENTS} recipients")
        rc.all.filterNot(EmailValidator::isValid).forEach { out += ValidationIssue("recipients", "Invalid address: ${redact(it)}") }
        val seen = HashSet<String>()
        rc.all.forEach { if (!seen.add(it.lowercase())) out += ValidationIssue("recipients", "Duplicate address: ${redact(it)}") }

        val t = r.template
        if (t.subject.isBlank() || t.subject.length > Limits.MAX_SUBJECT) out += ValidationIssue("subject", "Subject must be 1–${Limits.MAX_SUBJECT} characters")
        if (t.subject.any { it == '\n' || it == '\r' }) out += ValidationIssue("subject", "Subject must be a single line")
        if (t.body.length > Limits.MAX_BODY) out += ValidationIssue("body", "Body too long")
        if (t.fields.size > Limits.MAX_FIELDS) out += ValidationIssue("fields", "At most ${Limits.MAX_FIELDS} fields")
        t.fields.forEach { out += FieldValidator.validateDefinition(it) }
        if (t.fields.map { it.key }.toSet().size != t.fields.size) out += ValidationIssue("fields", "Field keys must be unique")
        val known = t.fields.map { it.key }.toSet() + FieldValidator.BUILT_IN_KEYS
        (Placeholders.keysIn(t.subject) + Placeholders.keysIn(t.body)).filter { it !in known }.toSet()
            .forEach { out += ValidationIssue("template", "Unknown placeholder {{$it}}") }

        val s = r.schedule
        if (s.kind == ScheduleKind.WEEKLY && s.days.isEmpty()) out += ValidationIssue("schedule", "Pick at least one weekday")
        try { ZoneId.of(s.zoneId) } catch (e: DateTimeException) { out += ValidationIssue("schedule", "Unknown time zone") }
        if (r.maxLateMinutes !in 0..10_080) out += ValidationIssue("autoSend", "Late window must be 0–10080 minutes")
        if (r.reminderLeadMinutes !in 0..10_080) out += ValidationIssue("reminder", "Reminder lead must be 0–10080 minutes")

        if (r.attachments.size > Limits.MAX_ATTACHMENTS) out += ValidationIssue("attachments", "At most ${Limits.MAX_ATTACHMENTS} attachments")
        r.attachments.forEach { a ->
            if (a.sizeBytes <= 0) out += ValidationIssue("attachments", "${a.displayName}: file is empty")
            if (a.sizeBytes > Limits.MAX_ATTACHMENT_BYTES) out += ValidationIssue("attachments", "${a.displayName}: larger than ${Limits.MAX_ATTACHMENT_BYTES / 1024 / 1024} MB")
        }
        if (r.attachments.sumOf { it.sizeBytes } > Limits.MAX_TOTAL_ATTACHMENT_BYTES) out += ValidationIssue("attachments", "Attachments exceed ${Limits.MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB in total")
        return out
    }

    /** Keeps addresses out of error strings that may reach logs. */
    private fun redact(a: String): String {
        val at = a.lastIndexOf('@')
        return if (at <= 0) "***" else "${a.first()}***${a.substring(at)}"
    }
}

object AttachmentRules {
    private val BLOCKED = setOf(
        "ade", "adp", "apk", "appx", "bat", "chm", "cmd", "com", "cpl", "dll", "dmg", "exe", "hta", "ins", "isp",
        "iso", "jar", "js", "jse", "lib", "lnk", "mde", "msc", "msi", "msix", "msp", "mst", "nsh", "pif", "ps1",
        "scr", "sct", "shb", "sys", "vb", "vbe", "vbs", "vxd", "wsc", "wsf", "wsh",
    )

    /** Gmail rejects these; failing early avoids a doomed send. */
    fun isBlockedName(name: String): Boolean = name.substringAfterLast('.', "").lowercase() in BLOCKED

    fun validatePick(name: String, sizeBytes: Long): String? = when {
        name.isBlank() -> "File has no name"
        isBlockedName(name) -> "This file type is blocked by Gmail"
        sizeBytes <= 0 -> "File is empty"
        sizeBytes > Limits.MAX_ATTACHMENT_BYTES -> "File is larger than ${Limits.MAX_ATTACHMENT_BYTES / 1024 / 1024} MB"
        else -> null
    }
}
