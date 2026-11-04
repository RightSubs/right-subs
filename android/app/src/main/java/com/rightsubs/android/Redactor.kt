package com.rightsubs.android

import java.net.URLEncoder

/**
 * Defense in depth for the log: RightSubs does not log secrets, but anything written to
 * the log file (or shown on screen) passes through here first, so a stray error message
 * carrying a token never reaches it. Also scrubs the URL-encoded form of each value, and
 * Real-Debrid download links (raw or percent-encoded): anyone on the home IP can use them.
 */
class Redactor(secrets: Collection<String>) {
    private val needles: List<String> = secrets
        .filter { it.length >= MIN_LENGTH }
        .flatMap { listOf(it, URLEncoder.encode(it, "UTF-8")) }
        .distinct()
        .sortedByDescending { it.length }

    fun redact(line: String): String =
        needles.fold(line) { text, secret -> text.replace(secret, MASK) }.replace(RD_LINK, MASK)

    companion object {
        const val MASK = "***"
        /** Shorter values would mask ordinary words; real keys and passwords are longer. */
        const val MIN_LENGTH = 4

        private const val COLON = "(?::|%3A|%253A)"
        private const val SLASH = "(?:/|%2F|%252F)"
        /** `https://…real-debrid.com/d/…` up to the end of the token, in any of its encodings. */
        private val RD_LINK = Regex(
            "https?$COLON$SLASH$SLASH[^\\s\"'\\\\]*real-debrid\\.com$SLASH" + "d$SLASH[^\\s\"'\\\\]*",
            RegexOption.IGNORE_CASE,
        )
    }
}
