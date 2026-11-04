package com.rightsubs.android

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

/** What the screen shows about the addon process. Listeners run on the main thread. */
object AddonState {
    enum class Status { STOPPED, STARTING, RUNNING, RESTARTING, CONFIG_ERROR, FAILED }

    class Snapshot(val status: Status, val detail: String = "")

    @Volatile
    var current = Snapshot(Status.STOPPED)
        private set

    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<(Snapshot) -> Unit>()

    fun set(status: Status, detail: String = "") {
        val snapshot = Snapshot(status, detail)
        current = snapshot
        main.post { listeners.forEach { it(snapshot) } }
    }

    fun listen(listener: (Snapshot) -> Unit) {
        listeners += listener
        listener(current)
    }

    fun unlisten(listener: (Snapshot) -> Unit) {
        listeners -= listener
    }
}
