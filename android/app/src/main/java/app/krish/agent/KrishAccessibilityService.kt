package app.krish.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Drives the user's own browser app (their logins are already there). Limited to browsers by krish_accessibility.xml.
 * Nothing here runs on its own: every call comes from the Krish app while the user has a task running.
 * Page elements are numbered per observation; a click or type is refused when the live node no longer matches what was approved.
 */
class KrishAccessibilityService : AccessibilityService() {

    private val main = Handler(Looper.getMainLooper())
    private var nodes: List<AccessibilityNodeInfo> = emptyList()
    private var browserPkg: String? = null
    private var pill: LinearLayout? = null
    private var pillText: TextView? = null
    private var pillAction: TextView? = null

    override fun onServiceConnected() {
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString()
        if (pkg != null && pkg in BROWSERS) browserPkg = pkg
    }

    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        hide()
        return super.onUnbind(intent)
    }

    // ---- finding and opening the browser ----

    private fun root(): AccessibilityNodeInfo? = rootInActiveWindow?.takeIf { it.packageName?.toString() in BROWSERS }

    private fun defaultBrowser(): String? {
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"))
        return packageManager.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.takeIf { it in BROWSERS }
    }

    private fun waitRoot(ms: Long): AccessibilityNodeInfo? {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            root()?.let { return it }
            Thread.sleep(150)
        }
        return null
    }

    /** The browser's window, brought to the front if the user (or Krish) is looking at another app. */
    private fun front(): AccessibilityNodeInfo {
        root()?.let { return it }
        val pkg = browserPkg ?: defaultBrowser() ?: throw IllegalStateException("your default browser is not supported; use Chrome, Firefox, Brave, Edge, Samsung Internet or Opera")
        val launch = packageManager.getLaunchIntentForPackage(pkg) ?: throw IllegalStateException("could not open your browser")
        startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        return waitRoot(5000) ?: throw IllegalStateException("your browser did not come to the front")
    }

    private fun urlText(r: AccessibilityNodeInfo): String {
        var found = ""
        walk(r) { n ->
            val id = n.viewIdResourceName.orEmpty()
            if (found.isEmpty() && URL_BAR.containsMatchIn(id)) found = n.text?.toString().orEmpty().trim().substringBefore(' ')
        }
        return if (found.isEmpty() || found.startsWith("http")) found else "https://$found"
    }

    /** Opens the page in the user's browser and waits until its address shows up (up to 10 s), plus a moment to render. */
    fun open(url: String) {
        val host = Uri.parse(url).host.orEmpty().removePrefix("www.")
        val pkg = browserPkg ?: defaultBrowser() ?: throw IllegalStateException("your default browser is not supported; use Chrome, Firefox, Brave, Edge, Samsung Internet or Opera")
        browserPkg = pkg
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val end = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < end) {
            val r = root()
            if (r != null && urlText(r).contains(host)) break
            Thread.sleep(300)
        }
        Thread.sleep(1500)
    }

    // ---- reading ----

    private fun walk(n: AccessibilityNodeInfo, depth: Int = 0, visit: (AccessibilityNodeInfo) -> Unit) {
        if (depth > 70) return
        visit(n)
        for (i in 0 until n.childCount) n.getChild(i)?.let { walk(it, depth + 1, visit) }
    }

    private fun labelOf(n: AccessibilityNodeInfo): String {
        val own = (if (n.isEditable) n.hintText else n.text) ?: n.contentDescription
        if (!own.isNullOrBlank()) return own.toString().trim()
        val sb = StringBuilder()
        for (i in 0 until n.childCount) {
            val c = n.getChild(i) ?: continue
            val t = c.text ?: c.contentDescription
            if (!t.isNullOrBlank()) sb.append(t).append(' ')
            if (sb.length > 80) break
        }
        return sb.toString().trim()
    }

    private fun fingerprint(n: AccessibilityNodeInfo) = Integer.toHexString("${n.className}|${labelOf(n).take(40)}|${n.isEditable}".hashCode())

    /** The page as `{url,title,text,elements}` for the agent. Browser toolbars (nodes with an app view id) are left out. */
    fun observe(): String {
        val r = front()
        val elements = JSONArray()
        val keep = ArrayList<AccessibilityNodeInfo>()
        val text = StringBuilder()
        walk(r) { n ->
            val chrome = n.viewIdResourceName?.contains(":id/") == true
            if (chrome || !n.isVisibleToUser) return@walk
            val interactive = n.isEditable || n.isClickable || n.isCheckable
            val label = labelOf(n)
            if (interactive && (label.isNotEmpty() || n.isEditable) && keep.size < MAX_ELEMENTS) {
                val e = JSONObject().put("id", keep.size).put("tag", if (n.isEditable) "input" else "button").put("fp", fingerprint(n))
                if (n.isEditable) {
                    e.put("type", if (n.isPassword) "password" else "text")
                    if (label.isNotEmpty()) e.put("label", label).put("placeholder", label)
                    if (!n.isPassword && !n.isShowingHintText) n.text?.toString()?.let { e.put("value", it.take(200)) }
                } else {
                    e.put("text", label.take(120))
                    if (n.isCheckable) e.put("role", "checkbox")
                }
                if (!n.isEnabled) e.put("disabled", true)
                elements.put(e)
                keep.add(n)
            } else if (!interactive && text.length < MAX_TEXT) {
                n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { text.append(it).append(' ') }
            }
        }
        nodes = keep
        return JSONObject().put("url", urlText(r)).put("title", r.window?.title?.toString().orEmpty()).put("text", text.toString()).put("elements", elements).toString()
    }

    fun readPage(id: Int?): String {
        if (id == null) return JSONObject(observe()).getString("text")
        return labelOf(live(id, null))
    }

    // ---- acting ----

    /** The node for an observed id, refreshed, and refused if it is not the element that was approved. */
    private fun live(id: Int, fp: String?): AccessibilityNodeInfo {
        front() // the sign-in card or a question may have put Krish in front since the page was read
        val n = nodes.getOrNull(id) ?: throw IllegalStateException("no element $id; read the page again")
        if (!n.refresh()) throw IllegalStateException("element $id is gone; read the page again")
        if (fp != null && fp != fingerprint(n)) throw IllegalStateException("element $id changed; read the page again")
        return n
    }

    private fun tapAt(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 60)).build()
        return dispatchGesture(gesture, null, null)
    }

    fun click(id: Int, fp: String?) {
        val n = live(id, fp)
        var c: AccessibilityNodeInfo? = n
        var hops = 0
        while (c != null && hops < 4) {
            if (c.isClickable && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return
            c = c.parent
            hops++
        }
        val r = Rect().also { n.getBoundsInScreen(it) }
        if (!tapAt(r.exactCenterX(), r.exactCenterY())) throw IllegalStateException("could not tap element $id")
    }

    /** Types into a field. The text is only passed through to the page; it is not logged or returned. */
    fun setText(id: Int, fp: String?, value: String, submit: Boolean) {
        val n = live(id, fp)
        n.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        n.performAction(AccessibilityNodeInfo.ACTION_CLICK) // Chrome only accepts text in a field that has been tapped
        n.refresh()
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }
        if (!n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) throw IllegalStateException("could not type into the field")
        if (submit && Build.VERSION.SDK_INT >= 30) n.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    fun scroll(down: Boolean) {
        val r = front()
        val scrollables = ArrayList<AccessibilityNodeInfo>()
        walk(r) { if (it.isScrollable && it.viewIdResourceName?.contains(":id/") != true) scrollables.add(it) }
        val area = { n: AccessibilityNodeInfo -> Rect().also { n.getBoundsInScreen(it) }.let { it.width() * it.height() } }
        val best = scrollables.maxByOrNull(area)
        val action = if (down) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        if (best != null && best.performAction(action)) return
        val m = resources.displayMetrics
        val from = if (down) 0.7f else 0.3f
        val to = if (down) 0.3f else 0.7f
        val path = Path().apply { moveTo(m.widthPixels / 2f, m.heightPixels * from); lineTo(m.widthPixels / 2f, m.heightPixels * to) }
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 300)).build(), null, null)
        Thread.sleep(400)
    }

    // ---- the status pill over the browser ----

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun chip(label: String, onTap: () -> Unit) = TextView(this).apply {
        text = label
        setTextColor(Color.WHITE)
        textSize = 14f
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.parseColor("#3A3A3C")) }
        setOnClickListener { onTap() }
    }

    /** One line about what Krish is doing, a Stop button, and (when the user is needed) "Resume" or "Open Krish". */
    fun say(text: String, action: String?) {
        if (appForeground) return // never draw over the Krish app itself
        main.post {
            val wm = getSystemService(WINDOW_SERVICE) as WindowManager
            if (pill == null) {
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(16), dp(8), dp(8), dp(8))
                    background = GradientDrawable().apply { cornerRadius = dp(28).toFloat(); setColor(Color.parseColor("#E61D1D1F")) }
                }
                val label = TextView(this).apply {
                    setTextColor(Color.WHITE)
                    textSize = 14f
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                }
                row.addView(label, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                val act = chip("") {}
                act.visibility = android.view.View.GONE
                row.addView(act, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
                row.addView(chip("Stop") { onAction?.invoke("stop") }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
                val lp = WindowManager.LayoutParams(
                    (resources.displayMetrics.widthPixels * 0.92f).toInt(), WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                    PixelFormat.TRANSLUCENT,
                ).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; y = dp(84) }
                wm.addView(row, lp)
                pill = row
                pillText = label
                pillAction = act
            }
            pillText?.text = text
            pillAction?.apply {
                visibility = if (action == null) android.view.View.GONE else android.view.View.VISIBLE
                this.text = if (action == "resume") "Resume" else "Open Krish"
                tag = action
                setOnClickListener { onAction?.invoke(if (action == "resume") "resume" else "open") }
            }
        }
    }

    fun hide() {
        main.post {
            pill?.let { runCatching { (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(it) } }
            pill = null
            pillText = null
            pillAction = null
        }
    }

    /** Brings the Krish app to the front (for a question, sign-in card or code). Android may refuse this from the background; the pill's "Open Krish" button is the fallback and is hidden once the app is shown. */
    fun focusApp() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    companion object {
        @Volatile var instance: KrishAccessibilityService? = null
        @Volatile var appForeground = false
        /** "stop", "resume" or "open": what the user tapped on the pill. */
        @Volatile var onAction: ((String) -> Unit)? = null

        private const val MAX_ELEMENTS = 120
        private const val MAX_TEXT = 12_000
        private val URL_BAR = Regex("(url_bar|url_field|location_bar_edit_text|mozac_browser_toolbar_url_view|toolbar_url)$")
        private val BROWSERS = setOf(
            "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary", "org.mozilla.firefox", "org.mozilla.firefox_beta",
            "org.mozilla.fenix", "com.brave.browser", "com.microsoft.emmx", "com.sec.android.app.sbrowser", "com.opera.browser",
            "com.opera.mini.native", "com.vivaldi.browser", "com.kiwibrowser.browser", "com.duckduckgo.mobile.android",
        )
    }
}
