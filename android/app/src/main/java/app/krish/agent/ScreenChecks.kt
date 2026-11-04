package app.krish.agent

/** Small pure checks used by AgentAccessibilityService. Kept free of Android types so they can be tested on the JVM. */
object ScreenChecks {
    // android.text.InputType values, inlined so tests need no Android jar.
    private const val MASK_CLASS = 0xf
    private const val MASK_VARIATION = 0xff0
    private const val CLASS_TEXT = 1
    private const val CLASS_NUMBER = 2
    private const val TEXT_PASSWORD = 0x80
    private const val TEXT_VISIBLE_PASSWORD = 0x90
    private const val TEXT_WEB_PASSWORD = 0xe0
    private const val NUMBER_PASSWORD = 0x10

    /** A field that holds a secret even when `isPassword` is false (a "show password" toggle, a PIN pad, a web password). */
    fun isSecretInput(isPassword: Boolean, inputType: Int): Boolean {
        if (isPassword) return true
        val variation = inputType and MASK_VARIATION
        return when (inputType and MASK_CLASS) {
            CLASS_TEXT -> variation == TEXT_PASSWORD || variation == TEXT_VISIBLE_PASSWORD || variation == TEXT_WEB_PASSWORD
            CLASS_NUMBER -> variation == NUMBER_PASSWORD
            else -> false
        }
    }

    /**
     * A FLAG_SECURE window (or a failed capture) comes back as all-black / transparent. Samples a grid; any other pixel means real content.
     * Known trade-off: a genuinely all-black screen (a video loading) also reads as blank and stops the task: fail closed.
     */
    fun isBlank(width: Int, height: Int, pixelAt: (x: Int, y: Int) -> Int): Boolean {
        if (width <= 0 || height <= 0) return true
        val steps = 24
        for (i in 0 until steps) for (j in 0 until steps) {
            val p = pixelAt((width - 1) * i / (steps - 1), (height - 1) * j / (steps - 1))
            val alpha = p ushr 24
            if (alpha != 0 && (p and 0x00FFFFFF) != 0) return false
        }
        return true
    }

    /** Address-bar view ids of common browsers, to let the screen gate block account/payment sites inside an allowed browser. */
    fun urlBarId(pkg: String): String? = when (pkg) {
        "com.android.chrome", "com.chrome.beta", "com.brave.browser", "com.microsoft.emmx", "com.opera.browser" -> "$pkg:id/url_bar"
        "com.sec.android.app.sbrowser" -> "$pkg:id/location_bar_edit_text"
        "org.mozilla.firefox" -> "$pkg:id/mozac_browser_toolbar_url_view"
        else -> null
    }
}
