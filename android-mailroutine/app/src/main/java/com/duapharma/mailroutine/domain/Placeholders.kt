package com.duapharma.mailroutine.domain

import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

data class RenderedEmail(
    val subject: String,
    val body: String,
    /** Placeholders that had no usable value (left visibly as «key» in previews, never sent). */
    val missingKeys: Set<String>,
    val issues: List<ValidationIssue>,
) {
    val isComplete: Boolean get() = missingKeys.isEmpty() && issues.isEmpty()
}

object Placeholders {
    private val PATTERN = Regex("\\{\\{\\s*([a-z][a-z0-9_]*)\\s*}}")

    fun keysIn(text: String): List<String> = PATTERN.findAll(text).map { it.groupValues[1] }.toList()

    /**
     * Single-pass substitution: inserted values are never re-scanned, so user input can't inject
     * further placeholders. Subject output has line breaks collapsed to keep headers safe.
     */
    fun render(
        template: EmailTemplate,
        values: Map<String, String>,
        routineName: String,
        date: LocalDate,
        locale: Locale = Locale.ENGLISH,
    ): RenderedEmail {
        val byKey = template.fields.associateBy { it.key }
        val builtIns = mapOf(
            "date" to date.toString(),
            "weekday" to date.dayOfWeek.getDisplayName(TextStyle.FULL, locale),
            "routine_name" to routineName,
        )
        val missing = linkedSetOf<String>()
        fun sub(text: String): String = PATTERN.replace(text) { m ->
            val key = m.groupValues[1]
            val field = byKey[key]
            when {
                field != null -> {
                    val v = FieldValidator.effectiveValue(field, values)
                    if (v == null) { missing += key; "«$key»" } else display(field, v)
                }
                key in builtIns -> builtIns.getValue(key)
                else -> { missing += key; "«$key»" }
            }
        }
        val subject = sub(template.subject).replace(Regex("[\\r\\n]+"), " ").trim()
        val body = sub(template.body)
        return RenderedEmail(subject, body, missing, FieldValidator.validateValues(template.fields, values))
    }

    private fun display(f: TemplateField, v: String): String = when (f.type) {
        FieldType.BOOLEAN -> if (v.trim() == "true") "Yes" else "No"
        FieldType.NUMBER, FieldType.DATE -> v.trim()
        else -> v
    }
}
