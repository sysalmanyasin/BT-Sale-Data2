package com.duapharma.mailroutine.ui

import android.graphics.Color as AndroidColor
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.duapharma.mailroutine.domain.HtmlTemplate

/**
 * Sandboxed preview of a rich email: JavaScript off, no file/content access, network loads blocked and all
 * navigation (link taps) swallowed, so previewing can never fetch anything or leave the app.
 */
@Composable
fun HtmlPreview(html: String, modifier: Modifier = Modifier) {
    val doc = remember(html) { HtmlTemplate.document(html) }
    AndroidView(
        modifier = modifier.fillMaxWidth().height(320.dp),
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.blockNetworkLoads = true
                setBackgroundColor(AndroidColor.WHITE)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = true
                }
            }
        },
        update = { wv ->
            if (wv.tag != doc) { wv.tag = doc; wv.loadDataWithBaseURL(null, doc, "text/html", "utf-8", null) }
        },
    )
}

private fun TextFieldValue.wrapSelection(open: String, close: String): TextFieldValue {
    val s = selection.min; val e = selection.max
    val t = text.substring(0, s) + open + text.substring(s, e) + close + text.substring(e)
    val caret = if (s == e) s + open.length else e + open.length + close.length
    return copy(text = t, selection = TextRange(caret))
}

private fun TextFieldValue.replaceSelection(snippet: String): TextFieldValue {
    val s = selection.min; val e = selection.max
    return copy(text = text.substring(0, s) + snippet + text.substring(e), selection = TextRange(s + snippet.length))
}

@Composable
private fun ToolButton(label: String, bold: Boolean = false, italic: Boolean = false, underline: Boolean = false, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp), modifier = Modifier.height(36.dp)) {
        Text(
            label,
            fontWeight = if (bold) FontWeight.Bold else null,
            fontStyle = if (italic) FontStyle.Italic else null,
            textDecoration = if (underline) TextDecoration.Underline else null,
        )
    }
}

/**
 * HTML source editor with a formatting toolbar that wraps the current selection in tags and chips that insert
 * {{fields}} at the cursor. [resetKey] must change when the text is replaced from outside (format switch, AI draft).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HtmlBodyEditor(html: String, resetKey: Int, placeholders: List<String>, onChange: (String) -> Unit) {
    var tfv by remember(resetKey) { mutableStateOf(TextFieldValue(html)) }
    fun push(v: TextFieldValue) { tfv = v; onChange(v.text) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ToolButton("B", bold = true) { push(tfv.wrapSelection("<b>", "</b>")) }
            ToolButton("I", italic = true) { push(tfv.wrapSelection("<i>", "</i>")) }
            ToolButton("U", underline = true) { push(tfv.wrapSelection("<u>", "</u>")) }
            ToolButton("Heading") { push(tfv.wrapSelection("<h2>", "</h2>")) }
            ToolButton("Paragraph") { push(tfv.wrapSelection("<p>", "</p>")) }
            ToolButton("Bullets") { push(tfv.wrapSelection("<ul>\n<li>", "</li>\n</ul>")) }
            ToolButton("Link") { push(tfv.wrapSelection("<a href=\"https://\">", "</a>")) }
        }
        OutlinedTextField(
            value = tfv, onValueChange = { push(it) }, label = { Text("Body (HTML)") },
            modifier = Modifier.fillMaxWidth(), minLines = 8,
            supportingText = { Text("Allowed: text formatting, links (http, https, mailto), lists, tables. Scripts and images are removed.") },
        )
        if (placeholders.isNotEmpty()) {
            Note("Tap to insert a field at the cursor")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                placeholders.forEach { k -> AssistChip(onClick = { push(tfv.replaceSelection("{{$k}}")) }, label = { Text(k) }) }
            }
        }
    }
}
