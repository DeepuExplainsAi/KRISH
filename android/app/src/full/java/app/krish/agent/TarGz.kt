package app.krish.agent

import java.io.File
import java.io.InputStream
import java.util.zip.GZIPInputStream

/**
 * Minimal ustar/pax tar.gz extractor (files, directories, symlinks, hardlinks) with path-traversal checks.
 * Written here instead of pulling a library; the Alpine minirootfs only uses these entry types.
 */
object TarGz {
    fun extract(input: InputStream, dest: File) {
        val tar = GZIPInputStream(input.buffered())
        val header = ByteArray(512)
        val root = dest.canonicalFile
        var longName: String? = null
        var longLink: String? = null
        while (true) {
            if (!readFully(tar, header)) break
            if (header.all { it == 0.toByte() }) break
            val type = header[156].toInt().toChar()
            val size = octal(header, 124, 12)
            var name = longName ?: (cString(header, 345, 155).let { if (it.isNotEmpty()) "$it/" else "" } + cString(header, 0, 100))
            val link = longLink ?: cString(header, 157, 100)
            longName = null; longLink = null
            val mode = octal(header, 100, 8).toInt()
            when (type) {
                'L' -> { longName = String(readBytes(tar, size)).trimEnd('\u0000'); skipPad(tar, size); continue }
                'K' -> { longLink = String(readBytes(tar, size)).trimEnd('\u0000'); skipPad(tar, size); continue }
                'x', 'g' -> { readBytes(tar, size); skipPad(tar, size); continue }
            }
            name = name.trimStart('/').removePrefix("./")
            if (name.isEmpty()) { skip(tar, size); skipPad(tar, size); continue }
            val out = File(root, name)
            require(out.canonicalFile.path.startsWith(root.path)) { "unsafe tar path: $name" }
            when (type) {
                '5' -> out.mkdirs()
                '2' -> {
                    out.parentFile?.mkdirs()
                    java.nio.file.Files.deleteIfExists(out.toPath())
                    java.nio.file.Files.createSymbolicLink(out.toPath(), java.nio.file.Paths.get(link)) // target stays inside proot's view
                }
                '1' -> {
                    val target = File(root, link.trimStart('/').removePrefix("./"))
                    require(target.canonicalFile.path.startsWith(root.path)) { "unsafe tar link: $link" }
                    out.parentFile?.mkdirs()
                    target.copyTo(out, overwrite = true)
                    if (mode and 0b001_001_001 != 0) out.setExecutable(true, false)
                }
                '0', '\u0000' -> {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { o -> copy(tar, o, size) }
                    out.setReadable(true, false)
                    if (mode and 0b001_001_001 != 0) out.setExecutable(true, false)
                    if (mode and 0b010_000_000 != 0) out.setWritable(true, true)
                    skipPad(tar, size)
                    continue
                }
                else -> { /* devices, fifos: skipped (proot provides /dev) */ }
            }
            skip(tar, size); skipPad(tar, size)
        }
    }

    private fun cString(b: ByteArray, off: Int, len: Int): String {
        var end = off
        while (end < off + len && b[end] != 0.toByte()) end++
        return String(b, off, end - off, Charsets.UTF_8)
    }

    private fun octal(b: ByteArray, off: Int, len: Int): Long =
        cString(b, off, len).trim().ifEmpty { "0" }.toLong(8)

    private fun readFully(i: InputStream, b: ByteArray): Boolean {
        var n = 0
        while (n < b.size) {
            val r = i.read(b, n, b.size - n)
            if (r < 0) {
                if (n == 0) return false // clean end of archive
                throw java.io.EOFException("truncated tar")
            }
            n += r
        }
        return true
    }

    private fun readBytes(i: InputStream, n: Long): ByteArray = ByteArray(n.toInt()).also { if (n > 0) readFully(i, it) }
    private fun skip(i: InputStream, n: Long) { var left = n; val buf = ByteArray(8192); while (left > 0) { val r = i.read(buf, 0, minOf(left, buf.size.toLong()).toInt()); if (r < 0) throw java.io.EOFException(); left -= r } }
    private fun skipPad(i: InputStream, size: Long) = skip(i, (512 - size % 512) % 512)
    private fun copy(i: InputStream, o: java.io.OutputStream, n: Long) { var left = n; val buf = ByteArray(8192); while (left > 0) { val r = i.read(buf, 0, minOf(left, buf.size.toLong()).toInt()); if (r < 0) throw java.io.EOFException(); o.write(buf, 0, r); left -= r } }
}
