package com.duapharma.mailroutine.send

import com.duapharma.mailroutine.domain.*
import java.time.Duration
import java.time.Instant

/**
 * Idempotent housekeeping run periodically, at boot, on time/zone changes and on app start.
 * It (1) materialises occurrences, including missed ones within the lookback window, (2) recovers
 * stale SENDING rows, (3) hands eligible work to the send scheduler and (4) raises notifications.
 * Running it twice in a row has no additional effect.
 */
class Sweeper(
    private val store: DeliveryStore,
    private val coordinator: SendCoordinator,
    private val scheduler: SendScheduler,
    private val notifier: Notifier,
    private val clock: Clock,
    private val lookback: Duration = Duration.ofDays(7),
    private val horizon: Duration = Duration.ofDays(2),
) {
    suspend fun sweep() {
        val now = clock.now()
        val routines = store.activeRoutines()
        for (r in routines) if (!r.paused) materialise(r, now)

        val byId = routines.associateBy { it.id }
        for (o in store.openOccurrences()) {
            val r = byId[o.routineId] ?: store.routine(o.routineId) ?: continue
            if (o.state == OccurrenceState.SENDING) {
                if (coordinator.recoverIfStale(o)) store.occurrence(o.id)?.let { notifyAttention(r, it) }
                continue
            }
            maybeRemind(r, o, now)
            maybeAutoSend(r, o, now)
            if (o.state == OccurrenceState.FAILED || o.state == OccurrenceState.UNCERTAIN ||
                (o.state == OccurrenceState.BLOCKED && !o.dueAt.isAfter(now))) notifyAttention(r, o)
        }
    }

    /**
     * Called by the send worker right after an attempt ended in a state that needs the user. Notifies for that one
     * occurrence only. (It used to trigger a whole new sweep, which re-enqueued the same blocked send and looped.)
     */
    suspend fun notifyAttentionFor(occurrenceId: String) {
        val o = store.occurrence(occurrenceId) ?: return
        val r = store.routine(o.routineId) ?: return
        val needsUser = o.state == OccurrenceState.FAILED || o.state == OccurrenceState.UNCERTAIN ||
            (o.state == OccurrenceState.BLOCKED && !o.dueAt.isAfter(clock.now()))
        if (needsUser) notifyAttention(r, o)
    }

    private suspend fun materialise(r: Routine, now: Instant) {
        val from = maxOf(r.activeSince, now.minus(lookback))
        val to = now.plus(horizon)
        val slots = Recurrence.slotsBetween(r.schedule, from, to).toMutableList()
        if (slots.none { it.dueAt.isAfter(now) }) Recurrence.nextAfter(r.schedule, now)?.let { slots += it }
        for (s in slots) {
            store.insertIfAbsent(Occurrence(Occurrence.idFor(r.id, s.localDate), r.id, s.localDate, s.dueAt, updatedAt = now))
        }
    }

    private suspend fun maybeRemind(r: Routine, o: Occurrence, now: Instant) {
        if (r.paused || o.reminderSentAt != null) return
        if (o.state != OccurrenceState.SCHEDULED && o.state != OccurrenceState.BLOCKED) return
        if (now.isBefore(o.dueAt.minus(Duration.ofMinutes(r.reminderLeadMinutes.toLong())))) return
        val autoReady = Consent.isValid(r) && FieldValidator.validateValues(r.template.fields, o.values).isEmpty()
        if (autoReady) return // unattended and complete: nothing for the user to do
        notifier.reminder(r, o)
        store.update(o.copy(reminderSentAt = now, updatedAt = now), o.state)
    }

    private fun maybeAutoSend(r: Routine, o: Occurrence, now: Instant) {
        if (r.paused || !Consent.isValid(r) || o.state !in StateMachine.SENDABLE) return
        if (o.dueAt.isAfter(now)) return
        if (Duration.between(o.dueAt, now) > Duration.ofMinutes(r.maxLateMinutes.toLong())) return
        val wait = o.nextRetryAt?.takeIf { o.state == OccurrenceState.FAILED_RETRYABLE && it.isAfter(now) }
            ?.let { Duration.between(now, it) } ?: Duration.ZERO
        scheduler.enqueueSend(o.id, SendMode.AUTO, wait)
    }

    private suspend fun notifyAttention(r: Routine, o: Occurrence) {
        if (o.attentionNotifiedFor == o.state) return
        notifier.attention(r, o)
        val now = clock.now()
        store.update(o.copy(attentionNotifiedFor = o.state, updatedAt = now), o.state)
    }
}
