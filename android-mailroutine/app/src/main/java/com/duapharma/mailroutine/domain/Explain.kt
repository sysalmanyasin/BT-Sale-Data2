package com.duapharma.mailroutine.domain

/** Plain-language explanations for stored error codes; shown in the UI and notifications. */
object Explain {
    fun errorCode(code: String?): String = when {
        code == null -> ""
        code == "NETWORK" || code == "NETWORK_EXHAUSTED" -> "No connection reached Gmail. Nothing was sent."
        code.startsWith("RATE_LIMITED") -> "Gmail is rate limiting this account. Nothing was sent."
        code == "AUTH_REQUIRED" || code == "TOKEN_REJECTED" -> "Gmail access needs to be re-authorized in Settings. Nothing was sent."
        code == "NOT_CONNECTED" -> "No Gmail account is connected. Nothing was sent."
        code == "FORBIDDEN" -> "Google refused the request. Your Workspace admin may restrict this app, or the permission was removed."
        code == "OUT_OF_MEMORY" -> "The phone ran out of memory preparing this message. Nothing was sent. Use fewer or smaller attachments."
        code == "TOO_LARGE" -> "The message is too large for Gmail."
        code == "REJECTED" || code == "BAD_MESSAGE" || code.startsWith("HTTP_4") -> "Gmail rejected the message. Check recipients and attachments."
        code == "MISSING_INPUT" -> "Required fields are empty."
        code == "INVALID_ROUTINE" -> "The routine has invalid settings (recipients or template)."
        code == "ATTACHMENT_UNAVAILABLE" -> "A required attachment is missing."
        code == "PAUSED" -> "The routine is paused."
        code == "AUTO_NOT_APPROVED" -> "Automatic sending is not approved for the current template."
        code == "TOO_LATE_FOR_AUTO" -> "Too late for automatic sending; send it yourself or skip it."
        code == "LEASE_EXPIRED" || code == "IO_AFTER_SEND" || code == "BAD_RESPONSE" || code == "SENDER_EXCEPTION" || code.startsWith("HTTP_5") || code == "AMBIGUOUS" ->
            "The app could not confirm whether Gmail accepted this email. Check your Gmail Sent folder before deciding."
        else -> "Something went wrong ($code)."
    }

    fun state(s: OccurrenceState): String = when (s) {
        OccurrenceState.SCHEDULED -> "Scheduled"
        OccurrenceState.BLOCKED -> "Needs attention"
        OccurrenceState.SENDING -> "Sending"
        OccurrenceState.FAILED_RETRYABLE -> "Will retry"
        OccurrenceState.FAILED -> "Failed"
        OccurrenceState.UNCERTAIN -> "Unconfirmed"
        OccurrenceState.SUBMITTED -> "Accepted by Gmail"
        OccurrenceState.CONFIRMED_SENT -> "Sent (confirmed by you)"
        OccurrenceState.SKIPPED -> "Skipped"
    }

    const val SUBMITTED_NOTE = "Accepted by Gmail for sending. This does not confirm delivery to the recipients."
}
