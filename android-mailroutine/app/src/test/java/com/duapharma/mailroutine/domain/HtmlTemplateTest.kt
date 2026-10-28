package com.duapharma.mailroutine.domain

import com.duapharma.mailroutine.Fx
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class HtmlTemplateTest {
    @Test fun scriptsHandlersAndUnknownTagsAreRemoved() {
        val out = HtmlTemplate.sanitize("<p onclick=\"x()\">Hi</p><script>alert(1)</script><img src=x onerror=y>")
        assertEquals("<p>Hi</p>", out)
    }

    @Test fun javascriptLinksAreDroppedButHttpsKept() {
        assertEquals("<a>x</a>", HtmlTemplate.sanitize("<a href=\"javascript:alert(1)\">x</a>"))
        assertEquals(
            "<a href=\"https://example.com/a?b=1&amp;c=2\" rel=\"noopener noreferrer\">x</a>",
            HtmlTemplate.sanitize("<a href=\"https://example.com/a?b=1&c=2\">x</a>"),
        )
    }

    @Test fun placeholdersCannotBeUsedInLinks() {
        assertEquals("<a>x</a>", HtmlTemplate.sanitize("<a href=\"{{link}}\">x</a>"))
    }

    @Test fun styleIsFilteredToSafeProperties() {
        assertEquals(
            "<span style=\"color: red\">t</span>",
            HtmlTemplate.sanitize("<span style=\"color: red; background: url(http://x/y); position: fixed\">t</span>"),
        )
    }

    @Test fun unclosedTagsAreClosedAndSanitizeIsIdempotent() {
        val once = HtmlTemplate.sanitize("<p>one <b>bold <i>x</p> & <y> tail")
        assertEquals(once, HtmlTemplate.sanitize(once))
        assertTrue(once.contains("</b>") && once.contains("</i>"))
    }

    @Test fun fieldValuesAreEscapedAndNeverBecomeMarkup() {
        val t = EmailTemplate("S {{name}}", HtmlTemplate.wrap("<p>Hi {{name}}</p>"), listOf(TemplateField("name", "Name", FieldType.TEXT, true)))
        val r = Placeholders.render(t, mapOf("name" to "<b>x</b> & \"y\""), "R", LocalDate.parse("2026-03-02"))
        assertEquals("<p>Hi &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</p>", r.html)
        assertEquals("Hi <b>x</b> & \"y\"", r.body)
        assertEquals("S <b>x</b> & \"y\"", r.subject) // subject stays plain text
    }

    @Test fun multilineValuesBecomeLineBreaks() {
        val t = EmailTemplate("S", HtmlTemplate.wrap("<p>{{note}}</p>"), listOf(TemplateField("note", "Note", FieldType.MULTILINE, true)))
        val r = Placeholders.render(t, mapOf("note" to "a\nb"), "R", LocalDate.parse("2026-03-02"))
        assertEquals("<p>a<br>b</p>", r.html)
    }

    @Test fun plainTemplatesAreUnchanged() {
        val r = Placeholders.render(Fx.routine().template, mapOf("amount" to "42"), "R", LocalDate.parse("2026-03-02"))
        assertNull(r.html)
        assertEquals("Amount: 42", r.body)
    }

    @Test fun toTextKeepsLinksAndLists() {
        val text = HtmlTemplate.toText("<p>Hello <b>Ann</b></p><ul><li>One</li><li>Two</li></ul><p><a href=\"https://x.io\">Site</a></p>")
        assertTrue(text.startsWith("Hello Ann"))
        assertTrue(text.contains("• One\n• Two"))
        assertTrue(text.contains("Site (https://x.io)"))
    }

    @Test fun fromPlainBuildsEscapedParagraphs() {
        assertEquals("<p>a &amp; b<br>line2</p>\n<p>para</p>", HtmlTemplate.fromPlain("a & b\nline2\n\npara"))
    }

    @Test fun markerRoundTrip() {
        val body = HtmlTemplate.wrap("<p>x</p>")
        assertTrue(HtmlTemplate.isHtml(body))
        assertEquals("<p>x</p>", HtmlTemplate.content(body))
        assertFalse(HtmlTemplate.isHtml("<p>x</p>"))
    }
}
