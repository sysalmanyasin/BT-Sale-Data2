package com.duapharma.mailroutine.platform

import android.content.Context
import android.content.Intent
import com.duapharma.mailroutine.gmail.TransportException
import com.duapharma.mailroutine.gmail.UrlConnectionTransport
import com.duapharma.mailroutine.send.AuthProvider
import com.duapharma.mailroutine.send.TokenResult
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.URLEncoder

enum class AccountStatus { NOT_CONNECTED, CONNECTED, NEEDS_REAUTH }

data class AccountState(val status: AccountStatus, val email: String?)

/**
 * Gmail access via Google Identity Services. Only the `gmail.send` scope is requested (send-only; it
 * cannot read mail). Access tokens are short-lived and fetched on demand from Google Play services,
 * which holds the grant — the app never sees, stores or logs a refresh token or password.
 * SharedPreferences hold only the connection flag and the account's address (not a credential).
 */
class GoogleAuthProvider(private val context: Context) : AuthProvider {
    private val prefs = context.getSharedPreferences("mailroutine_account", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(load())
    val state: StateFlow<AccountState> = _state

    private fun load(): AccountState {
        val email = prefs.getString("email", null)
        val status = when {
            !prefs.getBoolean("connected", false) -> AccountStatus.NOT_CONNECTED
            prefs.getBoolean("needs_reauth", false) -> AccountStatus.NEEDS_REAUTH
            else -> AccountStatus.CONNECTED
        }
        return AccountState(status, email)
    }

    private fun save(connected: Boolean, needsReauth: Boolean, email: String?) {
        prefs.edit().putBoolean("connected", connected).putBoolean("needs_reauth", needsReauth).putString("email", email).apply()
        _state.value = load()
    }

    private fun request() = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(GMAIL_SEND_SCOPE))).build()
    private val client get() = Identity.getAuthorizationClient(context)

    /** Background-safe: never shows UI. */
    override suspend fun acquire(): TokenResult {
        if (_state.value.status == AccountStatus.NOT_CONNECTED) return TokenResult.NotConnected
        return try {
            val res = client.authorize(request()).await()
            val token = res.accessToken
            if (res.hasResolution() || token.isNullOrBlank()) {
                save(true, true, _state.value.email); TokenResult.NeedsReauth
            } else {
                if (_state.value.status == AccountStatus.NEEDS_REAUTH) save(true, false, _state.value.email)
                TokenResult.Token(token)
            }
        } catch (e: ApiException) {
            if (e.statusCode in TRANSIENT) TokenResult.Unavailable
            else { save(true, true, _state.value.email); TokenResult.NeedsReauth }
        } catch (e: IOException) {
            TokenResult.Unavailable
        }
    }

    /** Foreground step 1: may return a PendingIntent the UI must launch for user consent. */
    suspend fun beginAuthorization(): AuthorizationResult = client.authorize(request()).await()

    /** Foreground step 2: parse the consent result returned by the launched intent. */
    fun resultFromIntent(data: Intent?): AuthorizationResult = client.getAuthorizationResultFromIntent(data)

    fun completeConnection(result: AuthorizationResult) {
        save(true, false, result.toGoogleSignInAccount()?.email ?: _state.value.email)
    }

    /** Best-effort revoke at Google, then forget the account locally. */
    suspend fun disconnect() {
        withContext(Dispatchers.IO) {
            try {
                val token = client.authorize(request()).await().takeIf { !it.hasResolution() }?.accessToken
                if (!token.isNullOrBlank()) {
                    UrlConnectionTransport().post(
                        "https://oauth2.googleapis.com/revoke",
                        mapOf("Content-Type" to "application/x-www-form-urlencoded"),
                        ("token=" + URLEncoder.encode(token, "UTF-8")).toByteArray(),
                    )
                }
            } catch (e: Exception) { /* offline or already revoked: still disconnect locally */ }
        }
        save(false, false, null)
    }

    companion object {
        const val GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
        private val TRANSIENT = setOf(CommonStatusCodes.NETWORK_ERROR, CommonStatusCodes.TIMEOUT, CommonStatusCodes.INTERNAL_ERROR, CommonStatusCodes.INTERRUPTED)
    }
}
