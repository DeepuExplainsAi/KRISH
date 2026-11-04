package app.krish.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.os.Bundle
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.Display
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Reads and acts on screens of the apps the user allowed, nothing else (SECURITY.md, "Phone control").
 *
 * Layers, outermost first:
 *  1. accessibility_service_config.xml + [applyAllowlist]: the system only delivers events from allowed packages.
 *  2. [guard]: on every window change the foreground package is checked against PackagePolicy; a foreign app pauses the task
 *     and nothing from that window is read.
 *  3. [readScreen] / [perform]: re-check the package right before each use. Password nodes never contribute text. FLAG_SECURE and blank
 *     screenshots stop the task. The raw result goes to the TypeScript gate (sanitizeScreen) before any model sees it.
 *  4. The task ends if the phone locks, the screen turns off, or a volume key is pressed.
 */
class AgentAccessibilityService : AccessibilityService() {
    private val session get() = PhoneRuntime.session(this)
    private val io = Executors.newSingleThreadExecutor()
    private var lastPkg: String? = null
    private var unlisten: (() -> Unit)? = null
    private lateinit var overlay: SafetyOverlay

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF && session.snapshot.state != PhoneSession.State.IDLE) session.stop("phone_locked")
        }
    }

    override fun onServiceConnected() {
        instance = this
        overlay = SafetyOverlay(this)
        // Stop button is visible whenever a task is running or paused, and gone the moment it ends. A task's end also drops any open question.
        unlisten = session.listen { s ->
            applyAllowlist()
            if (s.state == PhoneSession.State.IDLE) overlay.destroy() else overlay.showStop { session.stop("user_stop") }
        }
        applyAllowlist()
        // Locking turns the screen off, so SCREEN_OFF is the lock signal (unlock must not stop anything).
        registerReceiver(screenReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
    }

    /** Narrows the system-level package filter to the user's allowlist. An empty allowlist listens to nobody but Krish itself. */
    fun applyAllowlist() {
        val info = serviceInfo ?: return
        info.packageNames = (session.allowlist + packageName).toTypedArray()
        serviceInfo = info
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        // Only the package name is looked at here; the window's content is never read from an event.
        if (pkg == lastPkg) return
        lastPkg = pkg
        if (pkg != packageName) guard(pkg)
    }

    /** Window-change check: pauses a running task when the foreground app is not allowed. Never touches the window's content. */
    private fun guard(pkg: String?) {
        if (!session.running) return
        if (isLocked()) { session.stop("phone_locked"); return }
        val v = session.check(pkg)
        if (v is PackagePolicy.Verdict.Block) session.pause("app_not_allowed:${v.reason}")
    }

    /** True only while a task is RUNNING and `pkg` is allowed. Idle or paused: nothing may be read or touched, whatever app is in front. */
    private fun permitted(pkg: String?): Boolean {
        guard(pkg)
        return session.running && session.check(pkg) is PackagePolicy.Verdict.Allow
    }

    private fun refusal() = session.snapshot.reason ?: if (session.snapshot.state == PhoneSession.State.PAUSED) "paused" else "no_task_running"

    private fun isLocked() = (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked

    /** Volume keys stop the task. The keys are consumed only while a task runs, so normal volume control is untouched otherwise. */
    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (!session.running && session.snapshot.state != PhoneSession.State.PAUSED) return false
        if (event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN && event.keyCode != KeyEvent.KEYCODE_VOLUME_UP) return false
        if (event.action == KeyEvent.ACTION_DOWN) session.stop("volume_key")
        return true
    }

    /** Popup over the current app. Calls back `false` on Deny, timeout, a task that ended, or while another question is open. */
    fun confirm(title: String, detail: String, callback: (Boolean) -> Unit) {
        if (!session.running) return callback(false)
        overlay.confirm(title, detail, callback)
    }

    /**
     * One screen as JSON for the TypeScript gate: `{pkg, secure, url?, nodes:[{id,cls,text,desc,hint,password,editable,clickable}]}`.
     * Returns `{blocked:true,reason}` without reading anything when the package is not allowed.
     */
    fun readScreen(withScreenshot: Boolean, done: (JSONObject) -> Unit) {
        clearHandles()
        val root = rootInActiveWindow
        val pkg = root?.packageName?.toString()
        if (!permitted(pkg)) { root?.recycle(); return done(JSONObject().put("blocked", true).put("reason", refusal())) }
        root ?: return done(JSONObject().put("blocked", true).put("reason", "no_window"))
        val nodes = JSONArray()
        collect(root, nodes, 0)
        val out = JSONObject().put("pkg", pkg).put("nodes", nodes)
        pkg?.let { ScreenChecks.urlBarId(it) }?.let { id -> root.findAccessibilityNodeInfosByViewId(id).firstOrNull()?.text?.toString()?.let { out.put("url", it) } }
        // A FLAG_SECURE window is not capturable; Android reports it through the window flag when we can see it, else the screenshot is blank.
        if (!withScreenshot) return done(out)
        takeScreenshot(Display.DEFAULT_DISPLAY, io, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                val bmp = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false)
                result.hardwareBuffer.close()
                val blank = bmp == null || ScreenChecks.isBlank(bmp.width, bmp.height) { x, y -> bmp.getPixel(x, y) }
                bmp?.recycle()
                // The pixels are discarded here on purpose: only "was it blank" leaves this function. Saving screenshots for the log is a later,
                // separate step that must go through the same package re-check.
                done(out.put("screenshot", JSONObject().put("blank", blank)))
            }
            override fun onFailure(errorCode: Int) = done(out.put("screenshot", JSONObject().put("blank", true)))
        })
    }

    private fun collect(n: AccessibilityNodeInfo, out: JSONArray, depth: Int) {
        if (depth > MAX_DEPTH || out.length() >= MAX_NODES) return
        if (n.isVisibleToUser) {
            val secret = ScreenChecks.isSecretInput(n.isPassword, n.inputType)
            out.put(
                JSONObject()
                    .put("id", out.length())
                    .put("cls", n.className?.toString()?.substringAfterLast('.'))
                    // A secret field contributes NO text, content description or hint.
                    .put("text", if (secret) "" else n.text?.toString().orEmpty().take(MAX_TEXT))
                    .put("desc", if (secret) "" else n.contentDescription?.toString().orEmpty().take(MAX_TEXT))
                    .put("hint", if (secret) "" else n.hintText?.toString().orEmpty().take(MAX_TEXT))
                    .put("password", secret)
                    .put("editable", n.isEditable)
                    .put("clickable", n.isClickable),
            )
            handles[out.length() - 1] = n.let { AccessibilityNodeInfo.obtain(it) }
        }
        for (i in 0 until n.childCount) n.getChild(i)?.let { collect(it, out, depth + 1) }
    }

    /** Node handles of the last [readScreen], by the id given to the gate. A new read replaces them. */
    private val handles = HashMap<Int, AccessibilityNodeInfo>()

    /** tap / type / scroll / back on the last read screen. The package is re-checked right before acting. */
    fun perform(action: JSONObject): JSONObject {
        val root = rootInActiveWindow
        val ok = permitted(root?.packageName?.toString())
        root?.recycle()
        if (!ok) { clearHandles(); return JSONObject().put("ok", false).put("error", refusal()) }
        val done = when (action.optString("type")) {
            "tap" -> handles[action.optInt("nodeId", -1)]?.let { clickable(it)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) } ?: false
            "type" -> handles[action.optInt("nodeId", -1)]?.takeIf { it.isEditable && !ScreenChecks.isSecretInput(it.isPassword, it.inputType) }?.let {
                it.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, action.optString("text")) })
            } ?: false
            "scroll" -> rootInActiveWindow?.let { r -> val up = action.optString("direction") == "up"; scrollable(r)?.performAction(if (up) AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) } ?: false
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            else -> false
        }
        clearHandles() // node ids are valid for one screen only
        return JSONObject().put("ok", done)
    }

    private fun clearHandles() {
        handles.values.forEach { it.recycle() }
        handles.clear()
    }

    private fun clickable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var cur: AccessibilityNodeInfo? = n
        while (cur != null && !cur.isClickable) cur = cur.parent
        return cur
    }

    private fun scrollable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (n.isScrollable) return n
        for (i in 0 until n.childCount) n.getChild(i)?.let { c -> scrollable(c)?.let { return it } }
        return null
    }

    override fun onInterrupt() {
        if (session.snapshot.state != PhoneSession.State.IDLE) session.stop("service_interrupted")
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        unlisten?.invoke()
        runCatching { unregisterReceiver(screenReceiver) }
        clearHandles()
        if (session.snapshot.state != PhoneSession.State.IDLE) session.stop("service_stopped")
        if (::overlay.isInitialized) overlay.destroy()
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val MAX_DEPTH = 40
        private const val MAX_NODES = 400
        private const val MAX_TEXT = 300
        @Volatile var instance: AgentAccessibilityService? = null
            private set
    }
}
