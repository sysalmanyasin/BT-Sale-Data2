package com.duapharma.mailroutine.backup

import com.duapharma.mailroutine.Fx
import com.duapharma.mailroutine.domain.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalTime

class BackupCodecTest {
    private var n = 0
    private val ids = { "new-${++n}" }
    private val sample = Fx.routine(auto = true, attachments = listOf(AttachmentRef("a1", "r.pdf", 10, "application/pdf")),
        schedule = Schedule(ScheduleKind.WEEKLY, setOf(DayOfWeek.MONDAY, DayOfWeek.FRIDAY), LocalTime.of(9, 15), "Asia/Karachi"))

    @Test fun roundTripPreservesDefinitionButResetsSafetyState() {
        val text = BackupCodec.encode(listOf(sample), Fx.NOW)
        val res = BackupCodec.decode(text, Fx.NOW, ids) as BackupResult.Success
        val r = res.routines.single()
        assertEquals(sample.template, r.template); assertEquals(sample.recipients, r.recipients); assertEquals(sample.schedule, r.schedule)
        assertEquals("new-1", r.id)
        assertTrue(r.paused); assertFalse(r.autoSendEnabled); assertNull(r.consent); assertTrue(r.attachments.isEmpty())
        assertTrue(res.warnings.any { it.contains("attachment") })
    }

    @Test fun exportContainsNoCredentialOrConsentOrFileReferences() {
        val text = BackupCodec.encode(listOf(sample), Fx.NOW).lowercase()
        listOf("token", "password", "secret", "apikey", "api_key", "consent", "fingerprint", "content://", "file://", "/data/").forEach { assertFalse(it, text.contains(it)) }
        val keys = JSONObject(text).getJSONArray("routines").getJSONObject(0).keys().asSequence().toSet()
        assertFalse(keys.contains("consent")); assertFalse(keys.contains("autosendenabled"))
    }

    @Test fun rejectsGarbageWrongFormatAndNewerVersions() {
        assertTrue(BackupCodec.decode("not json", Fx.NOW, ids) is BackupResult.Invalid)
        assertTrue(BackupCodec.decode("""{"format":"other","version":1,"routines":[]}""", Fx.NOW, ids) is BackupResult.Invalid)
        assertTrue(BackupCodec.decode("""{"format":"mailroutine-backup","version":99,"routines":[]}""", Fx.NOW, ids) is BackupResult.Invalid)
        assertTrue(BackupCodec.decode("""{"format":"mailroutine-backup","routines":[]}""", Fx.NOW, ids) is BackupResult.Invalid)
    }

    @Test fun rejectsOversizeFile() {
        assertTrue(BackupCodec.decode(" ".repeat(BackupCodec.MAX_BYTES + 1), Fx.NOW, ids) is BackupResult.Invalid)
    }

    @Test fun validatesImportedFieldsAndAddresses() {
        val obj = JSONObject(BackupCodec.encode(listOf(sample), Fx.NOW))
        val r = obj.getJSONArray("routines").getJSONObject(0)
        r.getJSONObject("recipients").put("to", org.json.JSONArray(listOf("bad address")))
        val res = BackupCodec.decode(obj.toString(), Fx.NOW, ids) as BackupResult.Invalid
        assertTrue(res.errors.single().startsWith("Routine 1"))
    }

    @Test fun rejectsUnknownPlaceholderEnumAndZone() {
        fun mutate(f: (JSONObject) -> Unit): BackupResult {
            val obj = JSONObject(BackupCodec.encode(listOf(sample), Fx.NOW)); f(obj.getJSONArray("routines").getJSONObject(0))
            return BackupCodec.decode(obj.toString(), Fx.NOW, ids)
        }
        assertTrue(mutate { it.put("body", "{{ghost}}") } is BackupResult.Invalid)
        assertTrue(mutate { it.getJSONArray("fields").getJSONObject(0).put("type", "EVAL") } is BackupResult.Invalid)
        assertTrue(mutate { it.getJSONObject("schedule").put("zoneId", "Nowhere/Land") } is BackupResult.Invalid)
        assertTrue(mutate { it.getJSONObject("schedule").put("time", "25:61") } is BackupResult.Invalid)
    }

    @Test fun nonStringRecipientsAreRejectedNotCrashing() {
        val obj = JSONObject(BackupCodec.encode(listOf(sample), Fx.NOW))
        obj.getJSONArray("routines").getJSONObject(0).getJSONObject("recipients").put("to", org.json.JSONArray(listOf(1, 2)))
        assertTrue(BackupCodec.decode(obj.toString(), Fx.NOW, ids) is BackupResult.Invalid)
    }

    @Test fun tooManyRoutinesRejected() {
        val arr = org.json.JSONArray(); repeat(BackupCodec.MAX_ROUTINES + 1) { arr.put(JSONObject()) }
        val text = JSONObject().put("format", BackupCodec.FORMAT).put("version", 1).put("routines", arr).toString()
        assertTrue(BackupCodec.decode(text, Fx.NOW, ids) is BackupResult.Invalid)
    }
}
