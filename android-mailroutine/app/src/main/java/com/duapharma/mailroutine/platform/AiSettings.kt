package com.duapharma.mailroutine.platform

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The optional AI key lives only in Keystore-backed encrypted preferences and is never exported in backups. */
class AiSettings(context: Context) {
    private val prefs = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "mailroutine_ai", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) { null } // secure storage unavailable -> AI stays disabled rather than falling back to plaintext

    val storageAvailable: Boolean get() = prefs != null
    var apiKey: String?
        get() = prefs?.getString("api_key", null)?.takeIf { it.isNotBlank() }
        set(v) { prefs?.edit()?.apply { if (v.isNullOrBlank()) remove("api_key") else putString("api_key", v.trim()) }?.apply() }
    var model: String
        get() = prefs?.getString("model", null) ?: DEFAULT_MODEL
        set(v) { prefs?.edit()?.putString("model", v.trim().ifBlank { DEFAULT_MODEL })?.apply() }

    companion object { const val DEFAULT_MODEL = "claude-sonnet-5-5" }
}
