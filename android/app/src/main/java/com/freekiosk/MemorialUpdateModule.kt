package com.freekiosk

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Digital Memorial: remote update of this app. The display page passes on the release the server publishes
 * ({versionCode, url, sha256}); this downloads it, checks it (https, SHA-256, same package, newer version, signed
 * with the same key as the installed app) and installs it silently as Device Owner. BootReceiver relaunches the app
 * after MY_PACKAGE_REPLACED. Upstream's UpdateModule (GitHub releases, notifications) stays disabled.
 */
class MemorialUpdateModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    companion object {
        private const val TAG = "MemorialUpdate"
        private const val MAX_BYTES = 300L * 1024 * 1024
        private val busy = AtomicBoolean(false)
    }

    override fun getName() = "MemorialUpdateModule"

    override fun getConstants(): MutableMap<String, Any> {
        val info = installedInfo()
        return mutableMapOf("versionCode" to versionCodeOf(info).toDouble(), "versionName" to (info.versionName ?: ""))
    }

    @ReactMethod
    fun install(url: String, sha256: String, versionCode: Double, promise: Promise) {
        val target = versionCode.toLong()
        if (target <= versionCodeOf(installedInfo())) {
            promise.resolve("current")
            return
        }
        if (!url.startsWith("https://") || !Regex("^[0-9a-fA-F]{64}$").matches(sha256)) {
            promise.reject("INVALID", "Update needs an https URL and a SHA-256")
            return
        }
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            promise.reject("NOT_DEVICE_OWNER", "Silent updates need Device Owner")
            return
        }
        if (!busy.compareAndSet(false, true)) {
            promise.resolve("busy")
            return
        }
        Thread {
            val file = File(context.cacheDir, "memorial-update.apk")
            try {
                val digest = download(url, file)
                if (!digest.equals(sha256, ignoreCase = true)) throw IllegalStateException("SHA-256 mismatch")
                verifyArchive(file, target)
                commit(file)
                android.util.Log.i(TAG, "Installing versionCode $target")
                promise.resolve("installing")
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Update failed: ${e.message}")
                file.delete()
                promise.reject("FAILED", e.message ?: "Update failed")
            } finally {
                busy.set(false)
            }
        }.start()
    }

    /** Downloads to `file` and returns its SHA-256 (hex). */
    private fun download(url: String, file: File): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 30_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = true
        try {
            if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
            val sha = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) throw IllegalStateException("APK too large")
                        sha.update(buffer, 0, n)
                        output.write(buffer, 0, n)
                    }
                }
            }
            return sha.digest().joinToString("") { "%02x".format(it) }
        } finally {
            connection.disconnect()
        }
    }

    /** Same package, the announced version, and the same signing certificate as the app installed now. */
    private fun verifyArchive(file: File, versionCode: Long) {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
        else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.absolutePath, flags)
            ?: throw IllegalStateException("Not an APK")
        if (archive.packageName != context.packageName) throw IllegalStateException("Wrong package ${archive.packageName}")
        if (versionCodeOf(archive) != versionCode) throw IllegalStateException("Wrong version ${versionCodeOf(archive)}")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val installed = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
            val sha = { bytes: ByteArray -> MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) } }
            val mine = installed.signingInfo?.apkContentsSigners?.map { sha(it.toByteArray()) }?.toSet()
            val theirs = archive.signingInfo?.apkContentsSigners?.map { sha(it.toByteArray()) }?.toSet()
            if (mine.isNullOrEmpty() || mine != theirs) throw IllegalStateException("Signed with another key")
        }
        // Below API 28, PackageInstaller still refuses an update signed with another key.
    }

    private fun commit(file: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("package", 0, file.length()).use { output ->
                file.inputStream().use { it.copyTo(output) }
                session.fsync(output)
            }
            val intent = Intent(context, UpdateInstallReceiver::class.java)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val pending = PendingIntent.getBroadcast(context, 2001, intent, flags)
            session.commit(pending.intentSender)
        }
    }

    private fun installedInfo(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, 0)

    private fun versionCodeOf(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
        else @Suppress("DEPRECATION") info.versionCode.toLong()
}
