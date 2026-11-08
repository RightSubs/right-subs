package com.rightsubs.android

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
import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Foreground service that keeps the RightSubs Node process alive, like the supervisor in
 * scripts/rightsubs.sh: restarts it after a crash, right away after a clean restart to
 * free memory (exit 75), and not at all on a config error (exit 78) until the user
 * saves new credentials. The addon itself only works when Stremio asks.
 */
class AddonService : Service() {
    @Volatile private var running = false
    @Volatile private var restartRequested = false
    @Volatile private var process: Process? = null
    private var supervisor: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        when (intent?.action) {
            ACTION_STOP -> {
                shutdown()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_RESTART -> if (supervisor?.isAlive == true) restartProcess() else supervise()
            else -> if (supervisor?.isAlive != true) supervise()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }

    private fun supervise() {
        running = true
        supervisor = Thread(::superviseLoop, "rightsubs-supervisor").apply { start() }
    }

    private fun restartProcess() {
        restartRequested = true
        val current = process
        if (current != null) terminate(current) else supervisor?.interrupt() // waiting to retry: go now
    }

    private fun shutdown() {
        running = false
        supervisor?.interrupt()
        process?.let(::terminate)
        if (AddonState.current.status != AddonState.Status.CONFIG_ERROR) AddonState.set(AddonState.Status.STOPPED)
    }

    private fun superviseLoop() {
        val runtime = NodeRuntime(this)
        val store = SecretStore(this)
        var failures = 0
        while (running) {
            val credentials = store.load()
            if (credentials == null) {
                AddonState.set(AddonState.Status.STOPPED, getString(R.string.status_needs_setup))
                break
            }
            restartRequested = false
            AddonState.set(if (failures == 0) AddonState.Status.STARTING else AddonState.Status.RESTARTING)
            val startedAt = SystemClock.elapsedRealtime()
            val output = ArrayDeque<String>()
            val code = try {
                runtime.prepare(credentials)
                runOnce(runtime, credentials, output)
            } catch (e: Exception) {
                val message = Redactor(credentials.secrets()).redact(e.message ?: e.javaClass.simpleName)
                runtime.log.note("failed", JSONObject().put("message", message).toString())
                AddonState.set(AddonState.Status.FAILED, message)
                EXIT_FAILED_TO_START
            }
            if (!running) break
            if (restartRequested) {
                runtime.log.note("restarting", """{"reason":"requested by the user"}""")
                failures = 0
                continue
            }
            when (code) {
                EXIT_CONFIG -> {
                    runtime.log.note("stopped", """{"reason":"invalid configuration"}""")
                    AddonState.set(AddonState.Status.CONFIG_ERROR, output.joinToString("\n"))
                    break
                }
                EXIT_CLEAN_RESTART -> {
                    runtime.log.note("restarting", """{"reason":"clean restart to free memory"}""")
                    pause(1_000)
                }
                else -> {
                    // A crash right after starting backs off up to a minute; one after a long run retries in 5 s.
                    failures = if (SystemClock.elapsedRealtime() - startedAt > 60_000) 1 else failures + 1
                    val delay = minOf(5_000L shl (failures - 1).coerceAtMost(4), 60_000L)
                    runtime.log.note("restarting", """{"exitCode":$code,"delayMs":$delay}""")
                    if (AddonState.current.status != AddonState.Status.FAILED) {
                        AddonState.set(AddonState.Status.RESTARTING, output.lastOrNull().orEmpty())
                    }
                    pause(delay)
                }
            }
        }
        running = false
        stopForegroundCompat()
        stopSelf()
    }

    /** Runs Node once and returns its exit code; [output] keeps the last lines (for config errors). */
    private fun runOnce(runtime: NodeRuntime, credentials: Credentials, output: ArrayDeque<String>): Int {
        val redactor = Redactor(credentials.secrets())
        val command = listOf(
            runtime.node.path,
            // Same flags as scripts/rightsubs.sh: small heap, GC when idle.
            "--max-old-space-size=128", "--max-semi-space-size=2", "--expose-gc",
            File(runtime.appDir, "dist/server.js").path,
            "--config", runtime.configFile.path,
        )
        val builder = ProcessBuilder(command).directory(runtime.appDir).redirectErrorStream(true)
        builder.environment().clear()
        builder.environment().putAll(runtime.environment(credentials))
        val started = builder.start()
        process = started
        started.outputStream.close()
        started.inputStream.bufferedReader().forEachLine { raw ->
            val line = redactor.redact(raw)
            runtime.log.append(line)
            output.addLast(line)
            if (output.size > 12) output.removeFirst()
            if (" server.started " in line) AddonState.set(AddonState.Status.RUNNING)
        }
        return started.waitFor().also { process = null }
    }

    /** SIGTERM (RightSubs closes cleanly), SIGKILL if it does not exit in 4 s. */
    private fun terminate(target: Process) {
        target.destroy()
        Thread {
            if (!target.waitFor(4, TimeUnit.SECONDS)) target.destroyForcibly()
        }.start()
    }

    private fun pause(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (_: InterruptedException) {
        }
    }

    private fun goForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_MIN),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_text, ConfigWriter.HOST, ConfigWriter.PORT))
            .setContentIntent(open)
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_SECRET)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopForegroundCompat() {
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    companion object {
        private const val CHANNEL = "addon"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_RESTART = "com.rightsubs.android.RESTART"
        private const val ACTION_STOP = "com.rightsubs.android.STOP"
        /** sysexits EX_CONFIG, from src/server.ts. */
        private const val EXIT_CONFIG = 78
        /** Idle with too much memory: RightSubs asks to be restarted (src/resources/idle.ts). */
        private const val EXIT_CLEAN_RESTART = 75
        private const val EXIT_FAILED_TO_START = -1

        fun start(context: Context) = send(context, null)
        fun restart(context: Context) = send(context, ACTION_RESTART)
        fun stop(context: Context) = send(context, ACTION_STOP)

        private fun send(context: Context, action: String?) {
            context.startForegroundService(Intent(context, AddonService::class.java).setAction(action))
        }
    }
}
