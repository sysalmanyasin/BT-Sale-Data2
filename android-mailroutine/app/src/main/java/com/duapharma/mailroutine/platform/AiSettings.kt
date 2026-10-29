package com.duapharma.mailroutine.platform

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.duapharma.mailroutine.ai.AiProvider

/**
 * Optional provider keys and model preferences are stored only in Keystore-backed encrypted
 * preferences. They are never included in app backups. If secure storage is unavailable, AI is disabled.
 */
class AiSettings(context: Context) {
    private val prefs = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "mailroutine_ai", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) { null }

    val storageAvailable: Boolean get() = prefs != null

    var provider: AiProvider
        get() = runCatching { AiProvider.valueOf(prefs?.getString("provider", null) ?: AiProvider.GROQ.name) }
            .getOrDefault(AiProvider.GROQ)
        set(value) { prefs?.edit()?.putString("provider", value.name)?.apply() }

    fun apiKey(provider: AiProvider): String? {
        val key = prefs?.getString(provider.keyPreference, null)?.takeIf { it.isNotBlank() }
        if (key != null) return key
        // Preserve keys from versions before provider selection was introduced.
        if (provider == AiProvider.ANTHROPIC) return prefs?.getString("api_key", null)?.takeIf { it.isNotBlank() }
        return null
    }

    fun setApiKey(provider: AiProvider, value: String?) {
        prefs?.edit()?.apply {
            if (value.isNullOrBlank()) {
                remove(provider.keyPreference)
                if (provider == AiProvider.ANTHROPIC) remove("api_key")
            } else {
                putString(provider.keyPreference, value.trim())
            }
        }?.apply()
    }

    fun modelFor(provider: AiProvider): String {
        val stored = prefs?.getString(provider.modelPreference, null)?.takeIf { it.isNotBlank() }
        if (stored != null) return stored
        // Older versions stored the Anthropic model in the generic "model" preference.
        if (provider == AiProvider.ANTHROPIC) {
            prefs?.getString("model", null)?.takeIf { it.isNotBlank() }?.let { return it }
        }
        return provider.defaultModel
    }

    fun setModel(provider: AiProvider, value: String) {
        prefs?.edit()?.putString(provider.modelPreference, value.trim().ifBlank { provider.defaultModel })?.apply()
    }
}
