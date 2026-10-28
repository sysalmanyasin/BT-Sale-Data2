package com.duapharma.mailroutine.send

import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.gmail.GmailResult
import com.duapharma.mailroutine.gmail.GmailSender
import com.duapharma.mailroutine.gmail.MimeAttachment
import com.duapharma.mailroutine.gmail.MimeBuilder
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

sealed interface RunResult {
    data object NotFound : RunResult
    /** Not sendable now (terminal, being sent elsewhere, or claim lost to a concurrent worker). */
    data object AlreadyHandled : RunResult
    data class Deferred(val reasons: List<BlockReason>) : RunResult
    data class Blocked(val reasons: List<BlockReason>) : RunResult
    data class Submitted(val messageId: String) : RunResult
    data class RetryScheduled(val at: Instant) : RunResult
    data class Failed(val code: String) : RunResult
    data class Uncertain(val code: String) : RunResult
    /** Couldn't obtain a token right now (offline etc.). Nothing was claimed or sent; try again later. */
    data object TryLater : RunResult
}

/**
 * The only code path that talks to Gmail. Order of effects for each send:
 *  claim (CAS) -> gate -> persist STARTED attempt -> network call -> persist outcome.
 * A crash after "persist STARTED" leaves SENDING with an expiring lease, which recovery turns
 * into UNCERTAIN — never into a blind resend.
 */
class SendCoordinator(
    private val store: DeliveryStore,
    private val auth: AuthProvider,
    private val gmail: GmailSender,
    private val attachments: AttachmentSource,
    private val clock: Clock,
    private val leaseDuration: Duration = Duration.ofMinutes(10),
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun run(occurrenceId: String, mode: SendMode): RunResult {
        val first = store.occurrence(occurrenceId) ?: return RunResult.NotFound
        val routine = store.routine(first.routineId) ?: return RunResult.NotFound
        val now = clock.now()

        if (first.state == OccurrenceState.SENDING) {
            return if (recoverIfStale(first)) RunResult.Uncertain("LEASE_EXPIRED") else RunResult.AlreadyHandled
        }
        if (first.state !in StateMachine.SENDABLE) return RunResult.AlreadyHandled

        val token = auth.acquire()
        val authStatus = when (token) {
            is TokenResult.Token -> AuthStatus.AUTHORIZED
            TokenResult.NeedsReauth -> AuthStatus.NEEDS_REAUTH
            TokenResult.NotConnected -> AuthStatus.NOT_CONNECTED
            TokenResult.Unavailable -> AuthStatus.AUTHORIZED // not an authorization problem; handled below
        }
        val unavailable = routine.attachments.filter { it.required && !attachments.isAvailable(it) }.map { it.id }.toSet()
        val gate = SendGate.evaluate(routine, first, mode, authStatus, unavailable, now)

        if (gate is GateResult.Blocked) {
            val timingOnly = gate.reasons.all { it == BlockReason.NOT_DUE || it == BlockReason.RETRY_NOT_DUE }
            if (timingOnly) return RunResult.Deferred(gate.reasons)
            return withContext(NonCancellable) { block(first, gate.reasons, now) }
        }
        if (token is TokenResult.Unavailable) return RunResult.TryLater // nothing claimed, nothing sent
        token as TokenResult.Token

        // Claim only after the cheap checks pass, so blocked rows don't churn through SENDING.
        if (!store.claim(occurrenceId, setOf(first.state), now.plus(leaseDuration), now)) return RunResult.AlreadyHandled

        val rendered = Placeholders.render(routine.template, first.values, routine.name, first.localDate)
        val files = mutableListOf<MimeAttachment>()
        // Reading attachments and building the message are the memory-heavy steps. Nothing has left the phone
        // yet, so an out-of-memory failure here is a clean, definitive failure, never an UNCERTAIN send.
        val mime = try {
            for (ref in routine.attachments) {
                val bytes = attachments.read(ref)
                if (bytes == null) {
                    if (ref.required) return withContext(NonCancellable) { block(first.copy(state = OccurrenceState.SENDING), listOf(BlockReason.ATTACHMENT_UNAVAILABLE), now) }
                    continue
                }
                files += MimeAttachment(ref.displayName, ref.mimeType, bytes)
            }
            MimeBuilder.build(routine.recipients.to, routine.recipients.cc, routine.recipients.bcc, rendered.subject, rendered.body, files, first.id, htmlBody = rendered.html)
        } catch (e: IllegalArgumentException) {
            return withContext(NonCancellable) { settle(first.copy(state = OccurrenceState.SENDING), SendFailure.Rejected("BAD_MESSAGE"), first.attempts + 1, now, rendered.subject) }
        } catch (e: OutOfMemoryError) {
            files.clear()
            return withContext(NonCancellable) { settle(first.copy(state = OccurrenceState.SENDING), SendFailure.Rejected("OUT_OF_MEMORY"), first.attempts + 1, now, rendered.subject) }
        }

        val attempt = Attempt(newId(), first.id, now, outcome = AttemptOutcome.STARTED, subject = rendered.subject)
        store.saveAttempt(attempt)

        val result = try {
            gmail.send(token.value, mime)
        } catch (e: CancellationException) {
            throw e // lease expiry will mark this UNCERTAIN
        } catch (e: Throwable) {
            GmailResult.Failed(SendFailure.Ambiguous("SENDER_EXCEPTION"))
        }

        return withContext(NonCancellable) {
            val done = clock.now()
            val claimed = first.copy(state = OccurrenceState.SENDING)
            when (result) {
                is GmailResult.Submitted -> {
                    val ok = store.update(
                        claimed.copy(state = OccurrenceState.SUBMITTED, attempts = first.attempts + 1, leaseUntil = null, nextRetryAt = null,
                            gmailMessageId = result.messageId, lastErrorCode = null, updatedAt = done),
                        OccurrenceState.SENDING,
                    )
                    store.saveAttempt(attempt.copy(finishedAt = done, outcome = AttemptOutcome.SUBMITTED, gmailMessageId = result.messageId))
                    if (!ok) RunResult.AlreadyHandled else RunResult.Submitted(result.messageId)
                }
                is GmailResult.Failed -> settle(claimed, result.failure, first.attempts + 1, done, rendered.subject, attempt)
            }
        }
    }

    /** If [o] is stuck in SENDING past its lease, the outcome is unknown: mark UNCERTAIN. */
    suspend fun recoverIfStale(o: Occurrence): Boolean {
        if (o.state != OccurrenceState.SENDING) return false
        val now = clock.now()
        val lease = o.leaseUntil
        if (lease != null && lease.isAfter(now)) return false
        val ok = store.update(o.copy(state = OccurrenceState.UNCERTAIN, leaseUntil = null, lastErrorCode = "LEASE_EXPIRED", updatedAt = now), OccurrenceState.SENDING)
        if (ok) store.saveAttempt(Attempt(newId(), o.id, now, now, AttemptOutcome.UNCERTAIN, errorCode = "LEASE_EXPIRED"))
        return ok
    }

    private suspend fun block(o: Occurrence, reasons: List<BlockReason>, now: Instant): RunResult {
        val code = reasons.first().code
        val expected = o.state
        val changed = o.state != OccurrenceState.BLOCKED || o.lastErrorCode != code
        val updated = o.copy(state = OccurrenceState.BLOCKED, leaseUntil = null, lastErrorCode = code, updatedAt = now)
        if (expected == OccurrenceState.SENDING || changed) {
            if (store.update(updated, expected) && changed) {
                store.saveAttempt(Attempt(newId(), o.id, now, now, AttemptOutcome.BLOCKED, errorCode = code))
            }
        }
        return RunResult.Blocked(reasons)
    }

    private suspend fun settle(o: Occurrence, failure: SendFailure, attemptsMade: Int, now: Instant, subject: String, started: Attempt? = null): RunResult {
        val decision = RetryPolicy.decide(failure, attemptsMade, now)
        val base = o.copy(attempts = attemptsMade, leaseUntil = null, updatedAt = now)
        val (next, outcome, result) = when (decision) {
            is RetryDecision.RetryAt -> Triple(base.copy(state = OccurrenceState.FAILED_RETRYABLE, nextRetryAt = decision.at, lastErrorCode = failure.code), AttemptOutcome.RETRY_SCHEDULED, RunResult.RetryScheduled(decision.at))
            is RetryDecision.GiveUp -> Triple(base.copy(state = OccurrenceState.FAILED, nextRetryAt = null, lastErrorCode = decision.code), AttemptOutcome.FAILED, RunResult.Failed(decision.code))
            is RetryDecision.Uncertain -> Triple(base.copy(state = OccurrenceState.UNCERTAIN, nextRetryAt = null, lastErrorCode = decision.code), AttemptOutcome.UNCERTAIN, RunResult.Uncertain(decision.code))
            is RetryDecision.NeedsUser -> Triple(base.copy(state = OccurrenceState.BLOCKED, nextRetryAt = null, lastErrorCode = decision.code), AttemptOutcome.BLOCKED, RunResult.Blocked(listOf(blockReasonFor(decision.code))))
        }
        // o.state is SENDING after a claim, or the original state when the row was never claimed.
        store.update(next, o.state)
        val a = started?.copy(finishedAt = now, outcome = outcome, errorCode = next.lastErrorCode)
            ?: Attempt(newId(), o.id, now, now, outcome, errorCode = next.lastErrorCode, subject = subject)
        store.saveAttempt(a)
        return result
    }

    private fun blockReasonFor(code: String) =
        if (code == "NOT_CONNECTED") BlockReason.NOT_CONNECTED else BlockReason.NEEDS_REAUTH
}
