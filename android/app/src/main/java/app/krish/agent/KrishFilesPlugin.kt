package app.krish.agent

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/** Files move in and out only through the system picker. No storage permissions are requested. */
@CapacitorPlugin(name = "KrishFiles")
class KrishFilesPlugin : Plugin() {

    @PluginMethod fun pickFile(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(call, intent, "onPicked")
    }

    @ActivityCallback
    private fun onPicked(call: PluginCall?, result: ActivityResult) {
        call ?: return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) return call.resolve() // cancelled: empty result
        var name = "file"
        var size = 0L
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { size = c.getLong(it) }
            }
        }
        call.resolve(JSObject().put("name", name).put("size", size).put("token", PickedFiles.put(uri)))
    }

    /** Base64 of a picked file, for the Tier 0 sandbox. Capped to protect low-RAM devices. */
    @PluginMethod fun readFile(call: PluginCall) {
        val uri = call.getString("token")?.let { PickedFiles.get(it) } ?: return call.reject("unknown file token")
        val max = call.getInt("maxBytes") ?: DEFAULT_MAX_BYTES
        try {
            val out = java.io.ByteArrayOutputStream()
            context.contentResolver.openInputStream(uri)!!.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (out.size() + n > max) return call.reject("file larger than $max bytes")
                    out.write(buf, 0, n)
                }
            }
            val bytes = out.toByteArray()
            call.resolve(JSObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)))
        } catch (e: Exception) {
            call.reject(e.message ?: "read failed")
        }
    }

    private var pendingSave: Pair<PluginCall, ByteArray>? = null

    /** Saves bytes through the system "create document" picker (the user chooses where). */
    @PluginMethod fun saveFile(call: PluginCall) {
        val bytes = Base64.decode(call.getString("base64").orEmpty(), Base64.DEFAULT)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = call.getString("mime") ?: "application/octet-stream"
            putExtra(Intent.EXTRA_TITLE, call.getString("name") ?: "output")
        }
        pendingSave = call to bytes
        startActivityForResult(call, intent, "onSaveTarget")
    }

    @ActivityCallback
    private fun onSaveTarget(call: PluginCall?, result: ActivityResult) {
        val (saved, bytes) = pendingSave ?: return
        pendingSave = null
        val uri: Uri? = result.data?.data
        if (call == null || result.resultCode != Activity.RESULT_OK || uri == null) return saved.resolve(JSObject().put("saved", false))
        try {
            context.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
            saved.resolve(JSObject().put("saved", true))
        } catch (e: Exception) {
            saved.reject(e.message ?: "write failed")
        }
    }

    private companion object {
        const val DEFAULT_MAX_BYTES = 50 * 1024 * 1024
    }
}
