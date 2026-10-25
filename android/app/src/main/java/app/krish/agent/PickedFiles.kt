package app.krish.agent

import android.net.Uri
import android.os.SystemClock
import java.util.UUID

/** Maps opaque tokens to files the user picked in the system picker. Tokens are the only thing JS sees. */
object PickedFiles {
    private const val ARM_TTL_MS = 5_000L

    private class Armed(val uri: Uri, val origin: String, val expiresAt: Long)

    private val files = HashMap<String, Uri>()
    private var armed: Armed? = null

    @Synchronized fun put(uri: Uri): String = UUID.randomUUID().toString().also { files[it] = uri }
    @Synchronized fun get(token: String): Uri? = files[token]

    /** Authorizes exactly one file chooser, on this origin, within a few seconds. */
    @Synchronized fun arm(uri: Uri, origin: String) {
        armed = Armed(uri, origin, SystemClock.elapsedRealtime() + ARM_TTL_MS)
    }

    /** Returns the armed file only for the same origin and only once; otherwise null (chooser is cancelled). */
    @Synchronized fun take(origin: String): Uri? {
        val a = armed
        armed = null
        return if (a != null && a.origin == origin && SystemClock.elapsedRealtime() <= a.expiresAt) a.uri else null
    }

    @Synchronized fun disarm() { armed = null }

    @Synchronized fun clear() {
        files.clear()
        armed = null
    }
}
