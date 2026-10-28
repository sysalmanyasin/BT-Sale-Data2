package com.duapharma.mailroutine.domain

import java.time.Duration
import java.time.Instant

enum class SendMode { AUTO, MANUAL }

enum class AuthStatus { AUTHORIZED, NEEDS_REAUTH, NOT_CONNECTED }

enum class BlockReason(val code: String) {
    ROUTINE_PAUSED("PAUSED"),
    NOT_CONNECTED("NOT_CONNECTED"),
    NEEDS_REAUTH("AUTH_REQUIRED"),
    MISSING_INPUT("MISSING_INPUT"),
    INVALID_ROUTINE("INVALID_ROUTINE"),
    ATTACHMENT_UNAVAILABLE("ATTACHMENT_UNAVAILABLE"),
    AUTO_NOT_APPROVED("AUTO_NOT_APPROVED"),
    TOO_LATE_FOR_AUTO("TOO_LATE_FOR_AUTO"),
    RETRY_NOT_DUE("RETRY_NOT_DUE"),
    NOT_DUE("NOT_DUE"),
}

sealed interface GateResult {
    data object Allowed : GateResult
    data class Blocked(val reasons: List<BlockReason>) : GateResult
}

object SendGate {
    /**
     * Pure decision: may this occurrence be sent right now? Every precondition from the product
     * spec is checked here, so there is exactly one place to audit.
     *
     * @param unavailableRequiredAttachments ids of required attachments whose files are missing/unreadable
     */
    fun evaluate(
        routine: Routine,
        occurrence: Occurrence,
        mode: SendMode,
        auth: AuthStatus,
        unavailableRequiredAttachments: Set<String>,
        now: Instant,
    ): GateResult {
        val reasons = linkedSetOf<BlockReason>()
        if (routine.paused && mode == SendMode.AUTO) reasons += BlockReason.ROUTINE_PAUSED
        when (auth) {
            AuthStatus.NOT_CONNECTED -> reasons += BlockReason.NOT_CONNECTED
            AuthStatus.NEEDS_REAUTH -> reasons += BlockReason.NEEDS_REAUTH
            AuthStatus.AUTHORIZED -> Unit
        }
        if (RoutineValidator.validate(routine).isNotEmpty()) reasons += BlockReason.INVALID_ROUTINE
        val rendered = Placeholders.render(routine.template, occurrence.values, routine.name, occurrence.localDate)
        if (!rendered.isComplete) reasons += BlockReason.MISSING_INPUT
        if (routine.attachments.any { it.required && it.id in unavailableRequiredAttachments }) reasons += BlockReason.ATTACHMENT_UNAVAILABLE
        if (occurrence.state == OccurrenceState.FAILED_RETRYABLE && mode == SendMode.AUTO &&
            occurrence.nextRetryAt?.isAfter(now) == true) reasons += BlockReason.RETRY_NOT_DUE
        if (mode == SendMode.AUTO) {
            if (occurrence.dueAt.isAfter(now)) reasons += BlockReason.NOT_DUE
            if (!Consent.isValid(routine)) reasons += BlockReason.AUTO_NOT_APPROVED
            if (Duration.between(occurrence.dueAt, now) > Duration.ofMinutes(routine.maxLateMinutes.toLong())) reasons += BlockReason.TOO_LATE_FOR_AUTO
        }
        return if (reasons.isEmpty()) GateResult.Allowed else GateResult.Blocked(reasons.toList())
    }
}
