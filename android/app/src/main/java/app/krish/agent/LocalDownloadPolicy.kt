package app.krish.agent

import java.net.URI
import java.util.Locale

/** URL validation is applied to every redirect, before opening any connection. */
internal object LocalDownloadPolicy {
    fun allowed(url: String): Boolean {
        val uri = try { URI(url) } catch (_: Exception) { return false }
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            (host == "huggingface.co" || host.endsWith(".hf.co")) &&
            (uri.port == -1 || uri.port == 443) && uri.userInfo == null && uri.fragment == null
    }
}
