package com.rightsubs.android

import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.BindException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import kotlin.concurrent.thread

/**
 * Temporary credentials form on the home network, so they can be typed (or pasted) on a
 * phone instead of with the TV remote. It exists only while the TV shows it and closes
 * after one accepted submission, [LIFETIME_MS] or [MAX_WRONG_CODES] wrong codes. The
 * code shown on the TV (also inside the QR) proves the sender can see the screen.
 *
 * Plain HTTP inside the home Wi-Fi, which encrypts it against anyone outside (user's
 * choice: HTTPS would need a self-signed certificate and a browser warning). Values are
 * never logged nor sent back in a page.
 */
class PhoneSetupServer(
    private val address: InetAddress,
    /** Whether credentials are stored already: blank fields then keep them. */
    private val editing: Boolean,
    /** Validates and stores the form; runs on the server thread. */
    private val submit: (CredentialsForm) -> Validation,
    /** Called once, on the server thread, when the server stops by itself. */
    private val closed: (Ending) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    enum class Ending { SAVED, EXPIRED, TOO_MANY_ATTEMPTS }

    val code: String = (1..6).map { RANDOM.nextInt(10) }.joinToString("")
    private val socket: ServerSocket = bind()
    private val hostPort = "${address.hostAddress}:${socket.localPort}"
    private val deadline = now() + LIFETIME_MS
    @Volatile private var stopped = false
    private var wrongCodes = 0

    /** What to type in the phone's browser. */
    val url: String get() = "http://$hostPort"

    /** What the QR holds: the address with the code, which the form then fills in. */
    val qrContent: String get() = "http://$hostPort/?c=$code"

    fun start() {
        thread(name = "phone-setup", isDaemon = true) { serve() }
    }

    /** Closes the form without calling [closed] (the TV left the screen or cancelled). */
    fun stop() {
        stopped = true
        runCatching { socket.close() }
    }

    private fun bind(): ServerSocket = try {
        ServerSocket(PORT, BACKLOG, address)
    } catch (_: BindException) {
        ServerSocket(0, BACKLOG, address)
    }

    private fun serve() {
        var ending: Ending? = null
        try {
            socket.soTimeout = 1000
            while (ending == null && !stopped) {
                if (now() > deadline) {
                    ending = Ending.EXPIRED
                    break
                }
                val client = try {
                    socket.accept()
                } catch (_: SocketTimeoutException) {
                    continue
                }
                ending = client.use { runCatching { handle(it) }.getOrNull() }
            }
        } catch (_: IOException) {
            // Socket closed by stop().
        } finally {
            runCatching { socket.close() }
        }
        if (ending != null && !stopped) closed(ending)
    }

    private fun handle(client: Socket): Ending? {
        client.soTimeout = 10_000
        val input = BufferedInputStream(client.getInputStream())
        val request = readLine(input)?.split(' ') ?: return null
        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = readLine(input) ?: return null
            if (line.isEmpty()) break
            if (headers.size >= MAX_HEADERS) return null
            headers[line.substringBefore(':').trim().lowercase()] = line.substringAfter(':', "").trim()
        }
        val method = request.getOrNull(0)
        val target = request.getOrNull(1).orEmpty()
        // Only requests made to this address: a web page elsewhere cannot reach the form
        // through a domain that resolves here (DNS rebinding).
        if (headers["host"] != hostPort) return respond(client, "400 Bad Request", page("Endereço inválido."))
        if (target.substringBefore('?') != "/") return respond(client, "404 Not Found", page("Página não encontrada."))

        return when (method) {
            "GET" -> {
                val prefilled = parseForm(target.substringAfter('?', ""))["c"]?.takeIf { CODE.matches(it) }
                respond(client, "200 OK", form(prefilled, emptyList()))
            }
            "POST" -> {
                val length = headers["content-length"]?.toIntOrNull()
                if (length == null || length !in 0..MAX_BODY) return respond(client, "413 Payload Too Large", page("Envio inválido."))
                val body = ByteArray(length)
                var read = 0
                while (read < length) {
                    val n = input.read(body, read, length - read)
                    if (n < 0) return null
                    read += n
                }
                post(client, parseForm(String(body, Charsets.UTF_8)))
            }
            else -> respond(client, "405 Method Not Allowed", page("Método não permitido."))
        }
    }

    private fun post(client: Socket, fields: Map<String, String>): Ending? {
        val typed = fields["code"].orEmpty().trim()
        if (!MessageDigest.isEqual(typed.toByteArray(), code.toByteArray())) {
            wrongCodes++
            if (wrongCodes >= MAX_WRONG_CODES) {
                respond(client, "403 Forbidden", page("Código errado vezes demais. Gere outro formulário na TV."))
                return Ending.TOO_MANY_ATTEMPTS
            }
            return respond(client, "200 OK", form(null, listOf("Código errado: confira o que aparece na TV.")))
        }
        val credentials = CredentialsForm(
            apiKey = fields["apiKey"].orEmpty(),
            user = fields["user"].orEmpty(),
            password = fields["password"].orEmpty(),
            realDebridToken = fields["rdToken"].orEmpty(),
            deepLApiKey = fields["deepLKey"].orEmpty(),
        )
        return when (val result = submit(credentials)) {
            is Validation.Ok -> {
                respond(client, "200 OK", page("Pronto! As credenciais foram salvas na TV e o addon está reiniciando. Pode fechar esta página."))
                Ending.SAVED
            }
            // The code was right: keep it filled in, but never send a typed value back.
            is Validation.Invalid -> respond(client, "200 OK", form(code, result.errors))
        }
    }

    private fun respond(client: Socket, status: String, html: String): Ending? {
        val body = html.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $status\r\n" +
            "Content-Type: text/html; charset=utf-8\r\n" +
            "Content-Length: ${body.size}\r\n" +
            "Cache-Control: no-store\r\n" +
            "Referrer-Policy: no-referrer\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'\r\n" +
            "Connection: close\r\n\r\n"
        val output = client.getOutputStream()
        output.write(head.toByteArray(Charsets.ISO_8859_1))
        output.write(body)
        output.flush()
        return null
    }

    private fun form(code: String?, errors: List<String>): String {
        val keep = if (editing) "<p class=\"hint\">Campo em branco mantém o valor salvo na TV.</p>" else ""
        val problems = if (errors.isEmpty()) "" else "<ul class=\"errors\">${errors.joinToString("") { "<li>${escape(it)}</li>" }}</ul>"
        return page(
            """
            <p>As credenciais vão direto para a TV pela sua rede Wi-Fi e ficam guardadas só nela.</p>
            $problems
            <form method="post" action="/" autocomplete="off">
              <label>Código que aparece na TV
                <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required value="${code.orEmpty()}"></label>
              <label>API key da OpenSubtitles
                <input name="apiKey" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
              <label>Nome de usuário da OpenSubtitles (não o e-mail)
                <input name="user" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
              <label>Senha da OpenSubtitles
                <input name="password" type="password"></label>
              <label>Token do Real-Debrid (opcional)
                <input name="rdToken" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
              <label>Chave do DeepL (opcional)
                <input name="deepLKey" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
              $keep
              <button>Enviar para a TV</button>
            </form>
            """.trimIndent(),
        )
    }

    private fun page(content: String) = """
        <!doctype html>
        <html lang="pt-BR"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>RightSubs</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 480px; background: #121417; color: #eceff1; }
          h1 { font-size: 1.4em; color: #7fd1ae; }
          label { display: block; margin-top: 14px; }
          input { display: block; box-sizing: border-box; width: 100%; margin-top: 4px; padding: 10px; font-size: 16px; border-radius: 6px; border: 1px solid #a0a8b0; background: #1e2227; color: #eceff1; }
          button { margin-top: 20px; width: 100%; padding: 12px; font-size: 16px; border: 0; border-radius: 6px; background: #7fd1ae; color: #121417; }
          .hint { color: #a0a8b0; }
          .errors { color: #ff8a80; }
        </style></head>
        <body><h1>RightSubs</h1>
        $content
        </body></html>
    """.trimIndent()

    companion object {
        const val PORT = 7001
        const val LIFETIME_MS = 10 * 60 * 1000L
        const val MAX_WRONG_CODES = 5
        private const val BACKLOG = 4
        private const val MAX_HEADERS = 50
        private const val MAX_LINE = 8192
        private const val MAX_BODY = 16 * 1024
        private val CODE = Regex("^[0-9]{6}$")
        private val RANDOM = SecureRandom()

        /** This device's address on the home network (Wi-Fi or cable), if it has one. */
        fun homeNetworkAddress(): InetAddress? = runCatching {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .sortedBy { if (it.name.startsWith("wlan") || it.name.startsWith("eth")) 0 else 1 }
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
        }.getOrNull()

        internal fun parseForm(text: String): Map<String, String> = text.split('&').filter { it.isNotEmpty() }.associate { pair ->
            val decode = { value: String -> runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault("") }
            decode(pair.substringBefore('=')) to decode(pair.substringAfter('=', ""))
        }

        private fun escape(text: String) =
            text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

        /** One CRLF-terminated header line (ISO-8859-1), or null at the end of the stream or when too long. */
        private fun readLine(input: InputStream): String? {
            val bytes = java.io.ByteArrayOutputStream()
            while (true) {
                val b = input.read()
                if (b < 0) return null
                if (b == '\n'.code) break
                if (bytes.size() >= MAX_LINE) return null
                bytes.write(b)
            }
            return bytes.toString("ISO-8859-1").trimEnd('\r')
        }
    }
}
