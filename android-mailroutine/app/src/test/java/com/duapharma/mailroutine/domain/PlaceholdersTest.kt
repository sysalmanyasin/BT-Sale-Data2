package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.Fx
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class PlaceholdersTest {
    private val date = LocalDate.parse("2026-03-02")
    private fun tpl(subject: String, body: String, vararg f: TemplateField) = EmailTemplate(subject, body, f.toList())

    @Test fun rendersFieldsAndBuiltIns() {
        val t = tpl("{{routine_name}} {{date}} ({{weekday}})", "Hi {{ who }}", TemplateField("who", "Who", FieldType.TEXT, true))
        val r = Placeholders.render(t, mapOf("who" to "Sam"), "Sales", date)
        assertEquals("Sales 2026-03-02 (Monday)", r.subject)
        assertEquals("Hi Sam", r.body)
        assertTrue(r.isComplete)
    }

    @Test fun missingRequiredIsReportedAndMarked() {
        val t = tpl("S", "Amount {{amount}}", TemplateField("amount", "Amount", FieldType.NUMBER, true))
        val r = Placeholders.render(t, emptyMap(), "R", date)
        assertEquals(setOf("amount"), r.missingKeys)
        assertTrue(r.body.contains("«amount»"))
        assertFalse(r.isComplete)
    }

    @Test fun defaultValueUsedWhenNoInput() {
        val t = tpl("S", "{{city}}", TemplateField("city", "City", FieldType.TEXT, true, defaultValue = "Lahore"))
        assertEquals("Lahore", Placeholders.render(t, emptyMap(), "R", date).body)
    }

    @Test fun valuesAreNotReExpanded() {
        val t = tpl("S", "{{a}}|{{b}}", TemplateField("a", "A", FieldType.TEXT, true), TemplateField("b", "B", FieldType.TEXT, true))
        val r = Placeholders.render(t, mapOf("a" to "{{b}}", "b" to "x"), "R", date)
        assertEquals("{{b}}|x", r.body)
    }

    @Test fun subjectLineBreaksAreCollapsed() {
        val t = tpl("Hi {{who}}", "", TemplateField("who", "Who", FieldType.MULTILINE, true))
        assertEquals("Hi a b", Placeholders.render(t, mapOf("who" to "a\r\nb"), "R", date).subject)
    }

    @Test fun booleanRendersYesNo() {
        val t = tpl("S", "{{ok}}", TemplateField("ok", "OK", FieldType.BOOLEAN, true))
        assertEquals("Yes", Placeholders.render(t, mapOf("ok" to "true"), "R", date).body)
        assertEquals("No", Placeholders.render(t, mapOf("ok" to "false"), "R", date).body)
    }

    @Test fun unknownPlaceholderIsFlaggedByRoutineValidation() {
        val issues = RoutineValidator.validate(Fx.routine(body = "{{nope}}"))
        assertTrue(issues.any { it.message.contains("Unknown placeholder") })
    }
}
