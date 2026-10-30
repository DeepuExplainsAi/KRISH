package app.krish.agent

import android.app.ActivityManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import org.json.JSONArray
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** The sole owner of the native library. Android may kill this process independently of the UI. */
class LlmService : Service() {
    companion object { const val COMPLETE = 1; const val STOP = 2; const val UNLOAD = 3; const val LOAD = 4 }
    private val executor = Executors.newSingleThreadExecutor()
    private val stopped = AtomicBoolean(false)
    private var loadedId: String? = null // worker thread only
    private val messenger = Messenger(Handler(Looper.getMainLooper()) { msg ->
        when (msg.what) {
            STOP -> { stopped.set(true); NativeLlama.stop(); true }
            UNLOAD -> { executor.execute { NativeLlama.unload(); loadedId = null }; true }
            COMPLETE, LOAD -> {
                val reply = msg.replyTo
                val requestId = msg.arg1
                val operation = msg.what
                val data = Bundle(msg.data)
                stopped.set(false)
                NativeLlama.resetStop()
                executor.execute {
                    val response = Bundle()
                    try {
                        val id = data.getString("modelId") ?: error("Missing model")
                        val models = JSONArray(assets.open("local-models.json").bufferedReader().use { it.readText() })
                        val entry = (0 until models.length()).map { models.getJSONObject(it) }.firstOrNull { it.getString("id") == id } ?: error("Unknown model")
                        val hash = entry.getString("sha256")
                        require(hash.matches(Regex("[0-9a-f]{64}")))
                        val path = File(filesDir, "local-models/$id-$hash.gguf")
                        require(path.isFile && path.length() == entry.getLong("sizeBytes")) { "Model is not installed" }
                        if (loadedId != id) {
                            loadedId = null
                            val info = ActivityManager.MemoryInfo()
                            (getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
                            val ram = info.totalMem / 1048576L
                            val contextSize = when { ram < 3584 -> 4096; ram < 7168 -> 6144; else -> 8192 }
                            if (stopped.get()) error("Stopped")
                            NativeLlama.load(path.absolutePath.toByteArray(Charsets.UTF_8), contextSize)
                            loadedId = id
                        }
                        if (stopped.get()) error("Stopped")
                        if (operation == COMPLETE) {
                            val result = NativeLlama.complete((data.getString("messages") ?: error("Missing messages")).toByteArray(Charsets.UTF_8), (data.getString("schema") ?: error("Missing schema")).toByteArray(Charsets.UTF_8))
                            if (stopped.get()) error("Stopped")
                            response.putString("text", result.toString(Charsets.UTF_8))
                        }
                    } catch (_: OutOfMemoryError) {
                        response.putString("error", "Not enough memory for the on-device model")
                    } catch (e: Throwable) {
                        response.putString("error", if (e.message == "On-device prompt is too long") "On-device prompt is too long" else "On-device model failed or was stopped")
                    }
                    try { reply?.send(Message.obtain(null, COMPLETE).apply { arg1 = requestId; this.data = response }) } catch (_: Exception) { }
                }
                true
            }
            else -> false
        }
    })
    override fun onBind(intent: Intent?): IBinder = messenger.binder
    override fun onDestroy() { NativeLlama.stop(); executor.shutdown(); super.onDestroy() }
}
