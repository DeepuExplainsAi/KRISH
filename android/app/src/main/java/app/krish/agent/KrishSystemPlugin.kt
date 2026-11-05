package app.krish.agent

import android.Manifest
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Device facts, AlarmManager scheduling and the opt-in notification permission.
 * The JS side computes next-run times (core/memory/schedule.ts) and asks for one alarm per item,
 * re-arming after each run, so exact schedule logic stays in one tested place.
 */
@CapacitorPlugin(
    name = "KrishSystem",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class KrishSystemPlugin : Plugin() {

    @PluginMethod fun deviceInfo(call: PluginCall) {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        call.resolve(
            JSObject()
                .put("lowRam", am.isLowRamDevice || mem.totalMem < LOW_RAM_BYTES)
                .put("totalMemMb", mem.totalMem / (1024 * 1024))
                .put("sdk", Build.VERSION.SDK_INT)
                .put("linuxSandbox", BuildConfig.LINUX_SANDBOX),
        )
    }

    /** Opens an https page in the user's own browser (key pages). Only https; never inside the agent's WebView. */
    @PluginMethod fun openExternal(call: PluginCall) {
        val uri = runCatching { Uri.parse(call.getString("url")) }.getOrNull()
        if (uri == null || uri.scheme != "https" || uri.host.isNullOrEmpty() || uri.userInfo != null) return call.reject("only https URLs are allowed")
        runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onSuccess { call.resolve() }
            .onFailure { call.reject("no browser available") }
    }

    /** Only called from the morning-brief opt-in. Below Android 13 no permission exists. */
    @PluginMethod fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            return call.resolve(JSObject().put("granted", true))
        }
        requestPermissionForAlias("notifications", call, "onNotifications")
    }

    @PermissionCallback
    private fun onNotifications(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }

    @PluginMethod fun notificationsGranted(call: PluginCall) {
        val granted = Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        call.resolve(JSObject().put("granted", granted))
    }

    private fun dueIntent(id: String, title: String? = null, flags: Int = PendingIntent.FLAG_UPDATE_CURRENT): PendingIntent? {
        val i = Intent(context, DueReceiver::class.java).setAction("app.krish.agent.DUE").putExtra(DueReceiver.KEY_ID, id)
        if (title != null) i.putExtra(DueReceiver.KEY_TITLE, title)
        return PendingIntent.getBroadcast(context, id.hashCode(), i, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    /** One alarm per item id; scheduling again replaces it. Exact when Android allows it, otherwise a few minutes late. Alarms do not survive a reboot: the app re-arms them when opened. */
    @PluginMethod fun scheduleDue(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val at = call.getLong("at") ?: return call.reject("at required")
        val pi = dueIntent(id, call.getString("title").orEmpty()) ?: return call.reject("alarm unavailable")
        val am = context.getSystemService(AlarmManager::class.java)
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
        call.resolve()
    }

    @PluginMethod fun cancelDue(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        dueIntent(id, null, PendingIntent.FLAG_NO_CREATE)?.let { context.getSystemService(AlarmManager::class.java).cancel(it); it.cancel() }
        call.resolve()
    }

    /** On: a foreground service (ongoing "Krish is working" line + CPU wake lock) keeps tasks running with the screen off. Off: it stops. */
    @PluginMethod fun keepAlive(call: PluginCall) {
        val on = call.getBoolean("on") ?: false
        // Preserve existing behavior if Android refuses a background service start.
        if (on) KeepAliveService.acquire(context, "agent") else KeepAliveService.release(context, "agent")
        call.resolve()
    }

    private companion object {
        const val LOW_RAM_BYTES = 3L * 1024 * 1024 * 1024
    }
}
