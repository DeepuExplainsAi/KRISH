package app.krish.agent

import android.content.Intent
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

/**
 * Bridge from the Krish app to the user's own browser app, through KrishAccessibilityService.
 * Every call runs on its own thread (the service waits for pages), and fails with a plain message when the service is off.
 */
@CapacitorPlugin(name = "KrishDevice")
class KrishDevicePlugin : Plugin() {
    private val pool = Executors.newSingleThreadExecutor()

    override fun load() {
        KrishAccessibilityService.onAction = { what ->
            when (what) {
                "stop" -> notifyListeners("stop", JSObject())
                "resume" -> notifyListeners("resume", JSObject())
                else -> activity.runOnUiThread { KrishAccessibilityService.instance?.focusApp() }
            }
        }
    }

    override fun handleOnResume() {
        KrishAccessibilityService.appForeground = true
        KrishAccessibilityService.instance?.hide()
    }

    override fun handleOnPause() {
        KrishAccessibilityService.appForeground = false
    }

    private fun svc(call: PluginCall): KrishAccessibilityService? =
        KrishAccessibilityService.instance ?: run { call.reject("turn on Krish in Accessibility settings first"); null }

    private fun onService(call: PluginCall, block: (KrishAccessibilityService) -> Any?) {
        val s = svc(call) ?: return
        pool.execute {
            try {
                when (val r = block(s)) {
                    is String -> call.resolve(JSObject().put("value", r))
                    else -> call.resolve()
                }
            } catch (e: Exception) {
                call.reject(e.message ?: "browser error")
            }
        }
    }

    @PluginMethod fun status(call: PluginCall) = call.resolve(JSObject().put("enabled", KrishAccessibilityService.instance != null))

    @PluginMethod fun openSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    }

    @PluginMethod fun open(call: PluginCall) {
        val url = call.getString("url").orEmpty()
        if (!url.startsWith("https://")) return call.reject("only https URLs are allowed")
        onService(call) { it.open(url) }
    }

    @PluginMethod fun observe(call: PluginCall) = onService(call) { it.observe() }
    @PluginMethod fun read(call: PluginCall) = onService(call) { it.readPage(call.getInt("elementId")) }
    @PluginMethod fun click(call: PluginCall) = onService(call) { it.click(call.getInt("elementId") ?: -1, call.getString("fp")) }
    @PluginMethod fun scroll(call: PluginCall) = onService(call) { it.scroll(call.getString("direction") != "up") }

    @PluginMethod fun type(call: PluginCall) =
        onService(call) { it.setText(call.getInt("elementId") ?: -1, call.getString("fp"), call.getString("text").orEmpty(), call.getBoolean("submit") ?: false) }

    /** Used for paste and secure input; the value is passed straight through and nothing is returned. */
    @PluginMethod fun fill(call: PluginCall) {
        val s = svc(call) ?: return
        pool.execute {
            try {
                s.setText(call.getInt("elementId") ?: -1, call.getString("fp"), call.getString("value").orEmpty(), false)
                call.resolve()
            } catch (e: Exception) {
                call.reject("could not fill the field")
            }
        }
    }

    @PluginMethod fun say(call: PluginCall) {
        val s = svc(call) ?: return
        s.say(call.getString("text").orEmpty().take(120), call.getString("action"))
        call.resolve()
    }

    @PluginMethod fun hide(call: PluginCall) { KrishAccessibilityService.instance?.hide(); call.resolve() }
    @PluginMethod fun focusApp(call: PluginCall) { activity.runOnUiThread { KrishAccessibilityService.instance?.focusApp() }; call.resolve() }
}
