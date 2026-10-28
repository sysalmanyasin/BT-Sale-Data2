package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.domain.OccurrenceState.*
import org.junit.Assert.*
import org.junit.Test

class StateMachineTest {
    @Test fun happyPath() {
        assertTrue(StateMachine.canTransition(SCHEDULED, SENDING))
        assertTrue(StateMachine.canTransition(SENDING, SUBMITTED))
    }

    @Test fun uncertainCanNeverGoStraightToSending() {
        assertFalse(StateMachine.canTransition(UNCERTAIN, SENDING))
        assertTrue(StateMachine.canTransition(UNCERTAIN, CONFIRMED_SENT))
        assertTrue(StateMachine.canTransition(UNCERTAIN, SCHEDULED)) // explicit user reset only
    }

    @Test fun terminalStatesHaveNoExits() {
        listOf(SUBMITTED, CONFIRMED_SENT, SKIPPED).forEach { t ->
            assertTrue(t.isTerminal)
            OccurrenceState.entries.forEach { assertFalse("$t->$it", StateMachine.canTransition(t, it)) }
        }
    }

    @Test fun failedRequiresUserResetBeforeResend() {
        assertFalse(StateMachine.canTransition(FAILED, SENDING))
        assertTrue(StateMachine.canTransition(FAILED, SCHEDULED))
    }

    @Test fun sendingCannotBeSkippedWhileInFlight() {
        assertFalse(StateMachine.canTransition(SENDING, SKIPPED))
    }

    @Test fun sendableStatesExcludeUncertainAndTerminal() {
        assertEquals(setOf(SCHEDULED, BLOCKED, FAILED_RETRYABLE), StateMachine.SENDABLE)
    }

    @Test(expected = IllegalStateException::class) fun requireThrowsOnIllegal() {
        StateMachine.require(SUBMITTED, SENDING)
    }
}
