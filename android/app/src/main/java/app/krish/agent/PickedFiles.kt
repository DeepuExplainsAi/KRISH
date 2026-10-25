package app.krish.agent

import android.net.Uri
import java.util.UUID

/** Maps opaque tokens to files the user picked in the system picker. Tokens are the only thing JS sees. */
object PickedFiles {
    private val files = HashMap<String, Uri>()
    @Volatile var pendingUpload: Uri? = null

    @Synchronized fun put(uri: Uri): String = UUID.randomUUID().toString().also { files[it] = uri }
    @Synchronized fun get(token: String): Uri? = files[token]
    @Synchronized fun clear() = files.clear()
}
