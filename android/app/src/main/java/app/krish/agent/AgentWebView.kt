package app.krish.agent

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Outline
import android.net.Uri
import android.net.http.SslError
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
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
        fun takePendingUpload(origin: String): Uri?
    }

    /** When false, touches fall through to the app UI underneath (hidden / snapshot mode). */
    var interactive = true
    /** PC layout: the page is laid out 1024-1280 CSS px wide (a real desktop width, see layoutWidth) and the view is scaled down to the card, so nothing is cut off. */
    var desktopLayout = false
        private set
    private val defaultUserAgent: String
    /** The same Chrome as this phone's WebView, but as a Linux PC: the version stays current by itself. */
    private val desktopUserAgent: String

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
        // A plain Chrome-for-Android identity: the "; wv" and "Version/x" marks of an embedded WebView make some sign-in pages (Instagram, others) refuse a correct password.
        defaultUserAgent = settings.userAgentString.replace("; wv", "").replace(Regex(" Version/[\\d.]+"), "")
        desktopUserAgent = defaultUserAgent.replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)").replace(" Mobile", "")
        settings.userAgentString = defaultUserAgent
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

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            PickedFiles.disarm() // any navigation cancels a pending upload authorization
            listener.onPage(url, view.title.orEmpty(), true)
        }

        override fun onPageFinished(view: WebView, url: String) {
            CookieManager.getInstance().flush() // write logins to disk now; otherwise they can be lost if the app is killed soon after
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
            val u = android.net.Uri.parse(webView.url.orEmpty())
            val uri = listener.takePendingUpload("${u.scheme}://${u.authority}")
            callback.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            return true
        }
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean = interactive && super.dispatchTouchEvent(ev)

    fun setDesktopLayout(enabled: Boolean) {
        if (desktopLayout == enabled) return
        desktopLayout = enabled
        settings.userAgentString = if (enabled) desktopUserAgent else defaultUserAgent
        if (url != null) reload()
    }

    /**
     * Puts the view over the card: x/y/w/h are the card in CSS px of the app UI. In PC layout the view itself is 1024-1280 CSS px wide
     * and as tall as the card needs at that width, then scaled down from its top-left corner to exactly fill the card. The page
     * lays out as on a PC (no viewport tricks, nothing cut off); touches are mapped back by Android.
     */
    fun place(x: Double, y: Double, w: Double, h: Double, radius: Double, left0: Int, top0: Int) {
        val d = resources.displayMetrics.density
        val scale = if (desktopLayout) minOf(1.0, w / layoutWidth(w)) else 1.0
        layoutParams = FrameLayout.LayoutParams((w / scale * d).toInt().coerceAtLeast(1), (h / scale * d).toInt().coerceAtLeast(1), Gravity.TOP or Gravity.START).apply {
            leftMargin = left0 + (x * d).toInt()
            topMargin = top0 + (y * d).toInt()
        }
        pivotX = 0f
        pivotY = 0f
        scaleX = scale.toFloat()
        scaleY = scale.toFloat()
        clipToOutline = radius > 0
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) = outline.setRoundRect(0, 0, view.width, view.height, (radius * d / scale).toFloat())
        }
        invalidateOutline()
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
        /** Width (CSS px) the page is laid out at in PC layout: 1024 in a narrow card (phone: bigger text, still a PC page), 1280 in a wide one. Keep in sync with desktop/lib.cjs `layoutWidth`. */
        fun layoutWidth(cardWidth: Double) = if (cardWidth < 700.0) 1024.0 else 1280.0
    }
}
