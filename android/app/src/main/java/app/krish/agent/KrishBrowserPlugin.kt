package app.krish.agent

import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Drives the agent's WebView. This plugin lives in the app UI WebView (local assets only).
 * The agent WebView has no JS bridge, so external pages cannot call into native code.
 */
@CapacitorPlugin(name = "KrishBrowser")
class KrishBrowserPlugin : Plugin() {
    /** Every agent tab, oldest first (insertion order). At most MAX_TABS. Only the active one is shown and gets page calls. */
    private val views = LinkedHashMap<Int, AgentWebView>()
    private var activeId = 0
    private var nextTabId = 1
    /** The card is shown (setMode "live"): the active tab is then visible and touchable. */
    private var live = false

    private val pageScript: String by lazy {
        context.assets.open("krish-page.js").bufferedReader().use { it.readText() }
    }

    private fun ui(call: PluginCall, block: (AgentWebView) -> Unit) {
        activity.runOnUiThread {
            try {
                block(ensureView())
            } catch (e: Exception) {
                call.reject(e.message ?: "browser error")
            }
        }
    }

    private fun emitPage(o: JSObject) = notifyListeners("page", o)

    /** One listener per tab: only the active tab reports page events, tagged with its id. */
    private inner class TabListener(private val id: Int) : AgentWebView.Listener {
        override fun onPage(url: String, title: String, loading: Boolean) {
            if (id == activeId) emitPage(JSObject().put("url", url).put("title", title).put("loading", loading).put("tabId", id))
        }
        override fun takePendingUpload(origin: String): Uri? = if (id == activeId) PickedFiles.take(origin) else null
    }

    /** A new tab view, hidden until it is activated. Same hardened AgentWebView as the first tab. */
    private fun newTab(): Int {
        val id = nextTabId++
        val view = AgentWebView(activity, pageScript, TabListener(id))
        view.alpha = HIDDEN_ALPHA
        view.interactive = false
        view.visibility = View.INVISIBLE
        activity.findViewById<ViewGroup>(android.R.id.content)
            .addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        views[id] = view
        views.values.firstOrNull()?.let { if (it !== view) view.setDesktopLayout(it.desktopLayout) }
        place(view)
        return id
    }

    private fun activate(id: Int): AgentWebView {
        val view = views[id] ?: throw IllegalArgumentException("no tab $id")
        for ((other, v) in views) if (other != id) {
            v.visibility = View.INVISIBLE
            v.alpha = HIDDEN_ALPHA
            v.interactive = false
        }
        activeId = id
        view.visibility = View.VISIBLE
        view.alpha = if (live) 1f else HIDDEN_ALPHA
        view.interactive = live
        view.bringToFront()
        emitPage(JSObject().put("url", view.url.orEmpty()).put("title", view.title.orEmpty()).put("loading", view.progress < 100).put("tabId", id))
        return view
    }

    private fun ensureView(): AgentWebView {
        views[activeId]?.let { return it }
        return activate(if (views.isEmpty()) newTab() else views.keys.last())
    }

    /** Runs a page-API expression and resolves the call with { value }. */
    private fun page(call: PluginCall, expr: () -> String) = ui(call) { v ->
        v.call(expr()) { r ->
            r.onSuccess { call.resolve(JSObject().put("value", it)) }
            r.onFailure { call.reject(it.message ?: "page error") }
        }
    }

    /** Element fingerprint from the approved observation (JS string literal, or null). */
    private fun fp(call: PluginCall) = call.getString("fp")?.let { JSONObject.quote(it) } ?: "null"

    private fun num(call: PluginCall) = call.getInt("elementId") ?: throw IllegalArgumentException("elementId required")

    @PluginMethod fun open(call: PluginCall) {
        val url = call.getString("url").orEmpty()
        if (!url.startsWith("https://")) return call.reject("only https URLs are allowed")
        ui(call) { it.loadUrl(url); call.resolve() }
    }

    @PluginMethod fun observe(call: PluginCall) = page(call) { "K.observe()" }
    @PluginMethod fun read(call: PluginCall) = page(call) { "K.read(${call.getInt("elementId") ?: "null"})" }
    @PluginMethod fun scroll(call: PluginCall) = page(call) { "K.scroll(${JSONObject.quote(call.getString("direction") ?: "down")})" }

    /**
     * A real touch on the element (sites that ignore script clicks react to it). The page script checks the element and its
     * fingerprint and scrolls it into view; if it cannot give a position, the script click is used instead.
     */
    @PluginMethod fun click(call: PluginCall) = ui(call) { v ->
        val id = num(call)
        v.call("K.rect($id,${fp(call)})") { r ->
            r.onSuccess { json ->
                val o = JSONObject(JSONTokener(json).nextValue().toString())
                v.tapCss(o.getDouble("x"), o.getDouble("y"), o.getDouble("innerWidth"))
                call.resolve()
            }
            r.onFailure {
                v.call("K.click($id,${fp(call)})") { c ->
                    c.onSuccess { call.resolve() }
                    c.onFailure { e -> call.reject(e.message ?: "page error") }
                }
            }
        }
    }
    @PluginMethod fun highlight(call: PluginCall) = page(call) { "K.highlight(${call.getInt("elementId") ?: "null"})" }

    @PluginMethod fun type(call: PluginCall) =
        page(call) { "K.type(${num(call)},${JSONObject.quote(call.getString("text").orEmpty())},${call.getBoolean("submit") ?: false},${fp(call)})" }

    /** Used for paste and for secure input. The value is only embedded in the call; nothing is logged or returned. */
    @PluginMethod fun fill(call: PluginCall) = ui(call) { v ->
        // Page-originated error text is never returned from a fill: a hostile page could echo the value in it.
        v.call("K.fill(${num(call)},${JSONObject.quote(call.getString("value").orEmpty())},${fp(call)})") { r ->
            r.onSuccess { call.resolve() }
            r.onFailure { call.reject("could not fill the field") }
        }
    }

    /** Answers the page's file chooser with a user-picked file by sending a real tap on the input. */
    @PluginMethod fun upload(call: PluginCall) {
        val uri = call.getString("token")?.let { PickedFiles.get(it) } ?: return call.reject("unknown file token")
        ui(call) { v ->
            val id = num(call)
            v.call("K.rect($id,${fp(call)})") { r ->
                r.onSuccess { json ->
                    val o = JSONObject(JSONTokener(json).nextValue().toString())
                    // One-shot, bound to this page's origin, expires quickly; cleared on navigation, STOP and site-data clearing.
                    PickedFiles.arm(uri, Uri.parse(v.url.orEmpty()).let { "${it.scheme}://${it.authority}" })
                    v.tapCss(o.getDouble("x"), o.getDouble("y"), o.getDouble("innerWidth"))
                    call.resolve()
                }
                r.onFailure { call.reject(it.message ?: "page error") }
            }
        }
    }

    private var bounds = doubleArrayOf(0.0, 0.0, 1.0, 1.0, 0.0)

    private fun place(v: AgentWebView) {
        val host = bridge.webView
        val content = activity.findViewById<View>(android.R.id.content)
        val a = IntArray(2).also { host.getLocationOnScreen(it) }
        val b = IntArray(2).also { content.getLocationOnScreen(it) }
        v.place(bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], a[0] - b[0], a[1] - b[1])
    }

    /** Position the live window. x/y/w/h are CSS px relative to the app UI viewport. */
    @PluginMethod fun setBounds(call: PluginCall) {
        bounds = doubleArrayOf(call.getDouble("x") ?: 0.0, call.getDouble("y") ?: 0.0, call.getDouble("width") ?: 1.0, call.getDouble("height") ?: 1.0, call.getDouble("radius") ?: 0.0)
        ui(call) { _ -> for (v in views.values) place(v); call.resolve() }
    }

    /** mode: "live" (visible, touchable) or "hidden" (full-size so layout stays valid, near-transparent, touches fall through). */
    @PluginMethod fun setMode(call: PluginCall) {
        val on = call.getString("mode") == "live"
        ui(call) { v ->
            live = on
            v.alpha = if (on) 1f else HIDDEN_ALPHA
            v.interactive = on
            call.resolve()
        }
    }

    @PluginMethod fun setDesktopLayout(call: PluginCall) =
        ui(call) { _ ->
            for (v in views.values) { v.setDesktopLayout(call.getBoolean("enabled") ?: false); place(v) }
            call.resolve()
        }

    // ---- tabs (round 10) ----

    @PluginMethod fun tabs(call: PluginCall) = ui(call) { _ ->
        val list = JSONArray()
        for ((id, v) in views) list.put(JSONObject().put("id", id).put("title", v.title.orEmpty()).put("url", v.url.orEmpty()).put("active", id == activeId))
        call.resolve(JSObject().put("value", list.toString()))
    }

    @PluginMethod fun openTab(call: PluginCall) {
        val url = call.getString("url").orEmpty()
        if (!url.startsWith("https://")) return call.reject("only https URLs are allowed")
        ui(call) { _ ->
            if (views.size >= MAX_TABS) throw IllegalStateException("at most $MAX_TABS tabs")
            val id = newTab()
            activate(id).loadUrl(url)
            call.resolve(JSObject().put("tabId", id))
        }
    }

    @PluginMethod fun switchTab(call: PluginCall) = ui(call) { _ ->
        activate(call.getInt("tabId") ?: throw IllegalArgumentException("tabId required"))
        call.resolve()
    }

    @PluginMethod fun closeTab(call: PluginCall) = ui(call) { _ ->
        val id = call.getInt("tabId") ?: throw IllegalArgumentException("tabId required")
        val v = views[id] ?: throw IllegalArgumentException("no tab $id")
        if (views.size == 1) throw IllegalStateException("the last tab cannot be closed")
        views.remove(id)
        (v.parent as? ViewGroup)?.removeView(v)
        v.destroy()
        if (activeId == id) activate(views.keys.last())
        call.resolve()
    }

    /** Verification code or link from an inbox tab. The value goes back to the app's JS only (the agent loop keeps it from every model). */
    @PluginMethod fun findCode(call: PluginCall) = ui(call) { _ ->
        val id = call.getInt("tabId") ?: throw IllegalArgumentException("tabId required")
        val v = views[id] ?: throw IllegalArgumentException("no tab $id")
        val from = JSONObject.quote(call.getString("from").orEmpty().take(120))
        val subject = JSONObject.quote(call.getString("subject").orEmpty().take(120))
        v.call("K.findCode($from,$subject)") { r ->
            r.onSuccess { call.resolve(JSObject().put("value", it)) }
            r.onFailure { call.reject(it.message ?: "page error") }
        }
    }

    @PluginMethod fun snapshot(call: PluginCall) = ui(call) { v ->
        val img = v.snapshot(call.getInt("maxWidth") ?: 480, call.getInt("quality") ?: 55)
        call.resolve(JSObject().put("value", img ?: ""))
    }

    @PluginMethod fun stopLoading(call: PluginCall) = ui(call) { _ -> PickedFiles.disarm(); for (v in views.values) v.stopLoading(); call.resolve() }

    @PluginMethod fun clearSiteData(call: PluginCall) = ui(call) { _ -> for (v in views.values) v.clearSiteData(); PickedFiles.clear(); call.resolve() }

    override fun handleOnDestroy() {
        val all = views.values.toList()
        views.clear()
        activity?.runOnUiThread { for (v in all) { (v.parent as? ViewGroup)?.removeView(v); v.destroy() } }
    }

    private companion object {
        const val HIDDEN_ALPHA = 0.01f
        const val MAX_TABS = 4
    }
}
