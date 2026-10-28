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
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Drives the agent's WebView. This plugin lives in the app UI WebView (local assets only).
 * The agent WebView has no JS bridge, so external pages cannot call into native code.
 */
@CapacitorPlugin(name = "KrishBrowser")
class KrishBrowserPlugin : Plugin(), AgentWebView.Listener {
    private var web: AgentWebView? = null

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

    private fun ensureView(): AgentWebView {
        web?.let { return it }
        val view = AgentWebView(activity, pageScript, this)
        view.alpha = HIDDEN_ALPHA
        view.interactive = false
        activity.findViewById<ViewGroup>(android.R.id.content)
            .addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = view
        return view
    }

    override fun onPage(url: String, title: String, loading: Boolean) {
        notifyListeners("page", JSObject().put("url", url).put("title", title).put("loading", loading))
    }

    override fun takePendingUpload(origin: String): Uri? = PickedFiles.take(origin)

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
        ui(call) { v -> place(v); call.resolve() }
    }

    /** mode: "live" (visible, touchable) or "hidden" (full-size so layout stays valid, near-transparent, touches fall through). */
    @PluginMethod fun setMode(call: PluginCall) {
        val live = call.getString("mode") == "live"
        ui(call) { v ->
            v.alpha = if (live) 1f else HIDDEN_ALPHA
            v.interactive = live
            call.resolve()
        }
    }

    @PluginMethod fun setDesktopLayout(call: PluginCall) =
        ui(call) { it.setDesktopLayout(call.getBoolean("enabled") ?: false); place(it); call.resolve() }

    @PluginMethod fun snapshot(call: PluginCall) = ui(call) { v ->
        val img = v.snapshot(call.getInt("maxWidth") ?: 480, call.getInt("quality") ?: 55)
        call.resolve(JSObject().put("value", img ?: ""))
    }

    @PluginMethod fun stopLoading(call: PluginCall) = ui(call) { PickedFiles.disarm(); it.stopLoading(); call.resolve() }

    @PluginMethod fun clearSiteData(call: PluginCall) = ui(call) { it.clearSiteData(); PickedFiles.clear(); call.resolve() }

    override fun handleOnDestroy() {
        web?.let { v -> activity?.runOnUiThread { (v.parent as? ViewGroup)?.removeView(v); v.destroy() } }
        web = null
    }

    private companion object {
        const val HIDDEN_ALPHA = 0.01f
    }
}
