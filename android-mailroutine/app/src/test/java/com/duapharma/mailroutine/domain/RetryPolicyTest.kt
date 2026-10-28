package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.Fx
import org.junit.Assert.*
import org.junit.Test
import java.time.Duration

class RetryPolicyTest {
    private val now = Fx.NOW

    @Test fun networkFailureBacksOffThenGivesUp() {
        val d1 = RetryPolicy.decide(SendFailure.NotSentNetwork, 1, now) as RetryDecision.RetryAt
        val d2 = RetryPolicy.decide(SendFailure.NotSentNetwork, 2, now) as RetryDecision.RetryAt
        assertEquals(now.plus(Duration.ofMinutes(1)), d1.at)
        assertEquals(now.plus(Duration.ofMinutes(5)), d2.at)
        assertTrue(RetryPolicy.decide(SendFailure.NotSentNetwork, RetryPolicy.MAX_ATTEMPTS, now) is RetryDecision.GiveUp)
    }

    @Test fun rateLimitHonoursRetryAfterButCapsAtOneHour() {
        val d = RetryPolicy.decide(SendFailure.RateLimited(Duration.ofMinutes(30)), 1, now) as RetryDecision.RetryAt
        assertEquals(now.plus(Duration.ofMinutes(30)), d.at)
        val capped = RetryPolicy.decide(SendFailure.RateLimited(Duration.ofHours(10)), 1, now) as RetryDecision.RetryAt
        assertEquals(now.plus(Duration.ofHours(1)), capped.at)
    }

    @Test fun ambiguousIsNeverRetried() {
        repeat(3) { assertTrue(RetryPolicy.decide(SendFailure.Ambiguous(), it + 1, now) is RetryDecision.Uncertain) }
    }

    @Test fun authAndPreconditionNeedUser() {
        assertTrue(RetryPolicy.decide(SendFailure.Auth(), 1, now) is RetryDecision.NeedsUser)
        assertTrue(RetryPolicy.decide(SendFailure.Precondition("X"), 1, now) is RetryDecision.NeedsUser)
    }

    @Test fun rejectionIsPermanent() {
        assertTrue(RetryPolicy.decide(SendFailure.Rejected(), 1, now) is RetryDecision.GiveUp)
    }
}
