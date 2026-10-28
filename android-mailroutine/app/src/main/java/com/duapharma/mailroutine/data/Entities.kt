package com.duapharma.mailroutine.data

import androidx.room.ColumnInfo
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "routines")
data class RoutineEntity(
    @PrimaryKey val id: String,
    val name: String,
    val toJson: String,
    val ccJson: String,
    val bccJson: String,
    val subject: String,
    val body: String,
    val fieldsJson: String,
    val attachmentsJson: String,
    val scheduleKind: String,
    val daysCsv: String,
    val time: String,
    val zoneId: String,
    val paused: Boolean,
    val activeSinceMs: Long,
    val autoSendEnabled: Boolean,
    val consentAtMs: Long?,
    val consentFingerprint: String?,
    val maxLateMinutes: Int,
    val reminderLeadMinutes: Int,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

@Entity(
    tableName = "occurrences",
    foreignKeys = [ForeignKey(RoutineEntity::class, ["id"], ["routineId"], onDelete = ForeignKey.CASCADE)],
    // The unique index is the database-level guarantee that an occurrence exists at most once.
    indices = [Index(value = ["routineId", "localDate"], unique = true), Index("state"), Index("dueAtMs")],
)
data class OccurrenceEntity(
    @PrimaryKey val id: String,
    val routineId: String,
    val localDate: String,
    val dueAtMs: Long,
    val state: String,
    val valuesJson: String,
    val attempts: Int,
    val leaseUntilMs: Long?,
    val nextRetryAtMs: Long?,
    val gmailMessageId: String?,
    val lastErrorCode: String?,
    val reminderSentAtMs: Long?,
    val attentionNotifiedFor: String?,
    val updatedAtMs: Long,
)

@Entity(
    tableName = "attempts",
    foreignKeys = [ForeignKey(OccurrenceEntity::class, ["id"], ["occurrenceId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("occurrenceId"), Index("startedAtMs")],
)
data class AttemptEntity(
    @PrimaryKey val id: String,
    val occurrenceId: String,
    val startedAtMs: Long,
    val finishedAtMs: Long?,
    val outcome: String,
    val errorCode: String?,
    val gmailMessageId: String?,
    val subject: String,
)

data class AttemptRow(
    @Embedded val attempt: AttemptEntity,
    @ColumnInfo(name = "routineName") val routineName: String?,
)
