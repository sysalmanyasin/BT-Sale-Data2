package com.duapharma.mailroutine.domain

/**
 * Rich (HTML) email bodies.
 *
 * A template is HTML when its stored body starts with [MARKER]. Using a marker instead of a new
 * database column keeps the Room schema (v1) and the backup format unchanged, so existing installs
 * upgrade without a migration. The marker is part of the body, so it is covered by the automatic-send
 * approval fingerprint: switching format or editing the HTML revokes approval like any other edit.
 *
 * Safety model: template HTML is reduced to a small whitelist ([sanitize]); field values are always
 * HTML-escaped when substituted ([escapeValue]); links may only be http, https or mailto.
 */
object HtmlTemplate {
    const val MARKER = "<!--mr:html-->"

    fun isHtml(body: String) = body.startsWith(MARKER)

    /** The HTML without the marker (or the plain text unchanged). */
    fun content(body: String): String = if (isHtml(body)) body.substring(MARKER.length).trimStart('\n', '\r') else body

    fun wrap(html: String) = MARKER + "\n" + html

    private val ALLOWED = setOf(
        "p", "br", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4",
        "blockquote", "div", "span", "hr", "table", "thead", "tbody", "tr", "th", "td", "pre", "code",
    )
    private val VOID = setOf("br", "hr")
    private val DROP_WITH_CONTENT = setOf("script", "style", "iframe", "object", "embed", "head", "title", "noscript", "template", "svg", "math", "form", "textarea", "select")
    private val STYLE_PROPS = setOf(
        "color", "background-color", "font-weight", "font-style", "text-decoration", "text-align", "font-size",
        "font-family", "line-height", "padding", "margin", "border", "border-collapse", "width",
    )
    private val STYLE_VALUE = Regex("^[#A-Za-z0-9 .,%()'\\-]+$")
    private val TAG = Regex("<!--.*?-->|<(/?)([A-Za-z][A-Za-z0-9]*)((?:\"[^\"]*\"|'[^']*'|[^>\"'])*)>", RegexOption.DOT_MATCHES_ALL)
    private val ATTR = Regex("([A-Za-z][A-Za-z0-9_:-]*)\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))")
    private val BARE_AMP = Regex("&(?!#?[A-Za-z0-9]+;)")

    /** Escapes text for HTML element content. */
    fun escape(s: String): String =
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

    /** Escapes a user-entered field value; line breaks become <br>. */
    fun escapeValue(s: String): String = escape(s).replace("\r\n", "\n").replace('\r', '\n').replace("\n", "<br>")

    /** Turns plain text into simple HTML paragraphs (used when switching a template to rich format). */
    fun fromPlain(text: String): String =
        text.replace("\r\n", "\n").trim().split(Regex("\n{2,}")).filter { it.isNotBlank() }
            .joinToString("\n") { "<p>" + escape(it).replace("\n", "<br>") + "</p>" }

    private fun fixText(s: String) = s.replace("<", "&lt;").replace(">", "&gt;").replace(BARE_AMP, "&amp;")
    private fun fixAttr(s: String) = fixText(s).replace("\"", "&quot;")

    private fun safeStyle(raw: String): String =
        raw.split(';').mapNotNull { decl ->
            val i = decl.indexOf(':'); if (i <= 0) return@mapNotNull null
            val prop = decl.substring(0, i).trim().lowercase(); val value = decl.substring(i + 1).trim()
            val lower = value.lowercase()
            if (prop !in STYLE_PROPS || value.isEmpty() || !STYLE_VALUE.matches(value)) null
            else if ("url(" in lower || "expression" in lower || "javascript" in lower || "@import" in lower) null
            else "$prop: $value"
        }.joinToString("; ")

    private fun safeHref(v: String): String? {
        val t = v.trim()
        if (t.any { it.isWhitespace() || it.isISOControl() } || "{{" in t) return null
        val l = t.lowercase()
        return if (l.startsWith("http://") || l.startsWith("https://") || l.startsWith("mailto:")) t else null
    }

    private fun attributes(tag: String, rawAttrs: String): String {
        val sb = StringBuilder()
        for (m in ATTR.findAll(rawAttrs)) {
            val name = m.groupValues[1].lowercase()
            val value = m.groups[3]?.value ?: m.groups[4]?.value ?: m.groups[5]?.value ?: ""
            when {
                tag == "a" && name == "href" -> safeHref(value)?.let { sb.append(" href=\"").append(fixAttr(it)).append('"') }
                name == "style" -> safeStyle(value).takeIf { it.isNotEmpty() }?.let { sb.append(" style=\"").append(fixAttr(it)).append('"') }
                (tag == "td" || tag == "th") && (name == "colspan" || name == "rowspan") && value.trim().toIntOrNull() in 1..20 ->
                    sb.append(' ').append(name).append("=\"").append(value.trim().toInt()).append('"')
            }
        }
        if (tag == "a" && sb.contains("href=")) sb.append(" rel=\"noopener noreferrer\"")
        return sb.toString()
    }

    /** Reduces arbitrary HTML to the whitelist. Idempotent. Placeholders like {{key}} pass through in text. */
    fun sanitize(html: String): String {
        val out = StringBuilder()
        val open = ArrayDeque<String>()
        var skipping: String? = null
        var pos = 0
        fun text(s: String) { if (skipping == null) out.append(fixText(s)) }
        for (m in TAG.findAll(html)) {
            text(html.substring(pos, m.range.first)); pos = m.range.last + 1
            val closing = m.groupValues[1] == "/"
            val rawName = m.groupValues[2].lowercase()
            if (m.value.startsWith("<!--")) continue
            if (skipping != null) { if (closing && rawName == skipping) skipping = null; continue }
            if (!closing && rawName in DROP_WITH_CONTENT) { if (!m.value.endsWith("/>")) skipping = rawName; continue }
            if (rawName !in ALLOWED) continue
            if (closing) {
                if (rawName in VOID || rawName !in open) continue
                while (open.isNotEmpty()) { val t = open.removeLast(); out.append("</").append(t).append('>'); if (t == rawName) break }
            } else if (rawName in VOID) {
                out.append('<').append(rawName).append('>')
            } else {
                out.append('<').append(rawName).append(attributes(rawName, m.groupValues[3])).append('>')
                open.addLast(rawName)
            }
        }
        text(html.substring(pos))
        while (open.isNotEmpty()) out.append("</").append(open.removeLast()).append('>')
        return out.toString()
    }

    private val ENTITY = Regex("&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);")

    private fun decodeEntities(s: String): String = ENTITY.replace(s) { m ->
        when (val e = m.groupValues[1]) {
            "amp" -> "&"; "lt" -> "<"; "gt" -> ">"; "quot" -> "\""; "apos" -> "'"; "nbsp" -> " "
            else -> when {
                e.startsWith("#x") -> e.substring(2).toIntOrNull(16)?.takeIf { it in 1..0x10FFFF }?.let { String(Character.toChars(it)) } ?: m.value
                e.startsWith("#") -> e.substring(1).toIntOrNull()?.takeIf { it in 1..0x10FFFF }?.let { String(Character.toChars(it)) } ?: m.value
                else -> m.value
            }
        }
    }

    /** Plain-text rendering used as the text/plain alternative and when converting back from rich format. */
    fun toText(html: String): String {
        var s = html
        s = Regex("(?is)<(script|style)[^>]*>.*?</\\1>").replace(s, "")
        s = Regex("(?is)<a\\s[^>]*?href\\s*=\\s*\"([^\"]*)\"[^>]*>(.*?)</a>").replace(s) { m ->
            val label = m.groupValues[2].replace(Regex("(?s)<[^>]*>"), "").trim(); val url = decodeEntities(m.groupValues[1])
            if (label.isEmpty() || decodeEntities(label) == url) url else "$label ($url)"
        }
        s = Regex("(?i)<br\\s*/?>").replace(s, "\n")
        s = Regex("(?i)<li[^>]*>").replace(s, "\n• ")
        s = Regex("(?i)</(p|div|h[1-6]|ul|ol|tr|blockquote|pre|table)>").replace(s, "\n\n")
        s = Regex("(?i)</(td|th)>").replace(s, "\t")
        s = Regex("(?s)<[^>]*>").replace(s, "")
        s = decodeEntities(s)
        s = s.lines().joinToString("\n") { it.trimEnd() }
        return Regex("\n{3,}").replace(s, "\n\n").trim()
    }

    /** Full document for the sandboxed preview and for the HTML part of a sent message. */
    fun document(bodyHtml: String): String =
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>" +
            "<body style=\"font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2a37;\">" + bodyHtml + "</body></html>"
}

val EmailTemplate.isHtml: Boolean get() = HtmlTemplate.isHtml(body)
