package com.duapharma.btsales

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * A thin native shell around the BT Sales PWA (BuildConfig.APP_URL). The
 * front end itself — auth, storage, sync, everything — is unchanged; this
 * activity's only job is to host it in a WebView, forward file/download/
 * popup intents to the platform, and keep normal Android back-button and
 * pull-to-refresh behavior.
 *
 * Google Sign-In: Google's OAuth endpoints reject sign-in attempts from
 * generic embedded WebViews ("disallowed_useragent"), which is what the
 * site's Google Sign-In button uses (see js/auth.js's full-page redirect
 * to accounts.google.com). Rather than disguise the WebView to slip past
 * that check — which is exactly the kind of thing Google's detection
 * exists to stop, and is a use-at-your-own-risk hack — navigation to
 * accounts.google.com is handed off to a Chrome Custom Tab instead (see
 * shouldOverrideUrlLoading below). When sign-in finishes there, Google
 * redirects back to https://bt.duapharma.com/... exactly as it would in
 * a normal browser; an Android App Link (registered via the
 * autoVerify intent-filter in AndroidManifest.xml + the repo's
 * /.well-known/assetlinks.json) routes that URL back into this activity
 * instead of leaving it open in Chrome, and onNewIntent/onCreate load it
 * into the WebView so js/auth.js's existing redirect-token handler picks
 * it up unchanged. If App Link verification hasn't completed yet on a
 * given device (it can take a short time after install, and requires
 * assetlinks.json's fingerprint to match the APK's actual signing key —
 * see the README), the flow still degrades safely: sign-in simply
 * finishes in Chrome instead of hopping back into the app, rather than
 * failing outright.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            val results: Array<Uri>? = when {
                result.resultCode != RESULT_OK -> null
                data?.clipData != null -> {
                    val clip = data.clipData!!
                    Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
                }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
            filePathCallback?.onReceiveValue(results)
            filePathCallback = null
        }

    private fun openInCustomTab(uri: Uri) {
        CustomTabsIntent.Builder().build().launchUrl(this, uri)
    }

    // Where a URL requested from a WebView (direct navigation or a
    // window.open() popup) is allowed to go. Shared by the main
    // WebViewClient and the popup WebViewClient in onCreateWindow so
    // the allowlist can't be bypassed by going through a popup, and so
    // the two never drift out of sync.
    private sealed class UrlRoute {
        object InApp : UrlRoute()
        object GoogleAuth : UrlRoute()
        object External : UrlRoute()
    }

    private fun classifyUrl(url: Uri): UrlRoute {
        val host = url.host
            // No host (e.g. a relative or malformed URI): treat like an
            // in-app URL, same as the original null-host handling.
            ?: return UrlRoute.InApp
        return when {
            // The PWA's own domain and its Supabase backend stay
            // inside this WebView.
            host == APP_HOST || host.endsWith(".duapharma.com") ||
                host.endsWith("supabase.co") -> UrlRoute.InApp

            // Google's sign-in pages: see class doc.
            host == "accounts.google.com" || host.endsWith(".accounts.google.com") -> UrlRoute.GoogleAuth

            else -> UrlRoute.External
        }
    }

    // App Link redirect back from the Custom Tab (see class doc): a
    // bt.duapharma.com URL carrying Google's auth result. Hand it straight
    // to the WebView — js/auth.js's redirect-token handler reads it off
    // window.location.hash on load exactly as it would in a browser tab.
    private fun handleAppLinkIntent(intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (intent.action != Intent.ACTION_VIEW || data.host != APP_HOST) return false
        webView.loadUrl(data.toString())
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAppLinkIntent(intent)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean = when (classifyUrl(request.url)) {
                // Stays inside this WebView: don't override, let it load normally.
                UrlRoute.InApp -> false

                // Google's sign-in pages: see class doc. Handed to a
                // Custom Tab, which Google's OAuth accepts (it's a
                // real Chrome context, not an embedded WebView).
                UrlRoute.GoogleAuth -> {
                    openInCustomTab(request.url)
                    true
                }

                // Anything else (external links the app opens) to a
                // real browser.
                UrlRoute.External -> {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                swipeRefresh.isRefreshing = false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            // <input type="file"> (e.g. attachment/photo uploads).
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = params.createIntent().apply {
                    if (resolveActivity(packageManager) == null) {
                        action = Intent.ACTION_GET_CONTENT
                        type = "*/*"
                    }
                }
                fileChooserLauncher.launch(intent)
                return true
            }

            // window.open()/target="_blank" (Google's GIS token popup and
            // similar). Route the popup's navigation back into this same
            // WebView instead of losing it to a headless second WebView.
            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message
            ): Boolean {
                val transport = resultMsg.obj as WebView.WebViewTransport
                val popup = WebView(this@MainActivity)
                popup.webViewClient = object : WebViewClient() {
                    // Same allowlist as the main WebViewClient above — a
                    // popup must not be able to redirect the app into an
                    // arbitrary host just because it arrived via
                    // window.open() instead of a direct navigation.
                    override fun shouldOverrideUrlLoading(
                        v: WebView,
                        request: WebResourceRequest
                    ): Boolean {
                        when (classifyUrl(request.url)) {
                            UrlRoute.InApp -> webView.loadUrl(request.url.toString())
                            UrlRoute.GoogleAuth -> openInCustomTab(request.url)
                            UrlRoute.External -> startActivity(Intent(Intent.ACTION_VIEW, request.url))
                        }
                        return true
                    }
                }
                transport.webView = popup
                resultMsg.sendToTarget()
                return true
            }
        }

        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                    setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        Uri.parse(url).lastPathSegment ?: "download"
                    )
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                }
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "Downloading…", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Download failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        })

        swipeRefresh.setOnRefreshListener { webView.reload() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState == null && !handleAppLinkIntent(intent)) {
            webView.loadUrl(BuildConfig.APP_URL)
        }
    }

    override fun onDestroy() {
        (webView.parent as? FrameLayout)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private val APP_HOST: String = Uri.parse(BuildConfig.APP_URL).host ?: ""
    }
}
