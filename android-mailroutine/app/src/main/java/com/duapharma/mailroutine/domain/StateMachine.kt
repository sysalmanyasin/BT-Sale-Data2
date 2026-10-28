package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.domain.OccurrenceState.*

/**
 * Allowed delivery transitions. Notably there is no UNCERTAIN -> SENDING edge: an ambiguous send is
 * never retried blindly; it must be reconciled (CONFIRMED_SENT) or explicitly reset to SCHEDULED.
 */
object StateMachine {
    private val EDGES: Map<OccurrenceState, Set<OccurrenceState>> = mapOf(
        SCHEDULED to setOf(SENDING, BLOCKED, SKIPPED),
        BLOCKED to setOf(SCHEDULED, SENDING, SKIPPED),
        SENDING to setOf(SUBMITTED, FAILED_RETRYABLE, FAILED, UNCERTAIN, BLOCKED),
        FAILED_RETRYABLE to setOf(SENDING, FAILED, BLOCKED, SKIPPED),
        FAILED to setOf(SCHEDULED, SKIPPED),
        UNCERTAIN to setOf(CONFIRMED_SENT, SCHEDULED, SKIPPED),
        SUBMITTED to emptySet(),
        CONFIRMED_SENT to emptySet(),
        SKIPPED to emptySet(),
    )

    /** States from which a send attempt may be claimed. */
    val SENDABLE: Set<OccurrenceState> = setOf(SCHEDULED, BLOCKED, FAILED_RETRYABLE)

    fun canTransition(from: OccurrenceState, to: OccurrenceState) = to in EDGES.getValue(from)

    fun require(from: OccurrenceState, to: OccurrenceState) {
        check(canTransition(from, to)) { "Illegal transition $from -> $to" }
    }
}
