package app.krish.agent

import android.content.Context

/** Process-wide holder for the phone-control session, so the AccessibilityService, overlay and Capacitor plugin share one state. */
object PhoneRuntime {
    private const val PREFS = "krish_phone"
    private const val KEY_ALLOW = "allowlist"

    @Volatile private var instance: PhoneSession? = null

    @Synchronized fun session(context: Context): PhoneSession {
        instance?.let { return it }
        val app = context.applicationContext
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val s = PhoneSession(PackagePolicyHolder.get(app)) { prefs.edit().putStringSet(KEY_ALLOW, it).apply() }
        s.restoreAllowlist(prefs.getStringSet(KEY_ALLOW, emptySet()).orEmpty(), app.packageName)
        instance = s
        return s
    }
}
