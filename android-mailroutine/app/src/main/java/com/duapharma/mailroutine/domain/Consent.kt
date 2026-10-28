package com.duapharma.mailroutine.domain

import java.security.MessageDigest
import java.time.Instant

/**
 * Everything the user approved for unattended sending. If any of it changes (template text,
 * fields, recipients, attachments), the fingerprint changes and consent silently lapses — so AI
 * drafts or edits can never alter an approved automatic template without fresh approval.
 */
object Consent {
    fun fingerprint(r: Routine): String {
        val sb = StringBuilder()
        fun line(k: String, v: String) = sb.append(k).append('=').append(v.length).append(':').append(v).append('\n')
        line("subject", r.template.subject)
        line("body", r.template.body)
        r.template.fields.forEach { f ->
            line("field", listOf(f.key, f.label, f.type, f.required, f.defaultValue ?: "", f.choices.joinToString("\u0001"), f.maxLength).joinToString("\u0000"))
        }
        line("to", r.recipients.to.joinToString(",") { it.lowercase() })
        line("cc", r.recipients.cc.joinToString(",") { it.lowercase() })
        line("bcc", r.recipients.bcc.joinToString(",") { it.lowercase() })
        r.attachments.forEach { line("att", "${it.id}|${it.displayName}|${it.required}") }
        val digest = MessageDigest.getInstance("SHA-256").digest(sb.toString().toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun grant(r: Routine, now: Instant): Routine =
        r.copy(autoSendEnabled = true, consent = AutoSendConsent(now, fingerprint(r)), updatedAt = now)

    fun revoke(r: Routine, now: Instant): Routine =
        r.copy(autoSendEnabled = false, consent = null, updatedAt = now)

    fun isValid(r: Routine): Boolean = r.autoSendEnabled && r.consent?.fingerprint == fingerprint(r)

    /** Applies an edit; consent survives only when the approved content is untouched. */
    fun afterEdit(edited: Routine, now: Instant): Routine =
        if (edited.autoSendEnabled && !isValid(edited)) edited.copy(autoSendEnabled = false, consent = null, updatedAt = now)
        else edited.copy(updatedAt = now)
}
