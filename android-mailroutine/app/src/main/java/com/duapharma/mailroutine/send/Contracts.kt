package com.duapharma.mailroutine.send

import com.duapharma.mailroutine.domain.*
import java.time.Duration
import java.time.Instant

/** Persistence port used by the coordinator and sweeper (Room-backed in the app, fakes in tests). */
interface DeliveryStore {
    suspend fun routine(id: String): Routine?
    suspend fun activeRoutines(): List<Routine>
    suspend fun occurrence(id: String): Occurrence?
    suspend fun openOccurrences(): List<Occurrence>

    /** Idempotent: returns false when an occurrence with this id already exists. */
    suspend fun insertIfAbsent(o: Occurrence): Boolean

    /** Atomic compare-and-set: SENDING + lease iff current state is in [from]. */
    suspend fun claim(id: String, from: Set<OccurrenceState>, leaseUntil: Instant, now: Instant): Boolean

    /** Writes [updated] only if the stored row is still in [expected]; false otherwise. */
    suspend fun update(updated: Occurrence, expected: OccurrenceState): Boolean

    suspend fun saveAttempt(a: Attempt)
}

sealed interface TokenResult {
    data class Token(val value: String) : TokenResult
    data object NeedsReauth : TokenResult
    data object NotConnected : TokenResult
    /** Transient problem obtaining a token (offline etc.); nothing was sent. */
    data object Unavailable : TokenResult
}

interface AuthProvider { suspend fun acquire(): TokenResult }

interface AttachmentSource {
    fun isAvailable(ref: AttachmentRef): Boolean
    /** Null when the file can't be read; contents are never logged. */
    fun read(ref: AttachmentRef): ByteArray?
}

fun interface SendScheduler { fun enqueueSend(occurrenceId: String, mode: SendMode, delay: Duration) }

interface Notifier {
    fun reminder(routine: Routine, occurrence: Occurrence)
    fun attention(routine: Routine, occurrence: Occurrence)
}

fun interface Clock { fun now(): Instant }
