package app.krish.agent

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Tier 1: Alpine minirootfs run through proot. OFF unless the user enables it in Settings.
 *
 * proot and its libraries ship as "native libraries" (jniLibs/arm64-v8a/lib*.so) because Android only lets an
 * app execute files from its native-library directory (extractNativeLibs=true). The Alpine rootfs is bundled as an
 * asset and extracted to app-private storage on first run, after its SHA-256 is verified.
 *
 * Network: proot cannot cut network access, so the sandbox sees the host network. This tier is therefore treated as
 * "network-capable": every shell command requires the user's confirmation (see core/agent/policy.ts) and the app
 * never forwards cookies, keys or the agent browser's data into it.
 *
 * Fallback if the OS blocks execution (SELinux / seccomp on some builds): run() returns a clear error and the app
 * keeps using Tier 0. Nothing else depends on this plugin.
 */
@CapacitorPlugin(name = "KrishLinux")
class KrishLinuxPlugin : Plugin() {
    private val root by lazy { File(context.filesDir, "linux") }
    private val rootfs by lazy { File(root, "rootfs") }
    private val work by lazy { File(root, "work") }
    private val nativeDir by lazy { File(context.applicationInfo.nativeLibraryDir) }

    @PluginMethod fun status(call: PluginCall) {
        call.resolve(JSObject().put("installed", File(rootfs, "bin/busybox").exists()).put("arch", android.os.Build.SUPPORTED_ABIS.firstOrNull()))
    }

    private fun ensureInstalled() {
        if (File(rootfs, ".krish-ok").exists()) return
        if (android.os.Build.SUPPORTED_ABIS.none { it == "arm64-v8a" }) throw IllegalStateException("Linux sandbox needs a 64-bit ARM device")
        val bytes = context.assets.open(ROOTFS_ASSET).use { it.readBytes() }
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        check(sha == ROOTFS_SHA256) { "bundled rootfs failed checksum" }
        rootfs.deleteRecursively()
        rootfs.mkdirs()
        // Android's own `tar` is not guaranteed, so extract with the bundled TarGz helper.
        TarGz.extract(bytes.inputStream(), rootfs)
        File(rootfs, ".krish-ok").writeText(ROOTFS_SHA256)
    }

    @PluginMethod fun run(call: PluginCall) {
        val script = call.getString("script") ?: return call.reject("script required")
        val files = call.getObject("files") ?: JSONObject()
        Thread {
            try {
                ensureInstalled()
                work.deleteRecursively()
                work.mkdirs()
                for (name in files.keys()) {
                    val f = File(work, name).canonicalFile
                    require(f.path.startsWith(work.canonicalPath + File.separator)) { "unsafe path" }
                    f.parentFile?.mkdirs()
                    f.writeBytes(Base64.decode(files.getString(name), Base64.NO_WRAP))
                }
                val before = snapshot()
                val out = exec(script)
                val changed = JSObject()
                for ((rel, stat) in snapshot()) {
                    if (before[rel] != stat && stat.second <= MAX_FILE) {
                        changed.put(rel, Base64.encodeToString(File(work, rel).readBytes(), Base64.NO_WRAP))
                    }
                }
                work.deleteRecursively()
                call.resolve(JSObject().put("output", out).put("files", changed))
            } catch (e: Exception) {
                call.reject(e.message ?: "linux sandbox failed")
            }
        }.start()
    }

    /** relative path -> (mtime, size) for every file in the work dir. */
    private fun snapshot(): Map<String, Pair<Long, Long>> =
        work.walkTopDown().filter { it.isFile }.associate { it.relativeTo(work).path to (it.lastModified() to it.length()) }

    private fun exec(script: String): String {
        val proot = File(nativeDir, "libproot.so")
        if (!proot.exists()) throw IllegalStateException("proot is not packaged in this build")
        val tmp = File(root, "tmp").apply { mkdirs() }
        val cmd = listOf(
            proot.path, "--rootfs=${rootfs.path}", "--link2symlink", "--kill-on-exit", "-0",
            "--bind=${work.path}:/work", "--cwd=/work", "/bin/sh", "-c", script,
        )
        val pb = ProcessBuilder(cmd).redirectErrorStream(true)
        pb.environment().apply {
            clear()
            put("PROOT_LOADER", File(nativeDir, "libproot_loader.so").path)
            put("PROOT_TMP_DIR", tmp.path)
            put("LD_LIBRARY_PATH", nativeDir.path)
            put("HOME", "/root")
            put("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
            put("TERM", "dumb")
        }
        val p = try { pb.start() } catch (e: Exception) {
            throw IllegalStateException("Android blocked running the Linux sandbox on this device (${e.message}). Tier 0 still works.")
        }
        // Read on a worker so a command that floods output cannot block the timeout.
        val out = java.util.concurrent.Executors.newSingleThreadExecutor().submit<ByteArray> { p.inputStream.use { it.readNBytesCapped(MAX_OUTPUT) } }
        if (!p.waitFor(TIMEOUT_S, TimeUnit.SECONDS)) {
            p.destroyForcibly()
            throw IllegalStateException("command timed out after ${TIMEOUT_S}s")
        }
        return String(out.get(2, TimeUnit.SECONDS), Charsets.UTF_8)
    }

    /** Reads up to `max` bytes, then drains and discards the rest so the process never blocks on a full pipe. */
    private fun java.io.InputStream.readNBytesCapped(max: Int): ByteArray {
        val keep = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        while (true) {
            val n = read(chunk)
            if (n < 0) break
            if (keep.size() < max) keep.write(chunk, 0, minOf(n, max - keep.size()))
        }
        return keep.toByteArray()
    }

    private companion object {
        const val ROOTFS_ASSET = "linux/alpine-minirootfs-3.24.3-aarch64.tgz.bin"
        const val ROOTFS_SHA256 = "4d3f80afaebd447c5591a63a73bde380a149fe8b2d85488cafabb2ff97551f50"
        const val TIMEOUT_S = 30L
        const val MAX_OUTPUT = 20_000
        const val MAX_FILE = 20L * 1024 * 1024
    }
}
