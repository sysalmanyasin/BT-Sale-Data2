package com.duapharma.mailroutine.domain

import java.time.Duration
import java.time.Instant

/** Why a send did not succeed, classified by what is known about whether Gmail accepted it. */
sealed interface SendFailure {
    val code: String

    /** Rejected before any request reached Gmail (no connectivity, DNS, TLS connect). Safe to retry. */
    data object NotSentNetwork : SendFailure { override val code = "NETWORK" }

    /** Gmail refused for quota reasons (HTTP 429 / rateLimitExceeded). Safe to retry later. */
    data class RateLimited(val retryAfter: Duration?) : SendFailure { override val code = "RATE_LIMITED" }

    /** Token missing, expired or scope/admin-policy refusal. Needs the user. */
    data class Auth(override val code: String = "AUTH_REQUIRED") : SendFailure

    /** Definitive rejection (400/404/413...). Retrying won't help. */
    data class Rejected(override val code: String = "REJECTED") : SendFailure

    /** Request may have reached Gmail (timeout after write, 5xx, unparseable 2xx). */
    data class Ambiguous(override val code: String = "AMBIGUOUS") : SendFailure

    /** Local preconditions failed (missing input, attachments, recipients). Needs the user. */
    data class Precondition(override val code: String) : SendFailure
}

sealed interface RetryDecision {
    data class RetryAt(val at: Instant) : RetryDecision
    data class GiveUp(val code: String) : RetryDecision
    data class Uncertain(val code: String) : RetryDecision
    data class NeedsUser(val code: String) : RetryDecision
}

object RetryPolicy {
    const val MAX_ATTEMPTS = 4
    private val BACKOFF = listOf(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15))

    /** [attemptsMade] counts the attempt that just failed (>= 1). */
    fun decide(failure: SendFailure, attemptsMade: Int, now: Instant): RetryDecision = when (failure) {
        is SendFailure.Ambiguous -> RetryDecision.Uncertain(failure.code) // never auto-resend
        is SendFailure.Auth -> RetryDecision.NeedsUser(failure.code)
        is SendFailure.Precondition -> RetryDecision.NeedsUser(failure.code)
        is SendFailure.Rejected -> RetryDecision.GiveUp(failure.code)
        is SendFailure.NotSentNetwork, is SendFailure.RateLimited -> {
            if (attemptsMade >= MAX_ATTEMPTS) RetryDecision.GiveUp(failure.code + "_EXHAUSTED")
            else {
                val base = BACKOFF[(attemptsMade - 1).coerceIn(0, BACKOFF.size - 1)]
                val wait = (failure as? SendFailure.RateLimited)?.retryAfter?.let { if (it > base) it else base } ?: base
                RetryDecision.RetryAt(now.plus(wait.coerceAtMost(Duration.ofHours(1))))
            }
        }
    }

    private fun Duration.coerceAtMost(max: Duration) = if (this > max) max else this
}
