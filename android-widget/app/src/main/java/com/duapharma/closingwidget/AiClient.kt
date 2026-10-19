package com.duapharma.closingwidget

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Calls the public inventory-chat and medicine-ai-info Edge Functions (same ones the Inventory Search PWA uses). */
object AiClient {

    private fun post(function: String, body: JSONObject): JSONObject {
        var c: HttpURLConnection? = null
        try {
            c = URL(BuildConfig.SUPABASE_URL + "/functions/v1/" + function).openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 15_000
            c.readTimeout = 45_000
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            c.setRequestProperty("Authorization", "Bearer " + BuildConfig.SUPABASE_ANON_KEY)
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (c.responseCode !in 200..299) throw Exception(json.optString("error", "HTTP ${c.responseCode}"))
            return json
        } finally {
            c?.disconnect()
        }
    }

    fun medicineInfo(name: String, generic: String, company: String, force: Boolean): String {
        val r = post("medicine-ai-info", JSONObject().apply {
            put("name", name); put("generic", generic); put("company", company); put("force", force)
        })
        return r.optString("info", "").ifEmpty { throw Exception("Empty answer") }
    }

    /** history: list of (role, content) pairs, role = "user" | "assistant". */
    fun chat(history: List<Pair<String, String>>, context: JSONObject): String {
        val msgs = JSONArray()
        history.forEach { (role, content) -> msgs.put(JSONObject().put("role", role).put("content", content)) }
        val r = post("inventory-chat", JSONObject().apply { put("messages", msgs); put("context", context) })
        return r.optString("reply", "").ifEmpty { throw Exception("Empty answer") }
    }
}
