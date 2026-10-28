package com.duapharma.mailroutine

import com.duapharma.mailroutine.domain.*
import com.duapharma.mailroutine.send.*
import com.duapharma.mailroutine.send.Clock
import java.time.*
import kotlin.concurrent.withLock

object Fx {
    val NOW: Instant = Instant.parse("2026-03-02T09:30:00Z") // a Monday
    val schedule = Schedule(ScheduleKind.DAILY, emptySet(), LocalTime.of(9, 0), "UTC")

    fun routine(
        id: String = "r1",
        fields: List<TemplateField> = listOf(TemplateField("amount", "Amount", FieldType.NUMBER, required = true)),
        subject: String = "Report {{date}}",
        body: String = "Amount: {{amount}}",
        auto: Boolean = false,
        schedule: Schedule = Fx.schedule,
        attachments: List<AttachmentRef> = emptyList(),
        to: List<String> = listOf("boss@example.com"),
    ): Routine {
        val r = Routine(
            id = id, name = "Daily report", recipients = Recipients(to),
            template = EmailTemplate(subject, body, fields), schedule = schedule, attachments = attachments,
            activeSince = Instant.parse("2026-02-01T00:00:00Z"), createdAt = NOW, updatedAt = NOW,
        )
        return if (auto) Consent.grant(r, NOW) else r
    }

    fun occurrence(
        routineId: String = "r1",
        date: LocalDate = LocalDate.parse("2026-03-02"),
        state: OccurrenceState = OccurrenceState.SCHEDULED,
        values: Map<String, String> = mapOf("amount" to "42"),
        dueAt: Instant = Instant.parse("2026-03-02T09:00:00Z"),
    ) = Occurrence(Occurrence.idFor(routineId, date), routineId, date, dueAt, state, values, updatedAt = NOW)
}

class MutableClock(var instant: Instant = Fx.NOW) : Clock { override fun now() = instant }

class FakeStore : DeliveryStore {
    val routines = linkedMapOf<String, Routine>()
    val occurrences = linkedMapOf<String, Occurrence>()
    val attempts = mutableListOf<Attempt>()
    /** Simulates a racing worker winning the claim. */
    @Volatile var loseClaim = false
    private val lock = java.util.concurrent.locks.ReentrantLock()
    private inline fun <T> sync(block: () -> T): T = lock.withLock { block() }

    override suspend fun routine(id: String) = sync { routines[id] }
    override suspend fun activeRoutines() = sync { routines.values.toList() }
    override suspend fun occurrence(id: String) = sync { occurrences[id] }
    override suspend fun openOccurrences() = sync { occurrences.values.filter { !it.state.isTerminal } }
    override suspend fun insertIfAbsent(o: Occurrence): Boolean = sync {
        if (occurrences.containsKey(o.id)) false else { occurrences[o.id] = o; true }
    }
    /** Atomic compare-and-set, like the SQL UPDATE ... WHERE state IN (...) used in production. */
    override suspend fun claim(id: String, from: Set<OccurrenceState>, leaseUntil: Instant, now: Instant): Boolean = sync {
        val o = occurrences[id]
        if (loseClaim || o == null || o.state !in from) false
        else { occurrences[id] = o.copy(state = OccurrenceState.SENDING, leaseUntil = leaseUntil, updatedAt = now); true }
    }
    override suspend fun update(updated: Occurrence, expected: OccurrenceState): Boolean = sync {
        val cur = occurrences[updated.id]
        if (cur == null || cur.state != expected) false
        else {
            if (cur.state != updated.state) StateMachine.require(cur.state, updated.state)
            occurrences[updated.id] = updated; true
        }
    }
    override suspend fun saveAttempt(a: Attempt) = sync {
        val i = attempts.indexOfFirst { it.id == a.id }
        if (i >= 0) attempts[i] = a else attempts += a
    }
}
