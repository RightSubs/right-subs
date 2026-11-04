package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class QrCodeTest {
    private val url = "http://192.168.100.200:7001/?c=123456"

    @Test
    fun picksTheSmallestVersionThatFits() {
        assertEquals(21, QrCode.encode("http://x").size) // version 1: up to 14 bytes at level M
        assertEquals(29, QrCode.encode(url).size) // 38 bytes: version 3
        assertEquals(57, QrCode.encode("x".repeat(200)).size) // version 10
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesWhatDoesNotFitVersion10() {
        QrCode.encode("x".repeat(214))
    }

    @Test
    fun drawsTheFinderAndTimingPatterns() {
        val qr = QrCode.encode(url)
        for ((cx, cy) in listOf(3 to 3, qr.size - 4 to 3, 3 to qr.size - 4)) {
            for (d in -3..3) {
                assertTrue(qr.isDark(cx + d, cy - 3) && qr.isDark(cx + d, cy + 3))
                assertTrue(qr.isDark(cx - 3, cy + d) && qr.isDark(cx + 3, cy + d))
            }
            assertTrue(qr.isDark(cx, cy))
            assertTrue(!qr.isDark(cx - 2, cy) && !qr.isDark(cx + 2, cy))
        }
        for (i in 8 until qr.size - 8) assertEquals(i % 2 == 0, qr.isDark(i, 6))
        assertTrue("dark module", qr.isDark(8, qr.size - 8))
    }

    @Test
    fun bothCopiesOfTheFormatInformationAgree() {
        val qr = QrCode.encode(url)
        val first = (0..5).map { qr.isDark(8, it) } + listOf(qr.isDark(8, 7), qr.isDark(8, 8), qr.isDark(7, 8)) + (9..14).map { qr.isDark(14 - it, 8) }
        val second = (0..7).map { qr.isDark(qr.size - 1 - it, 8) } + (8..14).map { qr.isDark(8, qr.size - 15 + it) }
        assertEquals(first, second)
    }

    /** For an external check with a real decoder (zbarimg): the build passes the path. */
    @Test
    fun writesASampleForAnExternalDecoder() {
        val path = System.getProperty("rightsubs.qrSample") ?: return
        val qr = QrCode.encode(url)
        val border = 4
        val scale = 8
        val side = (qr.size + border * 2) * scale
        val rows = (0 until side).joinToString("\n") { py ->
            (0 until side).joinToString(" ") { px ->
                val x = px / scale - border
                val y = py / scale - border
                if (x in 0 until qr.size && y in 0 until qr.size && qr.isDark(x, y)) "1" else "0"
            }
        }
        File(path).writeText("P1\n$side $side\n$rows\n")
    }
}
