package app.krish.agent

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.concurrent.TimeUnit

/**
 * Device facts, WorkManager scheduling and the opt-in notification permission.
 * The JS side computes next-run times (core/memory/schedule.ts) and asks for one OneTime job per item,
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

    @PluginMethod fun scheduleDue(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val at = call.getLong("at") ?: return call.reject("at required")
        val delay = (at - System.currentTimeMillis()).coerceAtLeast(0)
        val req = OneTimeWorkRequestBuilder<DueWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setInputData(Data.Builder().putString(DueWorker.KEY_ID, id).putString(DueWorker.KEY_TITLE, call.getString("title").orEmpty()).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("due:$id", ExistingWorkPolicy.REPLACE, req)
        call.resolve()
    }

    @PluginMethod fun cancelDue(call: PluginCall) {
        WorkManager.getInstance(context).cancelUniqueWork("due:" + (call.getString("id") ?: return call.reject("id required")))
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
