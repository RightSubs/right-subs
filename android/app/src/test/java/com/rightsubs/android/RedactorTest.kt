package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Test

class RedactorTest {
    @Test
    fun masksRawAndUrlEncodedSecrets() {
        val redactor = Redactor(listOf("p@ss word", "TOKEN123456", ""))
        assertEquals("login *** ok", redactor.redact("login p@ss word ok"))
        assertEquals("url ?t=*** and ***", redactor.redact("url ?t=TOKEN123456 and p%40ss+word"))
    }

    @Test
    fun masksRealDebridLinksInAnyEncoding() {
        val redactor = Redactor(emptyList())
        assertEquals(
            "{\"url\":\"***\"}",
            redactor.redact("{\"url\":\"https://45-4.download.real-debrid.com/d/ABCDEF123456/Movie%20(2010).mkv\"}"),
        )
        assertEquals(
            "{\"filename\":\"***\"}",
            redactor.redact("{\"filename\":\"https%3A%2F%2F45-4.download.real-debrid.com%2Fd%2FABCDEF123456%2FMovie%2520(2010).mkv\"}"),
        )
        assertEquals("page *** end", redactor.redact("page https://real-debrid.com/d/ABCDEF123456 end"))
        assertEquals("api https://api.real-debrid.com/rest/1.0/downloads", redactor.redact("api https://api.real-debrid.com/rest/1.0/downloads"))
    }

    @Test
    fun ignoresValuesTooShortToMask() {
        assertEquals("a b c", Redactor(listOf("a", "b")).redact("a b c"))
    }
}
