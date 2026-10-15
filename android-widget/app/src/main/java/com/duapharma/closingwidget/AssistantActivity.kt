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
    private lateinit var root: LinearLayout
    private lateinit var status: TextView
    private lateinit var email: EditText
    private lateinit var password: EditText
    private lateinit var kind: Spinner
    private lateinit var section: Spinner
    private lateinit var category: Spinner
    private lateinit var staff: Spinner
    private lateinit var date: EditText
    private lateinit var amount: EditText
    private lateinit var description: EditText
    private lateinit var deduction: CheckBox
    private lateinit var question: EditText
    private lateinit var answer: TextView
    private val sectionIds = mutableListOf<String>()
    private val categoryIds = mutableListOf<String>()
    private val staffIds = mutableListOf<String>()
    private var sections = JSONObject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 20, 24, 32) }
        scroll.addView(root); setContentView(scroll)
        text("Quick Add & Ask Dua", 22f, true)
        text("Sign in with your own authorized BT Sale Data account. The widget-service account is read-only.", 14f)
        email = edit("Authorized staff email", InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        password = edit("Password", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        button("Sign in") { signIn() }
        status = text("Not signed in", 14f)
        divider()
        text("⚡ Quick Add", 19f, true)
        kind = spinner(listOf("Jazz Cash", "Expenses / Patty", "New Section", "Staff Credit"))
        date = edit("Date (YYYY-MM-DD)", InputType.TYPE_CLASS_TEXT).apply { setText(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())) }
        section = spinner(emptyList()); category = spinner(emptyList()); staff = spinner(emptyList())
        label("Section"); root.addView(section); label("Category"); root.addView(category)
        label("Staff member (for Staff Credit)"); root.addView(staff)
        deduction = CheckBox(this).apply { text = "Deduction (subtract from staff credit)"; visibility = View.GONE }; root.addView(deduction)
        amount = edit("Amount (PKR)", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
        description = edit("Description", InputType.TYPE_CLASS_TEXT)
        button("Add entry") { submitEntry() }
        kind.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val credit = position == 3
                section.visibility = if (credit) View.GONE else View.VISIBLE
                category.visibility = if (credit) View.GONE else View.VISIBLE
                deduction.visibility = if (credit) View.VISIBLE else View.GONE
                staff.visibility = if (credit) View.VISIBLE else View.GONE
                if (!credit && sectionIds.isNotEmpty()) updateCategories()
            }
        }
        divider()
        text("💬 Ask Dua · read-only", 19f, true)
        text("Ask questions about live BT Sale Data records. This assistant cannot add, edit, or delete data.", 14f)
        question = edit("Ask a business question…", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE)
        question.minLines = 2
        button("Ask Dua") { askDua() }
        answer = text("", 15f)
        restore()
    }
    private fun text(s: String, size: Float, bold: Boolean = false): TextView {
        val v = TextView(this).apply { text = s; textSize = size; setPadding(0, 8, 0, 8); if (bold) setTypeface(null, android.graphics.Typeface.BOLD) }
        root.addView(v); return v
    }
    private fun label(s: String) { text(s, 14f) }
    private fun edit(hintText: String, type: Int): EditText {
        val e = EditText(this).apply { hint = hintText; inputType = type; setPadding(12, 8, 12, 8) }
        root.addView(e); return e
    }
    private fun spinner(items: List<String>) = Spinner(this).apply { adapter = ArrayAdapter(this@AssistantActivity, android.R.layout.simple_spinner_dropdown_item, items) }
    private fun button(s: String, click: () -> Unit) { root.addView(Button(this).apply { text = s; setOnClickListener { click() } }) }
    private fun divider() { root.addView(View(this).apply { setBackgroundColor(0xFFCCCCCC.toInt()); layoutParams = LinearLayout.LayoutParams(-1, 1).apply { topMargin = 14; bottomMargin = 10 } }) }
    private fun prefs() = run {
        val key = MasterKey.Builder(applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(applicationContext, "assistant_staff_session", key, EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }
    private fun restore() {
        val refresh = prefs().getString("refresh", null) ?: return
        thread {
            val pair = tokenRequest("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", refresh))
            runOnUiThread { if (pair != null) { token = pair.first; prefs().edit().putString("refresh", pair.second).apply(); loadMetadata() } }
        }
    }
    private fun signIn() {
        val e = email.text.toString().trim(); val p = password.text.toString()
        if (e.isBlank() || p.isBlank()) { status.text = "Enter email and password."; return }
        status.text = "Signing in…"
        thread {
            val pair = tokenRequest("/auth/v1/token?grant_type=password", JSONObject().put("email", e).put("password", p))
            runOnUiThread {
                if (pair == null) { status.text = "Sign-in failed. Check credentials and connection."; return@runOnUiThread }
                token = pair.first; prefs().edit().putString("refresh", pair.second).apply(); password.text.clear()
                status.text = "Checking staff authorization…"; loadMetadata()
            }
        }
    }
    private fun tokenRequest(path: String, body: JSONObject): Pair<String, String>? {
        val c = URL(base + path).openConnection() as HttpURLConnection
        return try {
            c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 10000; c.readTimeout = 15000
            c.setRequestProperty("apikey", anon); c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (c.responseCode !in 200..299) return null
            val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            val a = j.optString("access_token"); val r = j.optString("refresh_token")
            if (a.isBlank() || r.isBlank()) null else a to r
        } catch (_: Exception) { null } finally { c.disconnect() }
    }
    private fun api(body: JSONObject): JSONObject {
        val c = URL(base + "/functions/v1/android-assistant").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 12000; c.readTimeout = 60000
            c.setRequestProperty("apikey", anon); c.setRequestProperty("Authorization", "Bearer " + (token ?: throw IllegalStateException("Sign in first")))
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream
            val result = JSONObject(stream?.bufferedReader()?.use { it.readText() } ?: "{}")
            if (c.responseCode !in 200..299) throw IllegalStateException(result.optString("error", "Request failed"))
            return result
        } finally { c.disconnect() }
    }
    private fun loadMetadata() {
        thread {
            try {
                val result = api(JSONObject().put("action", "metadata"))
                val sec = result.optJSONObject("sections") ?: JSONObject()
                val ids = mutableListOf<String>(); val names = mutableListOf<String>()
                val keys = sec.keys()
                while (keys.hasNext()) { val id = keys.next(); ids.add(id); names.add(sec.optJSONObject(id)?.optString("label", id) ?: id) }
                val arr = result.optJSONArray("staff") ?: JSONArray()
                val sids = mutableListOf<String>(); val snames = mutableListOf<String>()
                for (i in 0 until arr.length()) { val row = arr.optJSONObject(i) ?: continue; sids.add(row.optString("id")); snames.add(row.optString("name")) }
                runOnUiThread {
                    sections = sec; sectionIds.clear(); sectionIds.addAll(ids); staffIds.clear(); staffIds.addAll(sids)
                    section.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
                    staff.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, snames)
                    updateCategories(); status.text = "Authorized staff session ready."
                }
            } catch (e: Exception) { runOnUiThread { status.text = e.message ?: "Account is not authorized."; token = null; prefs().edit().remove("refresh").apply() } }
        }
    }
    private fun updateCategories() {
        val id = sectionIds.getOrNull(section.selectedItemPosition) ?: return
        val arr = sections.optJSONObject(id)?.optJSONArray("categories") ?: JSONArray()
        categoryIds.clear(); val names = mutableListOf<String>()
        for (i in 0 until arr.length()) { val row = arr.optJSONObject(i) ?: continue; categoryIds.add(row.optString("id")); names.add(row.optString("label")) }
        category.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
        section.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) {}
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { 
                val sid = sectionIds.getOrNull(position) ?: return
                val a = sections.optJSONObject(sid)?.optJSONArray("categories") ?: JSONArray()
                categoryIds.clear(); val labels = mutableListOf<String>()
                for (i in 0 until a.length()) { val row = a.optJSONObject(i) ?: continue; categoryIds.add(row.optString("id")); labels.add(row.optString("label")) }
                category.adapter = ArrayAdapter(this@AssistantActivity, android.R.layout.simple_spinner_dropdown_item, labels)
            }
        }
    }
    private fun submitEntry() {
        if (token == null) { status.text = "Sign in first."; return }
        val value = amount.text.toString().toDoubleOrNull()
        if (value == null || value <= 0 || description.text.toString().isBlank()) { status.text = "Enter a positive amount and description."; return }
        val credit = kind.selectedItemPosition == 3
        val body = JSONObject().put("action", "quick_add").put("requestId", UUID.randomUUID().toString())
            .put("kind", if (credit) "credit" else "ledger").put("date", date.text.toString().trim())
            .put("amount", value).put("description", description.text.toString().trim())
        if (credit) {
            val i = staff.selectedItemPosition
            if (i !in staffIds.indices) { status.text = "Choose an active staff member."; return }
            body.put("staffId", staffIds[i]).put("deduction", deduction.isChecked)
        } else {
            val sec = sectionIds.getOrNull(section.selectedItemPosition); val cat = categoryIds.getOrNull(category.selectedItemPosition)
            if (sec == null || cat == null) { status.text = "Choose a valid section and category."; return }
            body.put("ledgerType", sec).put("categoryId", cat)
        }
        status.text = "Submitting…"
        thread { try { val result = api(body); runOnUiThread { status.text = result.optString("message", "Entry saved."); amount.text.clear(); description.text.clear() } }
            catch (e: Exception) { runOnUiThread { status.text = e.message ?: "Entry was not confirmed; check the ledger before retrying." } } }
    }
    private fun askDua() {
        if (token == null) { answer.text = "Sign in first."; return }
        val q = question.text.toString().trim()
        if (q.isBlank()) { answer.text = "Type a question first."; return }
        answer.text = "Checking business records…"
        thread { try { val result = api(JSONObject().put("action", "ask_dua").put("question", q)); runOnUiThread { answer.text = result.optString("answer", "No answer returned.") } }
            catch (e: Exception) { runOnUiThread { answer.text = e.message ?: "Ask Dua is unavailable." } } }
    }
}
