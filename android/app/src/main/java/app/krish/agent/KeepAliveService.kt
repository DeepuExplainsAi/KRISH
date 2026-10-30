// Built with TODOforAI — https://todofor.ai
package app.krish.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Keeps Krish running while tasks work in the background (screen off, another app in front).
 * Shared by agent tasks and model downloads; it stops only after both have released their leases.
 * Holds a CPU wake lock with a safety timeout; it carries no task data and does nothing else.
 */
class KeepAliveService : Service() {
    private var lock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Tasks running", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val note: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Krish is working")
            .setContentText("A task or model download is running. Tap to open.")
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(ID, note)
        if (lock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "krish:tasks").apply { acquire(WAKE_LOCK_MAX_MS) }
        }
        return START_NOT_STICKY
    }

    /** Android 15+ limits how long a data-sync service may run in the background. At the limit it must stop at once (the task goes on, unprotected, while the app is in front). */
    override fun onTimeout(startId: Int, fgsType: Int) {
        synchronized(Companion) { owners.clear() }
        stopSelf()
    }

    override fun onDestroy() {
        lock?.let { if (it.isHeld) it.release() }
        lock = null
        super.onDestroy()
    }

    companion object {
        private val owners = mutableSetOf<String>()

        /** Start once per owner; a refused start leaves no lease. Uses only application context. */
        @Synchronized fun acquire(context: Context, owner: String): Boolean {
            if (owner in owners) return true
            val app = context.applicationContext
            return try {
                if (owners.isEmpty()) androidx.core.content.ContextCompat.startForegroundService(app, Intent(app, KeepAliveService::class.java))
                owners.add(owner)
                true
            } catch (_: Exception) {
                false
            }
        }

        /** A finished download must not stop an active agent, or vice versa. */
        @Synchronized fun release(context: Context, owner: String) {
            if (!owners.remove(owner)) return
            if (owners.isEmpty()) runCatching { context.applicationContext.stopService(Intent(context.applicationContext, KeepAliveService::class.java)) }
        }


        private const val CHANNEL = "working"
        private const val ID = 4207
        private const val WAKE_LOCK_MAX_MS = 4L * 60 * 60 * 1000
    }
}
