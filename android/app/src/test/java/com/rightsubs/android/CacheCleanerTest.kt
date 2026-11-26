package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class CacheCleanerTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun emptiesTheFolderButKeepsIt() {
        val cache = tmp.newFolder("cache")
        File(cache, "a.srt").writeText("one")
        File(cache, "b.srt").writeText("two")
        File(cache, "nested/deeper").mkdirs()
        File(cache, "nested/deeper/c.srt").writeText("three")

        val deleted = CacheCleaner.clear(cache)

        assertTrue(cache.isDirectory)
        assertEquals(0, cache.listFiles()!!.size)
        // a.srt, b.srt, nested, nested/deeper and nested/deeper/c.srt
        assertEquals(5, deleted)
    }

    @Test
    fun leavesWhatIsOutsideTheCacheAlone() {
        val data = tmp.newFolder(".rightsubs")
        val cache = File(data, "cache").apply { mkdirs() }
        File(cache, "a.srt").writeText("x")
        val log = File(data, "logs/rightsubs.log").apply { parentFile.mkdirs(); writeText("line") }
        val config = tmp.newFile("config.yaml").apply { writeText("host: 127.0.0.1") }

        CacheCleaner.clear(cache)

        assertEquals("line", log.readText())
        assertEquals("host: 127.0.0.1", config.readText())
    }

    @Test
    fun aMissingFolderIsNothingToDo() {
        assertEquals(0, CacheCleaner.clear(File(tmp.root, "nope")))
    }
}
