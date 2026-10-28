package com.duapharma.mailroutine.gmail

import com.duapharma.mailroutine.domain.EmailValidator
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID

class MimeAttachment(val fileName: String, val mimeType: String, val bytes: ByteArray)

/** Builds RFC 5322 / MIME messages. Every header value is sanitised against CR/LF injection. */
object MimeBuilder {
    private const val CRLF = "\r\n"
    private val MIME_TYPE = Regex("^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$")

    fun build(
        to: List<String>,
        cc: List<String>,
        bcc: List<String>,
        subject: String,
        body: String,
        attachments: List<MimeAttachment>,
        occurrenceId: String,
        boundary: String = "mr_" + UUID.randomUUID().toString().replace("-", ""),
    ): ByteArray {
        require(to.isNotEmpty()) { "No recipients" }
        (to + cc + bcc).forEach { require(EmailValidator.isValid(it)) { "Invalid recipient" } }

        val sb = StringBuilder()
        sb.append("MIME-Version: 1.0").append(CRLF)
        sb.append("To: ").append(to.joinToString(", ")).append(CRLF)
        if (cc.isNotEmpty()) sb.append("Cc: ").append(cc.joinToString(", ")).append(CRLF)
        if (bcc.isNotEmpty()) sb.append("Bcc: ").append(bcc.joinToString(", ")).append(CRLF)
        sb.append("Subject: ").append(encodeHeader(subject)).append(CRLF)
        sb.append("X-MailRoutine-Occurrence: ").append(headerSafe(occurrenceId)).append(CRLF)

        val bodyPart = textPart(body)
        if (attachments.isEmpty()) {
            sb.append(bodyPart)
        } else {
            sb.append("Content-Type: multipart/mixed; boundary=\"").append(boundary).append('"').append(CRLF).append(CRLF)
            sb.append("--").append(boundary).append(CRLF).append(bodyPart).append(CRLF)
            attachments.forEach { a ->
                val safeName = sanitizeFileName(a.fileName)
                val type = if (MIME_TYPE.matches(a.mimeType)) a.mimeType else "application/octet-stream"
                sb.append("--").append(boundary).append(CRLF)
                sb.append("Content-Type: ").append(type).append("; name=\"").append(asciiFallback(safeName)).append('"').append(CRLF)
                sb.append("Content-Transfer-Encoding: base64").append(CRLF)
                sb.append("Content-Disposition: attachment; filename=\"").append(asciiFallback(safeName)).append("\"; filename*=UTF-8''")
                    .append(percentEncode(safeName)).append(CRLF).append(CRLF)
                sb.append(wrap64(a.bytes)).append(CRLF)
            }
            sb.append("--").append(boundary).append("--").append(CRLF)
        }
        return sb.toString().toByteArray(StandardCharsets.US_ASCII)
    }

    private fun textPart(body: String): String {
        val normalized = body.replace("\r\n", "\n").replace('\r', '\n').replace("\n", CRLF)
        return "Content-Type: text/plain; charset=UTF-8$CRLF" +
            "Content-Transfer-Encoding: base64$CRLF$CRLF" +
            wrap64(normalized.toByteArray(StandardCharsets.UTF_8)) + CRLF
    }

    private fun wrap64(bytes: ByteArray): String =
        Base64.getMimeEncoder(76, CRLF.toByteArray(StandardCharsets.US_ASCII)).encodeToString(bytes)

    internal fun headerSafe(v: String) = v.filter { !it.isISOControl() }.take(200)

    /** RFC 2047 encoded-words for non-ASCII subjects; folded below 76 columns, never splitting a code point. */
    internal fun encodeHeader(raw: String): String {
        val v = raw.replace(Regex("[\\r\\n\\u0000]+"), " ").trim()
        if (v.all { it.code in 32..126 } && v.length <= 60) return v
        val words = mutableListOf<String>()
        val cur = StringBuilder()
        var curBytes = 0
        var i = 0
        while (i < v.length) {
            val cp = v.codePointAt(i)
            val chars = Character.charCount(cp)
            val piece = v.substring(i, i + chars)
            val n = piece.toByteArray(StandardCharsets.UTF_8).size
            if (curBytes + n > 42) {
                words += encodeWord(cur.toString()); cur.setLength(0); curBytes = 0
            }
            cur.append(piece); curBytes += n; i += chars
        }
        if (cur.isNotEmpty()) words += encodeWord(cur.toString())
        return words.joinToString(CRLF + " ")
    }

    private fun encodeWord(s: String) =
        "=?UTF-8?B?" + Base64.getEncoder().encodeToString(s.toByteArray(StandardCharsets.UTF_8)) + "?="

    internal fun sanitizeFileName(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = base.filter { !it.isISOControl() && it != '"' && it != ';' }.trim().take(120)
        return cleaned.ifBlank { "attachment" }
    }

    private fun asciiFallback(s: String) = s.map { if (it.code in 32..126) it else '_' }.joinToString("")

    private fun percentEncode(s: String): String {
        val sb = StringBuilder()
        for (b in s.toByteArray(StandardCharsets.UTF_8)) {
            val c = b.toInt() and 0xff
            if ((c in 'A'.code..'Z'.code) || (c in 'a'.code..'z'.code) || (c in '0'.code..'9'.code) || c == '.'.code || c == '-'.code || c == '_'.code) sb.append(c.toChar())
            else sb.append('%').append("%02X".format(c))
        }
        return sb.toString()
    }
}
