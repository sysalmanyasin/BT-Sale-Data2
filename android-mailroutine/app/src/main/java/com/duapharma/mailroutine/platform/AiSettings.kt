package com.duapharma.mailroutine.platform

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.duapharma.mailroutine.ai.AiProvider

/**
 * Optional AI keys (one per provider) live only in Keystore-backed encrypted preferences and are never exported in backups.
 * The Anthropic key keeps its original preference names so existing installs keep working after the update.
 */
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

    fun keyFor(p: AiProvider): String? = prefs?.getString(keyName(p), null)?.takeIf { it.isNotBlank() }

    fun setKey(p: AiProvider, value: String?) {
        prefs?.edit()?.apply { if (value.isNullOrBlank()) remove(keyName(p)) else putString(keyName(p), value.trim()) }?.apply()
    }

    fun modelFor(p: AiProvider): String =
        prefs?.getString(modelName(p), null)?.takeIf { it.isNotBlank() && it !in p.retiredModels } ?: p.defaultModel

    fun setModel(p: AiProvider, value: String) {
        prefs?.edit()?.putString(modelName(p), value.trim().ifBlank { p.defaultModel })?.apply()
    }

    /** The provider used for every AI request. */
    var provider: AiProvider
        get() = AiProvider.fromName(prefs?.getString("provider", null))
            ?: AiProvider.initial(hasGroqKey = keyFor(AiProvider.GROQ) != null, hasAnthropicKey = keyFor(AiProvider.ANTHROPIC) != null)
        set(v) { prefs?.edit()?.putString("provider", v.name)?.apply() }

    private fun keyName(p: AiProvider) = when (p) { AiProvider.ANTHROPIC -> "api_key"; AiProvider.GROQ -> "groq_api_key" }
    private fun modelName(p: AiProvider) = when (p) { AiProvider.ANTHROPIC -> "model"; AiProvider.GROQ -> "groq_model" }
}
