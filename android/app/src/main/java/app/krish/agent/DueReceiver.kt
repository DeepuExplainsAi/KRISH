package app.krish.agent

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Fires from AlarmManager when a scheduled task, macro or the morning brief is due (or a macro failed). It never runs anything in the
 * background: confirmations need the user, so it only posts a "tap to open" notification, and only if the notification permission was
 * already granted. The app then lists what is due and the user taps Run.
 */
class DueReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!granted) return
        val id = intent.getStringExtra(KEY_ID).orEmpty()
        val title = intent.getStringExtra(KEY_TITLE).orEmpty()
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Due items", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title.ifEmpty { "Something is due" })
            .setContentText("Tap to open and review")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        nm.notify(id.hashCode(), n)
    }

    companion object {
        const val KEY_ID = "id"
        const val KEY_TITLE = "title"
        private const val CHANNEL = "due"
    }
}
