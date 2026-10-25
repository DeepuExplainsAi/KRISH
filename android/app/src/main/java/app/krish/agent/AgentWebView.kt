package app.krish.agent

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.net.http.SslError
import android.util.Base64
import android.view.MotionEvent
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream

/**
 * The agent's browser. Hardened per SECURITY.md:
 *  - no addJavascriptInterface (native calls evaluateJavascript and reads results back)
 *  - file/content access off, https only, Safe Browsing on, all permission prompts denied
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class AgentWebView(context: Context, private val pageScript: String, private val listener: Listener) : WebView(context) {

    interface Listener {
        fun onPage(url: String, title: String, loading: Boolean)
        /** Page asked for a file chooser. Return the user-selected Uri, or null to cancel. */
        fun takePendingUpload(): Uri?
    }

    /** When false, touches fall through to the app UI underneath (hidden / snapshot mode). */
    var interactive = true
    private var desktopLayout = false
    private val defaultUserAgent: String

    init {
        with(settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            disableFileUrlAccess(this)
            safeBrowsingEnabled = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
            builtInZoomControls = true
            displayZoomControls = false
        }
        defaultUserAgent = settings.userAgentString
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        webViewClient = Client()
        webChromeClient = Chrome()
    }

    @Suppress("DEPRECATION")
    private fun disableFileUrlAccess(s: android.webkit.WebSettings) {
        s.allowFileAccessFromFileURLs = false
        s.allowUniversalAccessFromFileURLs = false
    }

    private inner class Client : WebViewClient() {
        // Only https may load. Everything else (http, intent:, file:, data:, javascript:) is refused.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.url.scheme != "https"

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) =
            listener.onPage(url, view.title.orEmpty(), true)

        override fun onPageFinished(view: WebView, url: String) {
            if (desktopLayout) view.evaluateJavascript(DESKTOP_VIEWPORT_JS, null)
            listener.onPage(url, view.title.orEmpty(), false)
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) = handler.cancel()
    }

    private inner class Chrome : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: android.webkit.GeolocationPermissions.Callback) =
            callback.invoke(origin, false, false)

        override fun onShowFileChooser(
            webView: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            // The chooser only ever answers with a file the user picked in the system picker for this task.
            val uri = listener.takePendingUpload()
            callback.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            return true
        }
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean = interactive && super.dispatchTouchEvent(ev)

    fun setDesktopLayout(enabled: Boolean) {
        desktopLayout = enabled
        settings.userAgentString = if (enabled) DESKTOP_UA else defaultUserAgent
        settings.useWideViewPort = enabled
        settings.loadWithOverviewMode = enabled
        if (url != null) reload()
    }

    /**
     * Runs `expr` against the injected page API and returns its string result.
     * The page script is evaluated fresh on every call into a local `K`, so the page cannot spoof the API.
     */
    fun call(expr: String, onResult: (Result<String>) -> Unit) {
        val js = "(function(){try{var K=$pageScript\n;return JSON.stringify({ok:true,v:$expr});}catch(e){return JSON.stringify({ok:false,e:String(e&&e.message||e)});}})()"
        evaluateJavascript(js) { raw ->
            try {
                val outer = JSONTokener(raw).nextValue() as? String ?: throw IllegalStateException("no result")
                val obj = JSONObject(outer)
                if (obj.getBoolean("ok")) onResult(Result.success(obj.opt("v")?.toString().orEmpty()))
                else onResult(Result.failure(IllegalStateException(obj.optString("e", "page error"))))
            } catch (e: Exception) {
                onResult(Result.failure(e))
            }
        }
    }

    /** JPEG data URL of the current view, scaled to maxWidth. May be null if the view has no size yet. */
    fun snapshot(maxWidth: Int, quality: Int): String? {
        if (width == 0 || height == 0) return null
        val scale = minOf(1f, maxWidth.toFloat() / width)
        val bmp = Bitmap.createBitmap((width * scale).toInt().coerceAtLeast(1), (height * scale).toInt().coerceAtLeast(1), Bitmap.Config.RGB_565)
        draw(Canvas(bmp).apply { scale(scale, scale) })
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
        bmp.recycle()
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** Real touch at CSS-pixel coordinates; gives pages a genuine user gesture (file choosers need one). */
    fun tapCss(x: Double, y: Double, innerWidth: Double) {
        val ratio = if (innerWidth > 0) width / innerWidth else resources.displayMetrics.density.toDouble()
        val px = (x * ratio).toFloat()
        val py = (y * ratio).toFloat()
        val t = android.os.SystemClock.uptimeMillis()
        for ((action, at) in listOf(MotionEvent.ACTION_DOWN to t, MotionEvent.ACTION_UP to t + 60)) {
            val e = MotionEvent.obtain(t, at, action, px, py, 0)
            super.dispatchTouchEvent(e)
            e.recycle()
        }
    }

    fun clearSiteData() {
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
        clearCache(true)
        clearHistory()
        clearFormData()
        @Suppress("DEPRECATION") android.webkit.WebViewDatabase.getInstance(context).clearHttpAuthUsernamePassword()
    }

    companion object {
        const val DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        private const val DESKTOP_VIEWPORT_JS =
            "(function(){var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}m.content='width=1280';})()"
    }
}
