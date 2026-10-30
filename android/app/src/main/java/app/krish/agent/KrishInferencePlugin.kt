package app.krish.agent

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Binder failures are reported to JS; the next request makes a fresh connection. */
@CapacitorPlugin(name = "KrishInference")
class KrishInferencePlugin : Plugin() {
    companion object {
        private var instance: KrishInferencePlugin? = null
        fun background() { instance?.scheduleUnload() }
        fun foreground() { instance?.cancelUnload() }
    }
    override fun load() { instance = this; super.load() }
    private val unloadTask = Runnable { try { remote?.send(Message.obtain(null, LlmService.UNLOAD)) } catch (_: Exception) { lost() } }
    private fun scheduleUnload() { main.removeCallbacks(unloadTask); main.postDelayed(unloadTask, 5 * 60_000L) }
    private fun cancelUnload() { main.removeCallbacks(unloadTask) }
    private val main = Handler(Looper.getMainLooper())
    private var remote: Messenger? = null
    private var bound = false
    private var connection: ServiceConnection? = null
    private var nextId = 0
    private val pending = mutableMapOf<Int, PluginCall>()
    private val queued = mutableListOf<Message>()
    private val replies = Messenger(Handler(Looper.getMainLooper()) { msg ->
        val call = pending.remove(msg.arg1)
        if (call != null) {
            val error = msg.data.getString("error")
            if (error != null) call.reject(error) else call.resolve(JSObject().put("text", msg.data.getString("text")))
        }
        true
    })
    private fun newConnection() = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder) {
            if (connection !== this) return
            remote = Messenger(binder)
            try {
                binder.linkToDeath({ main.post { if (connection === this && remote?.binder === binder) lost() } }, 0)
                val requests = queued.toList(); queued.clear()
                requests.forEach { remote!!.send(it) }
            } catch (_: Exception) { lost() }
        }
        override fun onServiceDisconnected(name: ComponentName?) { if (connection === this) lost() }
        override fun onBindingDied(name: ComponentName?) { if (connection === this) lost() }
        override fun onNullBinding(name: ComponentName?) { if (connection === this) lost() }
    }
    private fun lost() {
        remote = null
        val old = connection
        connection = null
        if (bound && old != null) { try { context.applicationContext.unbindService(old) } catch (_: Exception) { } }
        bound = false
        queued.clear()
        val calls = pending.values.toList(); pending.clear()
        calls.forEach { it.reject("On-device model process stopped. Try again.") }
    }
    private fun send(message: Message) {
        try {
            if (remote != null) remote!!.send(message)
            else {
                queued.add(message)
                if (!bound) {
                    val next = newConnection()
                    connection = next
                    bound = context.applicationContext.bindService(Intent(context.applicationContext, LlmService::class.java), next, Context.BIND_AUTO_CREATE)
                    if (!bound) lost()
                }
            }
        } catch (_: Exception) { lost() }
    }
    @PluginMethod fun loadModel(call: PluginCall) = submit(call, true)
    @PluginMethod fun complete(call: PluginCall) = submit(call, false)
    private fun submit(call: PluginCall, loadOnly: Boolean) {
        val id = call.getString("modelId") ?: return call.reject("Missing model")
        val messages = call.getString("messages") ?: if (loadOnly) "" else return call.reject("Missing messages")
        val schema = call.getString("schema") ?: if (loadOnly) "" else return call.reject("Missing schema")
        if (messages.length + schema.length > 200_000) return call.reject("On-device request too large")
        main.post {
            if (pending.isNotEmpty()) { call.reject("On-device model is busy"); return@post }
            val number = ++nextId
            pending[number] = call
            val data = Bundle().apply { putString("modelId", id); putString("messages", messages); putString("schema", schema) }
            send(Message.obtain(null, if (loadOnly) LlmService.LOAD else LlmService.COMPLETE).apply { arg1 = number; this.data = data; replyTo = replies })
            main.postDelayed({ if (pending.containsKey(number)) { try { remote?.send(Message.obtain(null, LlmService.STOP)) } catch (_: Exception) { }; lost() } }, 600_000)
        }
    }
    @PluginMethod fun stop(call: PluginCall) {
        main.post {
            // If the service has not connected yet, discard the request instead of starting it later.
            if (remote == null && pending.isNotEmpty()) lost()
            else try { remote?.send(Message.obtain(null, LlmService.STOP)) } catch (_: Exception) { lost() }
            call.resolve()
        }
    }
    @PluginMethod fun unload(call: PluginCall) {
        main.post { try { remote?.send(Message.obtain(null, LlmService.UNLOAD)) } catch (_: Exception) { lost() }; call.resolve() }
    }
    override fun handleOnDestroy() { if (instance === this) instance = null; main.removeCallbacks(unloadTask); main.post { lost() }; super.handleOnDestroy() }
}
