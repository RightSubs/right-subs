package com.rightsubs.android

import java.io.File
import java.time.Instant

/**
 * The service log, like scripts/rightsubs.sh on the box: one line per event, rotated at
 * 2 MB keeping one previous file. Lives in the app's private storage.
 */
class LogFile(private val file: File, private val mirror: File? = null) {
    init {
        // The mirror starts with the history so far (e.g. after updating to a debug build).
        if (mirror != null && !mirror.exists() && file.exists()) {
            mirror.parentFile?.mkdirs()
            file.copyTo(mirror)
        }
    }

    @Synchronized
    fun append(line: String) {
        for (target in listOfNotNull(file, mirror)) {
            target.parentFile?.mkdirs()
            if (target.length() > MAX_BYTES) target.renameTo(File(target.path + ".1"))
            target.appendText(line + "\n")
        }
    }

    /** Supervisor events, in the same format as RightSubs' own lines. */
    fun note(event: String, json: String = "{}") = append("${Instant.now()} INFO  supervisor.$event $json")

    fun tail(lines: Int): List<String> {
        if (!file.exists()) return emptyList()
        return file.useLines { it.toList().takeLast(lines) }
    }

    private companion object {
        const val MAX_BYTES = 2L * 1024 * 1024
    }
}
