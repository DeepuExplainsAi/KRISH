package app.krish.agent

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Only catalog IDs are accepted. URLs, checksums and sizes come from the bundled, shared catalog. */
@CapacitorPlugin(name = "KrishLocal")
class KrishLocalPlugin : Plugin() {
    private data class Model(val id: String, val repo: String, val revision: String, val file: String, val size: Long, val hash: String)
    private class Job(val model: Model) {
        @Volatile var command: String? = null
        @Volatile var call: Call? = null
    }
    companion object {
        // Activity recreation must not allow two plugin instances to write the same partial file.
        private val lock = Any()
        private var active: Job? = null
        private var eventTarget: KrishLocalPlugin? = null
    }
    override fun load() {
        synchronized(lock) { eventTarget = this }
        super.load()
    }
    private val worker = Executors.newSingleThreadExecutor()
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(30, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS).build() // default NO_COOKIES
    private val dir: File get() = File(context.filesDir, "local-models").also { check(it.isDirectory || it.mkdirs()) }

    private fun models(): List<Model> {
        val json = JSONArray(context.assets.open("local-models.json").bufferedReader().use { it.readText() })
        return (0 until json.length()).map { index ->
            val m = json.getJSONObject(index)
            Model(m.getString("id"), m.getString("repo"), m.getString("revision"), m.getString("file"), m.getLong("sizeBytes"), m.getString("sha256"))
        }
    }
    private fun model(id: String?): Model = models().firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown model")
    private fun part(m: Model) = File(dir, "${m.id}-${m.hash}.part")
    private fun installed(m: Model) = File(dir, "${m.id}-${m.hash}.gguf")
    private fun emit(m: Model, status: String, bytes: Long, error: String? = null) {
        val data = JSObject().put("modelId", m.id).put("status", status).put("bytes", bytes).put("total", m.size)
        if (error != null) data.put("error", error)
        synchronized(lock) { eventTarget?.notifyListeners("progress", data) }
    }

    @PluginMethod fun deviceInfo(call: PluginCall) {
        val info = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        val network = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        call.resolve(JSObject().put("totalRamMB", info.totalMem / 1048576L).put("freeStorageMB", dir.usableSpace / 1048576L).put("metered", network.isActiveNetworkMetered))
    }

    @PluginMethod fun listInstalled(call: PluginCall) {
        val done = JSArray(); val partial = JSArray()
        models().forEach { m ->
            if (installed(m).isFile && installed(m).length() == m.size) done.put(m.id)
            if (part(m).isFile) partial.put(JSObject().put("modelId", m.id).put("bytes", part(m).length()))
        }
        val current = synchronized(lock) { active?.model?.id }
        call.resolve(JSObject().put("installed", done).put("partial", partial).put("active", current))
    }

    @PluginMethod fun download(call: PluginCall) {
        val m = try { model(call.getString("modelId")) } catch (_: Exception) { return call.reject("Unknown model") }
        if (!m.hash.matches(Regex("[0-9a-f]{64}")) || m.size <= 0) return call.reject("Model checksum or size is missing")
        if (installed(m).isFile) return call.reject("Model is already installed")
        val job = Job(m)
        synchronized(lock) {
            if (active != null) return call.reject("Another download is still running")
            active = job
        }
        worker.execute { runDownload(job) }
        call.resolve()
    }

    @PluginMethod fun pause(call: PluginCall) = stopJob(call, "pause")
    @PluginMethod fun cancel(call: PluginCall) = stopJob(call, "cancel")
    @PluginMethod fun resume(call: PluginCall) = download(call)
    private fun stopJob(call: PluginCall, command: String) {
        val m = try { model(call.getString("modelId")) } catch (_: Exception) { return call.reject("Unknown model") }
        synchronized(lock) {
            val job = active
            if (job != null && job.model.id == m.id) {
                job.command = command
                job.call?.cancel()
            } else if (job != null) return call.reject("Another download is still running")
            else if (command == "cancel") {
                if (part(m).exists() && !part(m).delete()) return call.reject("Could not remove partial file")
                emit(m, "cancelled", 0)
            } else return call.reject("Download is not running")
        }
        call.resolve()
    }
    @PluginMethod fun delete(call: PluginCall) {
        val m = try { model(call.getString("modelId")) } catch (_: Exception) { return call.reject("Unknown model") }
        synchronized(lock) {
            if (active != null) return call.reject("Wait for the current download to finish")
            if (installed(m).exists() && !installed(m).delete()) return call.reject("Could not delete model")
            if (part(m).exists() && !part(m).delete()) return call.reject("Could not delete partial file")
        }
        call.resolve()
    }

    /** Reject everything except HTTPS default port and the explicit HF download hosts; never forward cookies or auth. */
    private fun allowed(url: String): Boolean {
        val uri = try { URI(url) } catch (_: Exception) { return false }
        val hosts = setOf("huggingface.co", "cas-bridge.xethub.hf.co", "us.aws.cdn.hf.co")
        return uri.scheme == "https" && uri.host in hosts && (uri.port == -1 || uri.port == 443) && uri.userInfo == null && uri.fragment == null
    }
    private fun response(job: Job, initial: String, offset: Long): okhttp3.Response {
        var url = initial
        repeat(4) {
            if (!allowed(url)) throw IllegalStateException("Download redirect host is not allowed")
            if (job.command != null) throw InterruptedException()
            val builder = Request.Builder().url(url).header("Accept-Encoding", "identity")
            if (offset > 0) builder.header("Range", "bytes=$offset-")
            val request = client.newCall(builder.build())
            job.call = request
            if (job.command != null) { request.cancel(); throw InterruptedException() }
            val result = request.execute()
            if (result.code in 300..399) {
                val target = result.header("Location")
                result.close()
                if (target == null) throw IllegalStateException("Download redirect is missing")
                url = URI(url).resolve(target).toString()
            } else return result
        }
        throw IllegalStateException("Too many download redirects")
    }
    override fun handleOnDestroy() {
        synchronized(lock) {
            if (eventTarget === this) eventTarget = null
            active?.let { it.command = "pause"; it.call?.cancel() }
        }
        worker.shutdown()
        super.handleOnDestroy()
    }
    private fun runDownload(job: Job) {
        val m = job.model
        val tmp = part(m)
        try {
            if (!m.repo.matches(Regex("unsloth/Qwen3\\.5-[A-Za-z0-9.]+-GGUF")) || !m.revision.matches(Regex("[0-9a-f]{40}")) || !m.file.matches(Regex("Qwen3\\.5-[A-Za-z0-9.]+-Q4_K_M\\.gguf"))) throw IllegalStateException("Invalid catalog entry")
            var offset = if (tmp.exists()) tmp.length() else 0L
            if (offset > m.size) { if (!tmp.delete()) throw IllegalStateException("Could not remove partial file"); offset = 0 }
            // Existing partial bytes already occupy storage. Reserve all remaining bytes plus 15% of the full file.
            if (dir.usableSpace < (m.size - offset) + (m.size * 15 / 100)) throw IllegalStateException("Not enough free storage")
            emit(m, "downloading", offset)
            if (offset < m.size) {
                val url = "https://huggingface.co/${m.repo}/resolve/${m.revision}/${m.file}"
                response(job, url, offset).use { res ->
                    if (res.code == 200) {
                        // A server may ignore Range; truncating releases the existing partial space.
                        if (dir.usableSpace + offset < m.size + (m.size * 15 / 100)) throw IllegalStateException("Not enough free storage")
                        offset = 0
                    }
                    else if (res.code == 206) {
                        val expected = "bytes $offset-${m.size - 1}/${m.size}"
                        if (res.header("Content-Range") != expected) throw IllegalStateException("Invalid download range")
                    } else throw IllegalStateException("Download failed (HTTP ${res.code})")
                    val body = res.body ?: throw IllegalStateException("Empty download")
                    FileOutputStream(tmp, offset > 0).use { out ->
                        val buf = ByteArray(65536); var bytes = offset; var last = 0L
                        body.byteStream().use { input ->
                            while (true) {
                                if (job.command != null) throw InterruptedException()
                                val n = input.read(buf); if (n < 0) break
                                bytes += n
                                if (bytes > m.size) throw IllegalStateException("Download is larger than expected")
                                out.write(buf, 0, n)
                                val now = System.nanoTime()
                                if (now - last > 250_000_000L) { emit(m, "downloading", bytes); last = now }
                            }
                        }
                    }
                }
            }
            if (tmp.length() != m.size) throw IllegalStateException("Download is incomplete")
            emit(m, "verifying", m.size)
            val digest = MessageDigest.getInstance("SHA-256")
            tmp.inputStream().use { input ->
                val b = ByteArray(65536)
                while (true) {
                    if (job.command != null) throw InterruptedException()
                    val n = input.read(b); if (n < 0) break
                    digest.update(b, 0, n)
                }
            }
            val hash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
            if (hash != m.hash) {
                if (!tmp.delete()) throw IllegalStateException("Checksum mismatch; could not delete corrupt file")
                throw IllegalStateException("Model checksum mismatch")
            }
            synchronized(lock) {
                if (job.command != null) throw InterruptedException()
                if (!tmp.renameTo(installed(m))) throw IllegalStateException("Could not save model")
                active = null
                emit(m, "installed", m.size)
            }
        } catch (e: Exception) {
            synchronized(lock) {
                val command = job.command
                if (command == "cancel") tmp.delete()
                active = null
                when (command) {
                    "pause" -> emit(m, "paused", tmp.length())
                    "cancel" -> emit(m, "cancelled", 0)
                    else -> emit(m, "error", tmp.length(), if (e is IllegalStateException) e.message ?: "Download failed" else "Download failed. Check your connection and try again.")
                }
            }
        } finally { job.call = null }
    }
}
