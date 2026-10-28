package com.duapharma.mailroutine.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface RoutineDao {
    @Query("SELECT * FROM routines ORDER BY name COLLATE NOCASE")
    fun observeAll(): Flow<List<RoutineEntity>>

    @Query("SELECT * FROM routines ORDER BY name COLLATE NOCASE")
    suspend fun getAll(): List<RoutineEntity>

    @Query("SELECT * FROM routines WHERE id = :id")
    suspend fun get(id: String): RoutineEntity?

    @Upsert suspend fun upsert(r: RoutineEntity)

    @Query("DELETE FROM routines WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface OccurrenceDao {
    @Query("SELECT * FROM occurrences WHERE dueAtMs >= :sinceMs OR state NOT IN ('SUBMITTED','CONFIRMED_SENT','SKIPPED') ORDER BY dueAtMs")
    fun observeRecent(sinceMs: Long): Flow<List<OccurrenceEntity>>

    @Query("SELECT * FROM occurrences WHERE id = :id")
    fun observe(id: String): Flow<OccurrenceEntity?>

    @Query("SELECT * FROM occurrences WHERE id = :id")
    suspend fun get(id: String): OccurrenceEntity?

    @Query("SELECT * FROM occurrences WHERE state NOT IN ('SUBMITTED','CONFIRMED_SENT','SKIPPED')")
    suspend fun getOpen(): List<OccurrenceEntity>

    /** Returns -1 when ignored (duplicate id or duplicate routine+date). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfAbsent(o: OccurrenceEntity): Long

    /** Atomic compare-and-set; the row count tells the caller whether it won the claim. */
    @Query("UPDATE occurrences SET state = 'SENDING', leaseUntilMs = :leaseMs, updatedAtMs = :nowMs WHERE id = :id AND state IN (:from)")
    suspend fun claim(id: String, from: List<String>, leaseMs: Long, nowMs: Long): Int

    /** Compare-and-set on state. Deliberately does not touch valuesJson (user input is never clobbered). */
    @Query(
        "UPDATE occurrences SET state = :state, attempts = :attempts, leaseUntilMs = :leaseMs, nextRetryAtMs = :retryMs, " +
            "gmailMessageId = :gmailId, lastErrorCode = :err, reminderSentAtMs = :reminderMs, attentionNotifiedFor = :attention, " +
            "updatedAtMs = :updatedMs WHERE id = :id AND state = :expected",
    )
    suspend fun casUpdate(
        id: String, expected: String, state: String, attempts: Int, leaseMs: Long?, retryMs: Long?, gmailId: String?,
        err: String?, reminderMs: Long?, attention: String?, updatedMs: Long,
    ): Int

    /** Input edits are refused while a send is in flight or once finished. */
    @Query("UPDATE occurrences SET valuesJson = :json, updatedAtMs = :nowMs WHERE id = :id AND state IN ('SCHEDULED','BLOCKED','FAILED_RETRYABLE','FAILED')")
    suspend fun updateValues(id: String, json: String, nowMs: Long): Int

    @Query("DELETE FROM occurrences WHERE routineId = :routineId AND state = 'SCHEDULED' AND dueAtMs > :nowMs AND attempts = 0")
    suspend fun deleteFutureUntouched(routineId: String, nowMs: Long): Int
}

@Dao
interface AttemptDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(a: AttemptEntity)

    @Query("SELECT * FROM attempts WHERE occurrenceId = :occurrenceId ORDER BY startedAtMs DESC")
    fun observeFor(occurrenceId: String): Flow<List<AttemptEntity>>

    @Query(
        "SELECT a.*, r.name AS routineName FROM attempts a " +
            "JOIN occurrences o ON o.id = a.occurrenceId JOIN routines r ON r.id = o.routineId " +
            "ORDER BY a.startedAtMs DESC LIMIT :limit",
    )
    fun observeRecent(limit: Int): Flow<List<AttemptRow>>
}
