package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.Fx
import org.junit.Assert.*
import org.junit.Test

class ValidationTest {
    @Test fun acceptsCommonAddresses() {
        listOf("a@b.co", "first.last+tag@sub.example.com", "o'neil@example.org").forEach { assertTrue(it, EmailValidator.isValid(it)) }
    }

    @Test fun rejectsBadAddresses() {
        listOf("", "plain", "a@b", "a@@b.com", "a b@c.com", "a@b.c", "a@-b.com", ".a@b.com", "a..b@c.com",
            "a@b.com\r\nBcc: x@y.com", "Name <a@b.com>", "a@1.2.3.4", "a@b.com,c@d.com").forEach { assertFalse(it, EmailValidator.isValid(it)) }
    }

    @Test fun requiredFieldMissingIsReported() {
        val f = TemplateField("amount", "Amount", FieldType.NUMBER, true)
        assertEquals(1, FieldValidator.validateValues(listOf(f), emptyMap()).size)
        assertEquals(1, FieldValidator.validateValues(listOf(f), mapOf("amount" to "  ")).size)
    }

    @Test fun optionalFieldMayBeBlank() {
        val f = TemplateField("note", "Note", FieldType.TEXT, false)
        assertTrue(FieldValidator.validateValues(listOf(f), emptyMap()).isEmpty())
    }

    @Test fun typedValuesAreChecked() {
        fun f(t: FieldType, choices: List<String> = emptyList()) = TemplateField("k", "K", t, true, choices = choices)
        assertNull(FieldValidator.validateValue(f(FieldType.NUMBER), "12.50"))
        assertNotNull(FieldValidator.validateValue(f(FieldType.NUMBER), "12,5x"))
        assertNull(FieldValidator.validateValue(f(FieldType.DATE), "2026-03-02"))
        assertNotNull(FieldValidator.validateValue(f(FieldType.DATE), "02/03/2026"))
        assertNotNull(FieldValidator.validateValue(f(FieldType.BOOLEAN), "yes"))
        assertNull(FieldValidator.validateValue(f(FieldType.CHOICE, listOf("a", "b")), "a"))
        assertNotNull(FieldValidator.validateValue(f(FieldType.CHOICE, listOf("a", "b")), "c"))
        assertNotNull(FieldValidator.validateValue(f(FieldType.TEXT), "line1\nline2"))
        assertNull(FieldValidator.validateValue(f(FieldType.MULTILINE), "line1\nline2"))
    }

    @Test fun maxLengthEnforced() {
        val f = TemplateField("k", "K", FieldType.TEXT, true, maxLength = 5)
        assertNotNull(FieldValidator.validateValue(f, "123456"))
    }

    @Test fun fieldDefinitionRules() {
        assertTrue(FieldValidator.validateDefinition(TemplateField("Bad Key", "L", FieldType.TEXT, false)).isNotEmpty())
        assertTrue(FieldValidator.validateDefinition(TemplateField("date", "L", FieldType.TEXT, false)).isNotEmpty()) // reserved
        assertTrue(FieldValidator.validateDefinition(TemplateField("c", "L", FieldType.CHOICE, false)).isNotEmpty()) // no choices
        assertTrue(FieldValidator.validateDefinition(TemplateField("n", "L", FieldType.NUMBER, false, defaultValue = "x")).isNotEmpty())
    }

    @Test fun routineValidationCatchesRecipientProblems() {
        assertTrue(RoutineValidator.validate(Fx.routine(to = emptyList())).any { it.field == "to" })
        assertTrue(RoutineValidator.validate(Fx.routine(to = listOf("nope"))).any { it.field == "recipients" })
        assertTrue(RoutineValidator.validate(Fx.routine(to = listOf("a@b.com", "A@B.com"))).any { it.message.startsWith("Duplicate") })
        assertTrue(RoutineValidator.validate(Fx.routine()).isEmpty())
    }

    @Test fun errorMessagesDoNotLeakFullAddress() {
        val msg = RoutineValidator.validate(Fx.routine(to = listOf("secret.person@bad_domain"))).joinToString { it.message }
        assertFalse(msg.contains("secret.person"))
    }

    @Test fun weeklyNeedsDaysAndZoneMustExist() {
        val bad = Fx.routine(schedule = Schedule(ScheduleKind.WEEKLY, emptySet(), java.time.LocalTime.NOON, "Mars/Base"))
        val issues = RoutineValidator.validate(bad).map { it.message }
        assertTrue(issues.any { it.contains("weekday") })
        assertTrue(issues.any { it.contains("time zone") })
    }

    @Test fun attachmentRules() {
        assertNotNull(AttachmentRules.validatePick("run.exe", 10))
        assertNotNull(AttachmentRules.validatePick("a.pdf", 0))
        assertNotNull(AttachmentRules.validatePick("a.pdf", Limits.MAX_ATTACHMENT_BYTES + 1))
        assertNull(AttachmentRules.validatePick("a.pdf", 1000))
    }

    @Test fun timeFieldAccepts24HourOnly() {
        val f = TemplateField("t", "T", FieldType.TIME, true)
        listOf("00:00", "09:05", "16:22", "23:59").forEach { assertNull(it, FieldValidator.validateValue(f, it)) }
        listOf("24:00", "9:05", "12:60", "4:22 PM", "noon", "12-30").forEach { assertNotNull(it, FieldValidator.validateValue(f, it)) }
    }
}
