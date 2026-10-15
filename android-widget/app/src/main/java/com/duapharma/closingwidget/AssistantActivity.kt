package com.duapharma.closingwidget

import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.concurrent.thread

/** Authorized staff Quick Add and server-enforced read-only Ask Dua. */
class AssistantActivity : AppCompatActivity() {
    private val base = BuildConfig.SUPABASE_URL
    private val anon = BuildConfig.SUPABASE_ANON_KEY
    private var token: String? = null
    private var pendingRequestId: String? = null
    private lateinit var root: LinearLayout
    private lateinit var screenScroll: ScrollView
    private lateinit var status: TextView
    private lateinit var email: EditText
    private lateinit var password: EditText
    private lateinit var kind: Spinner
    private lateinit var section: Spinner
    private lateinit var category: Spinner
    private lateinit var staff: Spinner
    private lateinit var shift: Spinner
    private lateinit var date: EditText
    private lateinit var amount: EditText
    private lateinit var description: EditText
    private lateinit var question: EditText
    private lateinit var answer: TextView
    private val sectionIds = mutableListOf<String>()
    private val categoryIds = mutableListOf<String>()
    private val staffIds = mutableListOf<String>()
    private var sections = JSONObject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screenScroll = ScrollView(this)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 32)
        }
        screenScroll.addView(root)
        setContentView(screenScroll)

        text("Quick Add & Ask Dua", 22f, true)
        text("Sign in with your own authorized BT Sale Data account. The widget-service account is read-only.", 14f)
        email = edit("Authorized staff email", InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        password = edit("Password", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        button("Sign in") { signIn() }
        status = text("Not signed in", 14f)

        divider()
        text("⚡ Quick Add", 19f, true)
        kind = spinner(listOf("Jazz Cash", "Expenses / Patty", "Staff Credit"))
        root.addView(kind)
        date = edit("Date (YYYY-MM-DD)", InputType.TYPE_CLASS_TEXT).apply {
            setText(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()))
        }
        section = spinner(emptyList())
        category = spinner(emptyList())
        staff = spinner(emptyList())
        shift = spinner(listOf("No shift", "Morning", "Evening", "Night", "Both", "Off"))
        label("Section"); root.addView(section)
        label("Category"); root.addView(category)
        label("Staff member (for Staff Credit)"); root.addView(staff)
        label("Shift (Jazz Cash only, optional)"); root.addView(shift)
        amount = edit("Amount (PKR)", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
        description = edit("Description", InputType.TYPE_CLASS_TEXT)
        button("Add entry") { submitEntry() }

        kind.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val creditMode = position == 2
                section.visibility = if (creditMode) View.GONE else View.VISIBLE
                category.visibility = if (creditMode) View.GONE else View.VISIBLE
                staff.visibility = if (creditMode) View.VISIBLE else View.GONE
                shift.visibility = if (position == 0) View.VISIBLE else View.GONE
                if (!creditMode && sectionIds.isNotEmpty()) {
                    val target = if (position == 1) "expense" else "jazzcash"
                    val index = sectionIds.indexOf(target)
                    if (index >= 0) section.setSelection(index)
                    populateCategories(section.selectedItemPosition)
                }
            }
        }
        section.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                populateCategories(position)
            }
        }

        divider()
        text("💬 Ask Dua · read-only", 19f, true)
        text("Ask questions about live BT Sale Data records. This assistant cannot add, edit, or delete data.", 14f)
        question = edit("Ask a business question…", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE)
        question.minLines = 2
        button("Ask Dua") { askDua() }
        answer = text("", 15f)

        when (intent.getStringExtra("initial_kind")) {
            "jazzcash" -> kind.setSelection(0)
            "expense" -> kind.setSelection(1)
            "credit" -> kind.setSelection(2)
        }
        if (intent.getBooleanExtra("focus_ask_dua", false)) {
            screenScroll.post { screenScroll.fullScroll(View.FOCUS_DOWN) }
        }
        restore()
    }

    private fun text(value: String, size: Float, bold: Boolean = false): TextView {
        val view = TextView(this).apply {
            text = value
            textSize = size
            setPadding(0, 8, 0, 8)
            if (bold) setTypeface(null, android.graphics.Typeface.BOLD)
        }
        root.addView(view)
        return view
    }

    private fun label(value: String) { text(value, 14f) }

    private fun edit(hintText: String, type: Int): EditText {
        val field = EditText(this).apply {
            hint = hintText
            inputType = type
            setPadding(12, 8, 12, 8)
        }
        root.addView(field)
        return field
    }

    private fun spinner(items: List<String>) = Spinner(this).apply {
        adapter = ArrayAdapter(this@AssistantActivity, android.R.layout.simple_spinner_dropdown_item, items)
    }

    private fun button(value: String, click: () -> Unit) {
        root.addView(Button(this).apply { text = value; setOnClickListener { click() } })
    }

    private fun divider() {
        root.addView(View(this).apply {
            setBackgroundColor(0xFFCCCCCC.toInt())
            layoutParams = LinearLayout.LayoutParams(-1, 1).apply { topMargin = 14; bottomMargin = 10 }
        })
    }

    private fun prefs() = run {
        val key = MasterKey.Builder(applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            applicationContext, "assistant_staff_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private fun restore() {
        val refresh = prefs().getString("refresh", null) ?: return
        thread {
            val pair = tokenRequest("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", refresh))
            runOnUiThread {
                if (pair != null) {
                    token = pair.first
                    prefs().edit().putString("refresh", pair.second).apply()
                    loadMetadata()
                }
            }
        }
    }

    private fun signIn() {
        val userEmail = email.text.toString().trim()
        val userPassword = password.text.toString()
        if (userEmail.isBlank() || userPassword.isBlank()) {
            status.text = "Enter email and password."
            return
        }
        status.text = "Signing in…"
        thread {
            val pair = tokenRequest("/auth/v1/token?grant_type=password",
                JSONObject().put("email", userEmail).put("password", userPassword))
            runOnUiThread {
                if (pair == null) {
                    status.text = "Sign-in failed. Check credentials and connection."
                    return@runOnUiThread
                }
                token = pair.first
                prefs().edit().putString("refresh", pair.second).apply()
                password.text.clear()
                status.text = "Checking staff authorization…"
                loadMetadata()
            }
        }
    }

    private fun tokenRequest(path: String, body: JSONObject): Pair<String, String>? {
        val connection = URL(base + path).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 10000
            connection.readTimeout = 15000
            connection.setRequestProperty("apikey", anon)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode !in 200..299) return null
            val result = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val access = result.optString("access_token")
            val refresh = result.optString("refresh_token")
            if (access.isBlank() || refresh.isBlank()) null else access to refresh
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun api(body: JSONObject): JSONObject {
        val connection = URL(base + "/functions/v1/android-assistant").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 12000
            connection.readTimeout = 60000
            connection.setRequestProperty("apikey", anon)
            connection.setRequestProperty("Authorization", "Bearer " + (token ?: throw IllegalStateException("Sign in first")))
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val result = JSONObject(stream?.bufferedReader()?.use { it.readText() } ?: "{}")
            if (connection.responseCode !in 200..299) throw IllegalStateException(result.optString("error", "Request failed"))
            return result
        } finally {
            connection.disconnect()
        }
    }

    private fun loadMetadata() {
        thread {
            try {
                val result = api(JSONObject().put("action", "metadata"))
                val sectionObject = result.optJSONObject("sections") ?: JSONObject()
                val ids = mutableListOf<String>()
                val names = mutableListOf<String>()
                val keys = sectionObject.keys()
                while (keys.hasNext()) {
                    val id = keys.next()
                    ids.add(id)
                    names.add(sectionObject.optJSONObject(id)?.optString("label", id) ?: id)
                }
                val staffArray = result.optJSONArray("staff") ?: JSONArray()
                val newStaffIds = mutableListOf<String>()
                val staffNames = mutableListOf<String>()
                for (i in 0 until staffArray.length()) {
                    val row = staffArray.optJSONObject(i) ?: continue
                    newStaffIds.add(row.optString("id"))
                    staffNames.add(row.optString("name"))
                }
                runOnUiThread {
                    sections = sectionObject
                    sectionIds.clear(); sectionIds.addAll(ids)
                    staffIds.clear(); staffIds.addAll(newStaffIds)
                    section.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
                    staff.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, staffNames)
                    val desired = if (kind.selectedItemPosition == 1) "expense" else "jazzcash"
                    val index = sectionIds.indexOf(desired)
                    if (index >= 0) section.setSelection(index)
                    populateCategories(section.selectedItemPosition)
                    status.text = "Authorized staff session ready."
                }
            } catch (error: Exception) {
                runOnUiThread {
                    status.text = error.message ?: "Account is not authorized."
                    token = null
                    prefs().edit().remove("refresh").apply()
                }
            }
        }
    }

    private fun populateCategories(position: Int) {
        val sectionId = sectionIds.getOrNull(position) ?: return
        val rows = sections.optJSONObject(sectionId)?.optJSONArray("categories") ?: JSONArray()
        categoryIds.clear()
        val labels = mutableListOf<String>()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            categoryIds.add(row.optString("id"))
            labels.add(row.optString("label"))
        }
        category.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
    }

    private fun submitEntry() {
        if (token == null) { status.text = "Sign in first."; return }
        val value = amount.text.toString().toDoubleOrNull()
        if (value == null || value <= 0 || description.text.toString().isBlank()) {
            status.text = "Enter a positive amount and description."
            return
        }
        val creditMode = kind.selectedItemPosition == 2
        if (pendingRequestId == null) pendingRequestId = UUID.randomUUID().toString()
        val body = JSONObject().put("action", "quick_add").put("requestId", pendingRequestId)
            .put("kind", if (creditMode) "credit" else "ledger")
            .put("date", date.text.toString().trim()).put("amount", value)
            .put("description", description.text.toString().trim())
        if (creditMode) {
            val index = staff.selectedItemPosition
            if (index !in staffIds.indices) { status.text = "Choose an active staff member."; return }
            body.put("staffId", staffIds[index])
        } else {
            val ledgerType = sectionIds.getOrNull(section.selectedItemPosition)
            val categoryId = categoryIds.getOrNull(category.selectedItemPosition)
            if (ledgerType == null || categoryId == null) { status.text = "Choose a valid section and category."; return }
            body.put("ledgerType", ledgerType).put("categoryId", categoryId)
            if (ledgerType == "jazzcash" && shift.selectedItemPosition > 0) body.put("shift", shift.selectedItem.toString())
        }
        status.text = "Submitting…"
        thread {
            try {
                val result = api(body)
                runOnUiThread {
                    status.text = result.optString("message", "Entry saved.")
                    pendingRequestId = null
                    amount.text.clear()
                    description.text.clear()
                }
            } catch (error: Exception) {
                runOnUiThread { status.text = error.message ?: "Entry was not confirmed; check the ledger before retrying." }
            }
        }
    }

    private fun askDua() {
        if (token == null) { answer.text = "Sign in first."; return }
        val query = question.text.toString().trim()
        if (query.isBlank()) { answer.text = "Type a question first."; return }
        answer.text = "Checking business records…"
        thread {
            try {
                val result = api(JSONObject().put("action", "ask_dua").put("question", query))
                runOnUiThread { answer.text = result.optString("answer", "No answer returned.") }
            } catch (error: Exception) {
                runOnUiThread { answer.text = error.message ?: "Ask Dua is unavailable." }
            }
        }
    }
}
