package com.duapharma.closingwidget

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

/** Inventory assistant: stock/price answers from live inventory rows, plus general medicine questions. Stateless server; history is kept here in memory. */
class InventoryChatActivity : AppCompatActivity() {

    private val history = ArrayList<Pair<String, String>>()
    private lateinit var log: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var send: Button

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun bubble(text: String, user: Boolean, error: Boolean = false): TextView {
        val tv = TextView(this).apply {
            this.text = text
            textSize = 15f
            setTextIsSelectable(true)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            setTextColor(if (user) Color.WHITE else if (error) 0xFFB42318.toInt() else 0xFF14213D.toInt())
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(if (user) 0xFF087F8C.toInt() else 0xFFEAF0F4.toInt())
            }
        }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8)
            gravity = if (user) Gravity.END else Gravity.START
            if (user) marginStart = dp(48) else marginEnd = dp(48)
        }
        log.addView(tv, lp)
        scroll.post { scroll.fullScroll(ScrollView.FOCUS_DOWN) }
        return tv
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Inventory Assistant"

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xFFF6F8FB.toInt()) }
        val header = TextView(this).apply {
            text = "Ask about stock, price or any medicine"
            textSize = 13f; setTextColor(0xFF64748B.toInt()); setPadding(dp(16), dp(14), dp(16), dp(6))
        }
        root.addView(header)

        scroll = ScrollView(this)
        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, dp(14), dp(14)) }
        scroll.addView(log)
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(10), dp(8), dp(10), dp(8)); setBackgroundColor(Color.WHITE) }
        input = EditText(this).apply {
            hint = "e.g. Panadol tab stock?"
            setSingleLine(true); imeOptions = EditorInfo.IME_ACTION_SEND
        }
        send = Button(this).apply { text = "Send"; setTypeface(typeface, Typeface.BOLD) }
        bar.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(send)
        root.addView(bar)
        setContentView(root)

        bubble("Hi! Ask me about stock or price of a product, what's running low, or general medicine questions.", false)

        send.setOnClickListener { submit() }
        input.setOnEditorActionListener { _, actionId, _ -> if (actionId == EditorInfo.IME_ACTION_SEND) { submit(); true } else false }
        intent.getStringExtra("prefill")?.let { input.setText(it) }
    }

    private fun submit() {
        val msg = input.text.toString().trim()
        if (msg.isEmpty() || !send.isEnabled) return
        input.setText("")
        bubble(msg, true)
        history.add("user" to msg)
        val thinking = bubble("Thinking…", false)
        send.isEnabled = false; input.isEnabled = false
        val snapshot = ArrayList(history)
        thread {
            val result = try {
                val ctx = InventoryRepository.buildChatContext(msg)
                    ?: throw Exception("Couldn't reach inventory — check connection")
                Result.success(AiClient.chat(snapshot, ctx))
            } catch (e: Exception) { Result.failure(e) }
            runOnUiThread {
                log.removeView(thinking)
                result.onSuccess { reply -> bubble(reply, false); history.add("assistant" to reply) }
                    .onFailure { e -> bubble("Could not reach the assistant. ${e.message ?: ""}", false, true); history.removeAt(history.size - 1) }
                send.isEnabled = true; input.isEnabled = true; input.requestFocus()
            }
        }
    }
}
