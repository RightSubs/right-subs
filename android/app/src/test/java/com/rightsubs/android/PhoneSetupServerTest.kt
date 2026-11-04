package com.rightsubs.android

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.Socket
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class PhoneSetupServerTest {
    private val endings = LinkedBlockingQueue<PhoneSetupServer.Ending>()
    private val received = mutableListOf<CredentialsForm>()
    private var clock = 0L
    private var started: PhoneSetupServer? = null
    private val server get() = started!!

    private fun start(valid: Boolean = true): PhoneSetupServer {
        started = PhoneSetupServer(
            address = InetAddress.getLoopbackAddress(),
            editing = false,
            submit = { form ->
                received += form
                if (valid) Validation.Ok(Credentials("k", "u", "p", "")) else Validation.Invalid(listOf("Informe a senha <da> OpenSubtitles."))
            },
            closed = { endings += it },
            now = { clock },
        )
        server.start()
        return server
    }

    @After
    fun stop() {
        started?.stop()
    }

    private fun get(path: String): Pair<Int, String> {
        val connection = URL(server.url + path).openConnection() as HttpURLConnection
        return connection.responseCode to (connection.errorStream ?: connection.inputStream).bufferedReader().readText()
    }

    private fun post(fields: Map<String, String>): Pair<Int, String> {
        val connection = URL(server.url + "/").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        connection.outputStream.use { out ->
            out.write(fields.entries.joinToString("&") { "${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" }.toByteArray())
        }
        return connection.responseCode to (connection.errorStream ?: connection.inputStream).bufferedReader().readText()
    }

    @Test
    fun servesTheFormWithTheCodeFromTheQr() {
        start()
        assertTrue(server.qrContent.startsWith(server.url))
        assertTrue(server.qrContent.endsWith("/?c=${server.code}"))
        assertTrue(Regex("^[0-9]{6}$").matches(server.code))
        val (status, html) = get("/?c=${server.code}")
        assertEquals(200, status)
        assertTrue("value=\"${server.code}\"" in html)
        assertTrue("name=\"password\" type=\"password\"" in html)
        // Anything but six digits is not echoed into the page.
        assertFalse("<script>" in get("/?c=%3Cscript%3E").second)
        assertEquals(404, get("/other").first)
    }

    @Test
    fun savesWithTheRightCodeAndCloses() {
        start()
        val (status, html) = post(mapOf("code" to server.code, "apiKey" to "KEY", "user" to "me", "password" to "a b&c", "rdToken" to ""))
        assertEquals(200, status)
        assertTrue("Pronto" in html)
        assertEquals(PhoneSetupServer.Ending.SAVED, endings.poll(5, TimeUnit.SECONDS))
        assertEquals("a b&c", received.single().password)
        assertEquals("KEY", received.single().apiKey)
    }

    @Test
    fun invalidValuesShowTheErrorsEscapedAndNeverTheValues() {
        start(valid = false)
        val (_, html) = post(mapOf("code" to server.code, "apiKey" to "SECRET-KEY-VALUE", "user" to "me", "password" to ""))
        assertTrue("Informe a senha &lt;da&gt; OpenSubtitles." in html)
        assertFalse("SECRET-KEY-VALUE" in html)
        assertNull("still open", endings.poll(300, TimeUnit.MILLISECONDS))
    }

    @Test
    fun aWrongCodeIsRefusedAndTooManyClose() {
        start()
        val wrong = if (server.code == "000000") "111111" else "000000"
        repeat(PhoneSetupServer.MAX_WRONG_CODES - 1) {
            assertTrue("Código errado" in post(mapOf("code" to wrong, "apiKey" to "K")).second)
        }
        assertTrue(received.isEmpty())
        assertEquals(403, post(mapOf("code" to wrong)).first)
        assertEquals(PhoneSetupServer.Ending.TOO_MANY_ATTEMPTS, endings.poll(5, TimeUnit.SECONDS))
    }

    @Test
    fun requestsForAnotherHostAreRefused() {
        start()
        val port = server.url.substringAfterLast(':').toInt()
        Socket(InetAddress.getLoopbackAddress(), port).use { socket ->
            socket.getOutputStream().write("GET / HTTP/1.1\r\nHost: evil.example:$port\r\n\r\n".toByteArray())
            val reply = socket.getInputStream().bufferedReader().readLine()
            assertEquals("HTTP/1.1 400 Bad Request", reply)
        }
    }

    @Test
    fun expiresAfterItsLifetime() {
        start()
        clock = PhoneSetupServer.LIFETIME_MS + 1
        assertEquals(PhoneSetupServer.Ending.EXPIRED, endings.poll(5, TimeUnit.SECONDS))
    }

    @Test
    fun parsesUrlEncodedForms() {
        assertEquals(mapOf("a" to "1 2", "b" to "x=y&", "c" to ""), PhoneSetupServer.parseForm("a=1+2&b=x%3Dy%26&c"))
    }
}
