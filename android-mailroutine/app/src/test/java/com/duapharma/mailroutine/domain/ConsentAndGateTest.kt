package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.Fx
import org.junit.Assert.*
import org.junit.Test
import java.time.Duration

class ConsentAndGateTest {
    private val now = Fx.NOW

    @Test fun consentValidUntilContentChanges() {
        val r = Fx.routine(auto = true)
        assertTrue(Consent.isValid(r))
        val edited = r.copy(template = r.template.copy(body = "Different"))
        assertFalse(Consent.isValid(edited))
    }

    @Test fun afterEditRevokesConsentOnMaterialChange() {
        val r = Fx.routine(auto = true)
        val saved = Consent.afterEdit(r.copy(recipients = Recipients(listOf("other@example.com"))), now)
        assertFalse(saved.autoSendEnabled)
        assertNull(saved.consent)
    }

    @Test fun afterEditKeepsConsentOnImmaterialChange() {
        val r = Fx.routine(auto = true)
        val saved = Consent.afterEdit(r.copy(name = "Renamed", maxLateMinutes = 30), now)
        assertTrue(saved.autoSendEnabled)
        assertTrue(Consent.isValid(saved))
    }

    @Test fun aiStyleRewriteOfApprovedTemplateCannotStayApproved() {
        val r = Fx.routine(auto = true)
        val aiDraft = r.copy(template = r.template.copy(subject = "AI rewritten {{date}}"))
        val saved = Consent.afterEdit(aiDraft, now)
        val gate = SendGate.evaluate(saved, Fx.occurrence(), SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now)
        assertTrue((gate as GateResult.Blocked).reasons.contains(BlockReason.AUTO_NOT_APPROVED))
    }

    @Test fun fingerprintStableAndSensitive() {
        val a = Fx.routine(); val b = Fx.routine()
        assertEquals(Consent.fingerprint(a), Consent.fingerprint(b))
        assertNotEquals(Consent.fingerprint(a), Consent.fingerprint(Fx.routine(subject = "x")))
    }

    @Test fun allowedWhenEverythingIsInOrder() {
        val g = SendGate.evaluate(Fx.routine(auto = true), Fx.occurrence(), SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now)
        assertEquals(GateResult.Allowed, g)
    }

    @Test fun blocksOnMissingInput() {
        val g = SendGate.evaluate(Fx.routine(auto = true), Fx.occurrence(values = emptyMap()), SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now)
        assertTrue((g as GateResult.Blocked).reasons.contains(BlockReason.MISSING_INPUT))
    }

    @Test fun blocksOnAuthProblems() {
        val r = Fx.routine(auto = true)
        assertTrue((SendGate.evaluate(r, Fx.occurrence(), SendMode.MANUAL, AuthStatus.NEEDS_REAUTH, emptySet(), now) as GateResult.Blocked).reasons.contains(BlockReason.NEEDS_REAUTH))
        assertTrue((SendGate.evaluate(r, Fx.occurrence(), SendMode.MANUAL, AuthStatus.NOT_CONNECTED, emptySet(), now) as GateResult.Blocked).reasons.contains(BlockReason.NOT_CONNECTED))
    }

    @Test fun blocksOnInvalidRecipients() {
        val g = SendGate.evaluate(Fx.routine(to = listOf("bad")), Fx.occurrence(), SendMode.MANUAL, AuthStatus.AUTHORIZED, emptySet(), now)
        assertTrue((g as GateResult.Blocked).reasons.contains(BlockReason.INVALID_ROUTINE))
    }

    @Test fun blocksOnRequiredAttachmentMissingButNotOptional() {
        val req = AttachmentRef("a1", "r.pdf", 10, "application/pdf", required = true)
        val opt = AttachmentRef("a2", "o.pdf", 10, "application/pdf", required = false)
        val r = Fx.routine(attachments = listOf(req, opt))
        val g = SendGate.evaluate(r, Fx.occurrence(), SendMode.MANUAL, AuthStatus.AUTHORIZED, setOf("a1", "a2"), now)
        assertEquals(listOf(BlockReason.ATTACHMENT_UNAVAILABLE), (g as GateResult.Blocked).reasons)
        assertEquals(GateResult.Allowed, SendGate.evaluate(r, Fx.occurrence(), SendMode.MANUAL, AuthStatus.AUTHORIZED, setOf("a2"), now))
    }

    @Test fun autoRequiresConsentButManualDoesNot() {
        val r = Fx.routine(auto = false)
        assertTrue((SendGate.evaluate(r, Fx.occurrence(), SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now) as GateResult.Blocked).reasons.contains(BlockReason.AUTO_NOT_APPROVED))
        assertEquals(GateResult.Allowed, SendGate.evaluate(r, Fx.occurrence(), SendMode.MANUAL, AuthStatus.AUTHORIZED, emptySet(), now))
    }

    @Test fun autoSkipsWhenTooLateOrNotYetDue() {
        val r = Fx.routine(auto = true)
        val late = Fx.occurrence(dueAt = now.minus(Duration.ofMinutes(r.maxLateMinutes + 1L)))
        assertTrue((SendGate.evaluate(r, late, SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now) as GateResult.Blocked).reasons.contains(BlockReason.TOO_LATE_FOR_AUTO))
        val early = Fx.occurrence(dueAt = now.plusSeconds(60))
        assertTrue((SendGate.evaluate(r, early, SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now) as GateResult.Blocked).reasons.contains(BlockReason.NOT_DUE))
    }

    @Test fun autoRespectsRetryNotBefore() {
        val o = Fx.occurrence(state = OccurrenceState.FAILED_RETRYABLE).copy(nextRetryAt = now.plusSeconds(300))
        val g = SendGate.evaluate(Fx.routine(auto = true), o, SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now)
        assertTrue((g as GateResult.Blocked).reasons.contains(BlockReason.RETRY_NOT_DUE))
    }

    @Test fun pausedRoutineNeverAutoSends() {
        val g = SendGate.evaluate(Fx.routine(auto = true).copy(paused = true), Fx.occurrence(), SendMode.AUTO, AuthStatus.AUTHORIZED, emptySet(), now)
        assertTrue((g as GateResult.Blocked).reasons.contains(BlockReason.ROUTINE_PAUSED))
    }

    @Test fun changingTheScheduleRevokesApprovalButTheLateWindowDoesNot() {
        val r = Fx.routine(auto = true)
        val moved = r.copy(schedule = r.schedule.copy(time = java.time.LocalTime.of(10, 0)))
        assertFalse(Consent.isValid(moved))
        assertFalse(Consent.afterEdit(moved, now).autoSendEnabled)
        assertTrue(Consent.isValid(r.copy(maxLateMinutes = 15)))
    }

    @Test fun switchingToHtmlRevokesApproval() {
        val r = Fx.routine(auto = true)
        val html = r.copy(template = r.template.copy(body = HtmlTemplate.wrap("<p>Amount: {{amount}}</p>")))
        assertFalse(Consent.isValid(html))
    }
}
