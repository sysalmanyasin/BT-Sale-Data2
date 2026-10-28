package com.duapharma.mailroutine.domain

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

enum class FieldType { TEXT, MULTILINE, NUMBER, DATE, BOOLEAN, CHOICE }

/** A typed input the user fills in per occurrence; referenced in the template as {{key}}. */
data class TemplateField(
    val key: String,
    val label: String,
    val type: FieldType,
    val required: Boolean,
    val defaultValue: String? = null,
    val choices: List<String> = emptyList(),
    val maxLength: Int = 2000,
)

data class EmailTemplate(
    val subject: String,
    val body: String,
    val fields: List<TemplateField>,
)

data class Recipients(
    val to: List<String>,
    val cc: List<String> = emptyList(),
    val bcc: List<String> = emptyList(),
) {
    val all: List<String> get() = to + cc + bcc
}

enum class ScheduleKind { DAILY, WEEKLY }

data class Schedule(
    val kind: ScheduleKind,
    /** Only meaningful for WEEKLY; must be non-empty then. */
    val days: Set<DayOfWeek>,
    val time: LocalTime,
    /** IANA zone id; the routine fires at this wall-clock time in this zone. */
    val zoneId: String,
)

data class AttachmentRef(
    /** Stable id; the bytes live in app-private storage under this id. */
    val id: String,
    val displayName: String,
    val sizeBytes: Long,
    val mimeType: String,
    val required: Boolean = true,
)

/**
 * Explicit opt-in for automatic sending. Valid only while [fingerprint] equals the routine's
 * current approval fingerprint; any material edit therefore revokes it implicitly.
 */
data class AutoSendConsent(
    val grantedAt: Instant,
    val fingerprint: String,
)

data class Routine(
    val id: String,
    val name: String,
    val recipients: Recipients,
    val template: EmailTemplate,
    val schedule: Schedule,
    val attachments: List<AttachmentRef> = emptyList(),
    val paused: Boolean = false,
    /** Occurrences are only materialised from this instant on (creation or last resume). */
    val activeSince: Instant,
    val autoSendEnabled: Boolean = false,
    val consent: AutoSendConsent? = null,
    /** Automatic sending is skipped when the due time is older than this many minutes. */
    val maxLateMinutes: Int = 120,
    val reminderLeadMinutes: Int = 15,
    val createdAt: Instant,
    val updatedAt: Instant,
)

enum class OccurrenceState {
    SCHEDULED, BLOCKED, SENDING, FAILED_RETRYABLE, FAILED, UNCERTAIN,
    SUBMITTED, CONFIRMED_SENT, SKIPPED;

    val isTerminal: Boolean get() = this == SUBMITTED || this == CONFIRMED_SENT || this == SKIPPED
}

data class Occurrence(
    /** "<routineId>:<localDate>" — unique per routine and local calendar date. */
    val id: String,
    val routineId: String,
    val localDate: LocalDate,
    val dueAt: Instant,
    val state: OccurrenceState = OccurrenceState.SCHEDULED,
    val values: Map<String, String> = emptyMap(),
    val attempts: Int = 0,
    val leaseUntil: Instant? = null,
    val nextRetryAt: Instant? = null,
    val gmailMessageId: String? = null,
    val lastErrorCode: String? = null,
    val reminderSentAt: Instant? = null,
    /** The state for which the user was last pushed an attention notification. */
    val attentionNotifiedFor: OccurrenceState? = null,
    val updatedAt: Instant,
) {
    companion object {
        fun idFor(routineId: String, date: LocalDate) = "$routineId:$date"
    }
}

enum class AttemptOutcome { STARTED, SUBMITTED, FAILED, RETRY_SCHEDULED, UNCERTAIN, BLOCKED }

/** History row. Deliberately holds no recipient addresses, body text or tokens. */
data class Attempt(
    val id: String,
    val occurrenceId: String,
    val startedAt: Instant,
    val finishedAt: Instant? = null,
    val outcome: AttemptOutcome,
    val errorCode: String? = null,
    val gmailMessageId: String? = null,
    val subject: String = "",
)
