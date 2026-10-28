package com.duapharma.mailroutine.data

import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.send.DeliveryStore
import java.time.Instant

class RoomDeliveryStore(private val db: AppDatabase) : DeliveryStore {
    override suspend fun routine(id: String) = db.routines().get(id)?.toDomain()
    override suspend fun activeRoutines() = db.routines().getAll().map { it.toDomain() }
    override suspend fun occurrence(id: String) = db.occurrences().get(id)?.toDomain()
    override suspend fun openOccurrences() = db.occurrences().getOpen().map { it.toDomain() }
    override suspend fun insertIfAbsent(o: Occurrence) = db.occurrences().insertIfAbsent(o.toEntity()) != -1L

    override suspend fun claim(id: String, from: Set<OccurrenceState>, leaseUntil: Instant, now: Instant) =
        db.occurrences().claim(id, from.map { it.name }, leaseUntil.toEpochMilli(), now.toEpochMilli()) == 1

    override suspend fun update(updated: Occurrence, expected: OccurrenceState): Boolean {
        if (updated.state != expected) StateMachine.require(expected, updated.state)
        return db.occurrences().casUpdate(
            updated.id, expected.name, updated.state.name, updated.attempts, updated.leaseUntil?.toEpochMilli(),
            updated.nextRetryAt?.toEpochMilli(), updated.gmailMessageId, updated.lastErrorCode,
            updated.reminderSentAt?.toEpochMilli(), updated.attentionNotifiedFor?.name, updated.updatedAt.toEpochMilli(),
        ) == 1
    }

    override suspend fun saveAttempt(a: Attempt) = db.attempts().upsert(a.toEntity())
}
