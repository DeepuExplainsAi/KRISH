package app.krish.agent

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * Bridge between the TypeScript engine and the phone-control session. Every method that touches another app goes through
 * AgentAccessibilityService, which re-checks the package; this class adds no extra reach.
 */
@CapacitorPlugin(name = "KrishPhone")
class KrishPhonePlugin : Plugin() {
    private val session get() = PhoneRuntime.session(context)

    override fun load() {
        session.listen { notifyListeners("phoneState", state(it)) }
    }

    private fun state(s: PhoneSession.Snapshot = session.snapshot) =
        JSObject().put("state", s.state.name.lowercase()).put("reason", s.reason).put("taskId", s.taskId)

    private fun serviceEnabled(): Boolean {
        val me = ComponentName(context, AgentAccessibilityService::class.java).flattenToString()
        val list = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val sp = TextUtils.SimpleStringSplitter(':').apply { setString(list) }
        return sp.any { it.equals(me, ignoreCase = true) }
    }

    @PluginMethod fun status(call: PluginCall) {
        call.resolve(
            state()
                .put("accessibility", serviceEnabled() && AgentAccessibilityService.instance != null)
                .put("allowlist", JSArray(session.allowlist.toList())),
        )
    }

    /** Apps with a launcher icon, so the user can pick; hard-blocked ones are listed as blocked, never selectable. */
    @PluginMethod fun launchableApps(call: PluginCall) {
        val pm = context.packageManager
        val apps = JSArray()
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        pm.queryIntentActivities(intent, 0).map { it.activityInfo.packageName to it.loadLabel(pm).toString() }.distinct()
            .filter { it.first != context.packageName }
            .sortedBy { it.second.lowercase() }
            .forEach { (pkg, label) ->
                val verdict = PackagePolicyHolder.get(context).hardBlockGroup(pkg)
                apps.put(JSObject().put("pkg", pkg).put("label", label).put("blocked", verdict != null).put("group", verdict))
            }
        call.resolve(JSObject().put("apps", apps))
    }

    @PluginMethod fun setAllowlist(call: PluginCall) {
        val pkgs = call.getArray("packages")?.toList<String>() ?: return call.reject("packages required")
        val rejected = session.setAllowlist(pkgs, context.packageName)
        call.resolve(JSObject().put("allowlist", JSArray(session.allowlist.toList())).put("rejected", JSArray(rejected)))
    }

    /** Called only after the user tapped Start on the plan screen. */
    @PluginMethod fun start(call: PluginCall) {
        val id = call.getString("taskId") ?: return call.reject("taskId required")
        if (!serviceEnabled()) return call.reject("accessibility_off")
        if (!session.start(id)) return call.reject(if (session.allowlist.isEmpty()) "no_allowed_apps" else "task_already_running")
        call.resolve(state())
    }

    @PluginMethod fun resume(call: PluginCall) {
        session.resume()
        call.resolve(state())
    }

    @PluginMethod fun stop(call: PluginCall) {
        session.stop(call.getString("reason") ?: "user_stop")
        call.resolve(state())
    }

    @PluginMethod fun readScreen(call: PluginCall) {
        val svc = AgentAccessibilityService.instance ?: return call.reject("accessibility_off")
        svc.readScreen(call.getBoolean("screenshot", false) == true) { call.resolve(JSObject(it.toString())) }
    }

    @PluginMethod fun perform(call: PluginCall) {
        val svc = AgentAccessibilityService.instance ?: return call.reject("accessibility_off")
        val action = call.data
        call.resolve(JSObject(svc.perform(JSONObject(action.toString())).toString()))
    }

    /** Launches an allowed app. Re-checked here so the bridge alone can never open a blocked app. */
    @PluginMethod fun openApp(call: PluginCall) {
        val pkg = call.getString("package") ?: return call.reject("package required")
        if (!session.running) return call.reject("no_task_running")
        val v = session.check(pkg)
        if (v is PackagePolicy.Verdict.Block) return call.reject("app_not_allowed:${v.reason}")
        val intent = context.packageManager.getLaunchIntentForPackage(pkg) ?: return call.reject("app_not_installed")
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    }

    /** Shows the confirmation popup over the current app. Resolves `{allowed}`; anything but an explicit Allow is false. */
    @PluginMethod fun confirm(call: PluginCall) {
        val svc = AgentAccessibilityService.instance ?: return call.resolve(JSObject().put("allowed", false))
        svc.confirm(call.getString("title") ?: "Allow this?", call.getString("detail").orEmpty().take(300)) { call.resolve(JSObject().put("allowed", it)) }
    }

    @PluginMethod fun openAccessibilitySettings(call: PluginCall) {
        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    }

    /** The system list of battery-optimization exemptions (needs no permission). The user picks Krish there. */
    @PluginMethod fun openBatterySettings(call: PluginCall) {
        context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    }
}
