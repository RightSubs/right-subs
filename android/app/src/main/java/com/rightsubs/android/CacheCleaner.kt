package com.rightsubs.android

import java.io.File

/**
 * "Clear cache": empties the addon's cache folder (downloaded and translated subtitles, kept
 * searches, translations in progress, the quota counters). Nothing else: the credentials live
 * in [SecretStore], and the config, the log and the app itself are not in that folder.
 */
object CacheCleaner {
    /** Deletes what is inside [dir], keeping the folder itself. Returns how many files and folders were deleted. */
    fun clear(dir: File): Int {
        if (!dir.isDirectory) return 0
        var deleted = 0
        for (entry in dir.listFiles().orEmpty()) {
            // Children first (bottom-up), the entry itself last.
            deleted += entry.walkBottomUp().count { it.delete() }
        }
        return deleted
    }
}
