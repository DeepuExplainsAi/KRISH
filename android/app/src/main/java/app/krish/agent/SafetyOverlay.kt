package app.krish.agent

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The two things that must always be on top while the agent works: the Stop button and the confirmation popup.
 * Uses TYPE_ACCESSIBILITY_OVERLAY (owned by the accessibility service, no "draw over apps" permission). Both views refuse touches
 * when another window covers them (tapjacking), and a confirmation that nobody answers is a "no" after [CONFIRM_TIMEOUT_MS].
 */
class SafetyOverlay(private val service: AccessibilityService) {
    private val wm = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
    private val main = Handler(Looper.getMainLooper())
    private var stopView: View? = null
    private var confirmView: View? = null
    private var pending: ((Boolean) -> Unit)? = null
    private val timeout = Runnable { answer(false) }

    private fun params(gravity: Int, focusable: Boolean) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        if (focusable) 0 else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT,
    ).apply { this.gravity = gravity }

    private fun dp(v: Int) = (v * service.resources.displayMetrics.density).toInt()

    private fun round(color: Int, radius: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }

    /** Red Stop button, top right, shown while a task runs or is paused. */
    fun showStop(onStop: () -> Unit) = main.post {
        if (stopView != null) return@post
        val b = Button(service).apply {
            text = "■ STOP"
            setTextColor(Color.WHITE)
            background = round(Color.parseColor("#D32F2F"), 24)
            setPadding(dp(16), dp(8), dp(16), dp(8))
            filterTouchesWhenObscured = true
            setOnClickListener { onStop() }
        }
        wm.addView(b, params(Gravity.TOP or Gravity.END, false).apply { x = dp(8); y = dp(48) })
        stopView = b
    }

    fun hideStop() = main.post {
        stopView?.let { runCatching { wm.removeView(it) } }
        stopView = null
    }

    /** Asks the user. `callback(true)` only on an explicit tap on Allow. Only one question at a time; a second is answered "no". */
    fun confirm(title: String, detail: String, callback: (Boolean) -> Unit) = main.post {
        if (confirmView != null) return@post callback(false)
        pending = callback
        val box = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            background = round(Color.WHITE, 16)
            setPadding(dp(20), dp(16), dp(20), dp(12))
            filterTouchesWhenObscured = true
            addView(TextView(service).apply { text = title; textSize = 18f; setTextColor(Color.BLACK) })
            addView(TextView(service).apply { text = detail; textSize = 15f; setTextColor(Color.DKGRAY); setPadding(0, dp(8), 0, dp(12)) })
            addView(LinearLayout(service).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
                addView(Button(service).apply { text = "Deny"; setOnClickListener { answer(false) } })
                addView(Button(service).apply { text = "Allow"; setOnClickListener { answer(true) } })
            })
        }
        wm.addView(box, params(Gravity.CENTER, true).apply { width = (service.resources.displayMetrics.widthPixels * 0.88).toInt() })
        confirmView = box
        main.postDelayed(timeout, CONFIRM_TIMEOUT_MS)
    }

    private fun answer(ok: Boolean) {
        main.removeCallbacks(timeout)
        confirmView?.let { runCatching { wm.removeView(it) } }
        confirmView = null
        pending?.invoke(ok)
        pending = null
    }

    /** Service is going away: nothing stays on screen, any open question is a "no". */
    fun destroy() = main.post {
        answer(false)
        hideStop()
    }

    companion object {
        const val CONFIRM_TIMEOUT_MS = 60_000L
    }
}
