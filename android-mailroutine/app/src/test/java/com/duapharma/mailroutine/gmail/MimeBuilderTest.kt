package com.duapharma.mailroutine.gmail

import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class MimeBuilderTest {
    private fun build(subject: String = "Hello", body: String = "Body", att: List<MimeAttachment> = emptyList(), bcc: List<String> = emptyList()) =
        String(MimeBuilder.build(listOf("a@example.com"), listOf("c@example.com"), bcc, subject, body, att, "r1:2026-03-02", boundary = "BND"), Charsets.US_ASCII)

    @Test fun headersAndBodyAreEncoded() {
        val m = build()
        assertTrue(m.contains("To: a@example.com\r\n"))
        assertTrue(m.contains("Cc: c@example.com\r\n"))
        assertTrue(m.contains("Subject: Hello\r\n"))
        assertTrue(m.contains("X-MailRoutine-Occurrence: r1:2026-03-02\r\n"))
        assertFalse(m.contains("Bcc:"))
        val b64 = m.substringAfter("\r\n\r\n").trim()
        assertEquals("Body", String(Base64.getMimeDecoder().decode(b64)))
    }

    @Test fun bccHeaderOnlyWhenPresent() {
        assertTrue(build(bcc = listOf("hidden@example.com")).contains("Bcc: hidden@example.com\r\n"))
    }

    @Test fun nonAsciiSubjectUsesEncodedWords() {
        val m = build(subject = "Rapport café – ✓")
        val line = m.lines().first { it.startsWith("Subject:") }
        assertTrue(line.contains("=?UTF-8?B?"))
        assertTrue(m.all { it.code < 128 })
    }

    @Test fun subjectInjectionIsNeutralised() {
        val m = build(subject = "Hi\r\nBcc: evil@example.com")
        assertFalse(m.contains("\r\nBcc: evil"))
    }

    @Test fun invalidRecipientsAreRejected() {
        try {
            MimeBuilder.build(listOf("a@b.com\r\nBcc: x@y.com"), emptyList(), emptyList(), "s", "b", emptyList(), "o")
            fail("expected rejection")
        } catch (e: IllegalArgumentException) { /* ok */ }
    }

    @Test fun attachmentsBecomeMultipartWithSanitisedNames() {
        val m = build(att = listOf(MimeAttachment("../../etc/pa\"ss;wd.pdf", "application/pdf", byteArrayOf(1, 2, 3))))
        assertTrue(m.contains("Content-Type: multipart/mixed; boundary=\"BND\""))
        assertTrue(m.contains("filename=\"passwd.pdf\""))
        assertFalse(m.contains("../"))
        assertTrue(m.trimEnd().endsWith("--BND--"))
    }

    @Test fun badMimeTypeFallsBackToOctetStream() {
        val m = build(att = listOf(MimeAttachment("a.bin", "x\r\nEvil: 1", byteArrayOf(1))))
        assertTrue(m.contains("Content-Type: application/octet-stream; name=\"a.bin\""))
        assertFalse(m.contains("Evil:"))
    }

    @Test fun unicodeFilenameGetsRfc2231Form() {
        val m = build(att = listOf(MimeAttachment("rapport é.pdf", "application/pdf", byteArrayOf(1))))
        assertTrue(m.contains("filename*=UTF-8''rapport%20%C3%A9.pdf"))
    }

    @Test fun htmlBodyBuildsMultipartAlternativeWithPlainFallback() {
        val m = String(MimeBuilder.build(listOf("a@example.com"), emptyList(), emptyList(), "S", "plain text", emptyList(), "r1:2026-03-02", boundary = "BND", htmlBody = "<p>Hi</p>"), Charsets.US_ASCII)
        assertTrue(m.contains("Content-Type: multipart/alternative; boundary=\"BND_alt\""))
        assertTrue(m.contains("Content-Type: text/plain; charset=UTF-8"))
        assertTrue(m.contains("Content-Type: text/html; charset=UTF-8"))
        val doc = com.duapharma.mailroutine.domain.HtmlTemplate.document("<p>Hi</p>")
        val b64 = java.util.Base64.getMimeEncoder(76, "\r\n".toByteArray()).encodeToString(doc.toByteArray())
        assertTrue(m.contains(b64))
        assertTrue(m.trimEnd().endsWith("--BND_alt--"))
    }

    @Test fun htmlWithAttachmentsNestsAlternativeInsideMixed() {
        val m = String(MimeBuilder.build(listOf("a@example.com"), emptyList(), emptyList(), "S", "plain", listOf(MimeAttachment("a.pdf", "application/pdf", byteArrayOf(1))), "r1:2026-03-02", boundary = "BND", htmlBody = "<p>Hi</p>"), Charsets.US_ASCII)
        assertTrue(m.indexOf("multipart/mixed") in 0 until m.indexOf("multipart/alternative"))
        assertTrue(m.trimEnd().endsWith("--BND--"))
    }
}
