package com.freekiosk

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log

/**
 * Digital Memorial: "Exit Kiosk Mode" has to really leave the kiosk. FreeKiosk is the persistent Home whenever the
 * kiosk is enabled (MainActivity.applyDefaultLauncherPolicy, so it comes back after a remote update), and the exit
 * keeps @kiosk_enabled on purpose (upstream #124), so the Home press after the exit opened FreeKiosk again and it
 * locked itself straight back in.
 *
 * The exit now records the current boot. Until the next reboot, a Home launch of MainActivity hands over to the
 * system launcher instead of starting the kiosk. Any other launch (app icon, ADB provisioning, the relaunch after a
 * remote update) clears it and the kiosk comes back as before. The Home policy itself is left alone.
 */
object MemorialAdminExit {
    private const val TAG = "MemorialAdminExit"
    private const val PREFS = "MemorialAdminExit"
    private const val KEY_BOOT = "exited_on_boot"

    fun markExited(context: Context) {
        prefs(context).edit().putInt(KEY_BOOT, bootCount(context)).apply()
    }

    /**
     * Called first thing on every MainActivity launch. Returns true when it handed over to the system launcher and
     * the activity must finish without starting the kiosk.
     */
    fun handOffIfExited(activity: Activity, intent: Intent?): Boolean {
        val prefs = prefs(activity)
        if (!prefs.contains(KEY_BOOT)) return false
        val isHomeLaunch = intent?.action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_HOME)
        if (!isHomeLaunch || prefs.getInt(KEY_BOOT, -1) != bootCount(activity)) {
            prefs.edit().remove(KEY_BOOT).apply()
            return false
        }
        val launcher = systemLauncher(activity) ?: return false
        return try {
            activity.startActivity(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                    .setClassName(launcher.first, launcher.second)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            true
        } catch (e: Exception) {
            Log.e(TAG, "Could not open the system launcher: ${e.message}")
            false
        }
    }

    private fun systemLauncher(context: Context): Pair<String, String>? {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return context.packageManager.queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY)
            .map { it.activityInfo }
            .firstOrNull { it.packageName != context.packageName }
            ?.let { it.packageName to it.name }
    }

    private fun bootCount(context: Context): Int =
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
