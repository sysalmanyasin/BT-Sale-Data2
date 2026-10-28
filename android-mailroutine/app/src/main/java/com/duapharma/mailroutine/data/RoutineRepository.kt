package com.duapharma.mailroutine.data

import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.send.Clock
import com.duapharma.mailroutine.send.DeliveryStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Duration
import java.time.Instant
import java.util.UUID

data class AttemptWithRoutine(val attempt: Attempt, val routineName: String?)

sealed interface SaveResult {
    data class Saved(val routine: Routine) : SaveResult
    data class Invalid(val issues: List<ValidationIssue>) : SaveResult
}

interface RoutineRepository {
    fun observeRoutines(): Flow<List<Routine>>
    fun observeOccurrences(): Flow<List<Occurrence>>
    fun observeOccurrence(id: String): Flow<Occurrence?>
    fun observeAttempts(limit: Int = 200): Flow<List<AttemptWithRoutine>>
    fun observeAttemptsFor(occurrenceId: String): Flow<List<Attempt>>

    suspend fun routine(id: String): Routine?
    suspend fun allRoutines(): List<Routine>
    suspend fun save(routine: Routine): SaveResult
    suspend fun delete(routineId: String)
    suspend fun setPaused(routineId: String, paused: Boolean)
    suspend fun grantAutoSend(routineId: String): Boolean
    suspend fun revokeAutoSend(routineId: String)
    suspend fun importRoutines(routines: List<Routine>)

    suspend fun saveValues(occurrenceId: String, values: Map<String, String>): Boolean
    suspend fun skip(occurrenceId: String): Boolean
    /** FAILED/BLOCKED -> SCHEDULED so the user can fix things and send again. */
    suspend fun resetForRetry(occurrenceId: String): Boolean
    /** UNCERTAIN -> CONFIRMED_SENT: the user verified in Gmail that it went out. */
    suspend fun confirmSent(occurrenceId: String): Boolean
    /** UNCERTAIN -> SCHEDULED: the user verified it did NOT go out and explicitly allows a resend. */
    suspend fun confirmNotSent(occurrenceId: String): Boolean
}

class RoomRoutineRepository(
    private val db: AppDatabase,
    private val store: DeliveryStore,
    private val clock: Clock,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) : RoutineRepository {

    override fun observeRoutines() = db.routines().observeAll().map { l -> l.map { it.toDomain() } }
    override fun observeOccurrences() =
        db.occurrences().observeRecent(clock.now().minus(Duration.ofDays(14)).toEpochMilli()).map { l -> l.map { it.toDomain() } }
    override fun observeOccurrence(id: String) = db.occurrences().observe(id).map { it?.toDomain() }
    override fun observeAttempts(limit: Int) = db.attempts().observeRecent(limit).map { l -> l.map { AttemptWithRoutine(it.attempt.toDomain(), it.routineName) } }
    override fun observeAttemptsFor(occurrenceId: String) = db.attempts().observeFor(occurrenceId).map { l -> l.map { it.toDomain() } }

    override suspend fun routine(id: String) = db.routines().get(id)?.toDomain()
    override suspend fun allRoutines() = db.routines().getAll().map { it.toDomain() }

    override suspend fun save(routine: Routine): SaveResult {
        val issues = RoutineValidator.validate(routine)
        if (issues.isNotEmpty()) return SaveResult.Invalid(issues)
        val now = clock.now()
        val previous = db.routines().get(routine.id)?.toDomain()
        // Consent survives only if the approved content is byte-for-byte unchanged.
        val toSave = Consent.afterEdit(routine, now)
        db.routines().upsert(toSave.toEntity())
        if (previous != null && (previous.schedule != toSave.schedule)) {
            db.occurrences().deleteFutureUntouched(toSave.id, now.toEpochMilli())
        }
        return SaveResult.Saved(toSave)
    }

    override suspend fun delete(routineId: String) = db.routines().delete(routineId)

    override suspend fun setPaused(routineId: String, paused: Boolean) {
        val r = routine(routineId) ?: return
        val now = clock.now()
        // Resuming moves activeSince forward so the paused period is not backfilled as "missed".
        db.routines().upsert(r.copy(paused = paused, activeSince = if (!paused && r.paused) now else r.activeSince, updatedAt = now).toEntity())
    }

    override suspend fun grantAutoSend(routineId: String): Boolean {
        val r = routine(routineId) ?: return false
        if (RoutineValidator.validate(r).isNotEmpty()) return false
        db.routines().upsert(Consent.grant(r, clock.now()).toEntity())
        return true
    }

    override suspend fun revokeAutoSend(routineId: String) {
        val r = routine(routineId) ?: return
        db.routines().upsert(Consent.revoke(r, clock.now()).toEntity())
    }

    override suspend fun importRoutines(routines: List<Routine>) = routines.forEach { db.routines().upsert(it.toEntity()) }

    override suspend fun saveValues(occurrenceId: String, values: Map<String, String>) =
        db.occurrences().updateValues(occurrenceId, mapToJson(values), clock.now().toEpochMilli()) == 1

    private suspend fun transition(id: String, allowedFrom: Set<OccurrenceState>, to: OccurrenceState, clearError: Boolean = true): Boolean {
        val o = store.occurrence(id) ?: return false
        if (o.state !in allowedFrom) return false
        return store.update(
            o.copy(state = to, leaseUntil = null, nextRetryAt = null, lastErrorCode = if (clearError) null else o.lastErrorCode,
                attentionNotifiedFor = null, updatedAt = clock.now()),
            o.state,
        )
    }

    override suspend fun skip(occurrenceId: String) =
        transition(occurrenceId, setOf(OccurrenceState.SCHEDULED, OccurrenceState.BLOCKED, OccurrenceState.FAILED_RETRYABLE, OccurrenceState.FAILED, OccurrenceState.UNCERTAIN), OccurrenceState.SKIPPED, clearError = false)

    override suspend fun resetForRetry(occurrenceId: String) =
        transition(occurrenceId, setOf(OccurrenceState.FAILED, OccurrenceState.BLOCKED), OccurrenceState.SCHEDULED)

    override suspend fun confirmSent(occurrenceId: String) =
        transition(occurrenceId, setOf(OccurrenceState.UNCERTAIN), OccurrenceState.CONFIRMED_SENT)

    override suspend fun confirmNotSent(occurrenceId: String) =
        transition(occurrenceId, setOf(OccurrenceState.UNCERTAIN), OccurrenceState.SCHEDULED)
}
