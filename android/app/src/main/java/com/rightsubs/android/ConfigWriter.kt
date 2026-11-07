package com.rightsubs.android

/**
 * Turns RightSubs' config.example.yaml into the config.yaml the app runs with — the same
 * changes scripts/configure-termux.sh makes on the box. No secret is ever written here:
 * the file keeps the `${VAR}` placeholders, filled from the process environment.
 */
object ConfigWriter {
    const val HOST = "127.0.0.1"
    const val PORT = 7000

    fun render(template: String, realDebrid: Boolean, deepL: Boolean = false, languages: LanguageChoice = Languages.DEFAULT): String {
        var lines = template.lines()
        // Only apps on this device reach the addon.
        lines = set(lines, listOf("server"), "host", HOST)
        lines = set(lines, listOf("server"), "port", PORT.toString())
        lines = set(lines, listOf("languages"), "primary", languages.primary)
        // Without a secondary language the key goes away (commented out): RightSubs treats it as optional.
        lines = if (languages.secondary != null) {
            set(lines, listOf("languages"), "secondary", languages.secondary)
        } else {
            replace(lines, listOf("languages"), "secondary", "  # secondary: (none)")
        }
        lines = set(lines, listOf("sync"), "referenceLanguages", "[${languages.reference.orEmpty()}]")
        lines = set(lines, listOf("streams", "realdebrid"), "enabled", realDebrid.toString())
        // Last resort: only with a key (the addon's apiKey stays a ${DEEPL_API_KEY} placeholder).
        lines = set(lines, listOf("translation", "deepl"), "enabled", deepL.toString())
        // Stremio runs on this same device: torrents without Real-Debrid are found in its server.
        lines = set(lines, listOf("streams", "stremio"), "enabled", "true")
        return lines.joinToString("\n")
    }

    /** Replaces `key:` inside the nested block [path] (two-space indentation, like the template). */
    internal fun set(lines: List<String>, path: List<String>, key: String, value: String): List<String> =
        replace(lines, path, key, " ".repeat(path.size * 2) + "$key: $value")

    private fun replace(lines: List<String>, path: List<String>, key: String, line: String): List<String> {
        var start = 0
        var end = lines.size
        path.forEachIndexed { depth, block ->
            val header = " ".repeat(depth * 2) + "$block:"
            val at = (start until end).firstOrNull { stripComment(lines[it]) == header }
                ?: throw IllegalStateException("config.template.yaml has no block ${path.take(depth + 1).joinToString(".")}")
            start = at + 1
            end = (start until end).firstOrNull { isOutside(lines[it], depth) } ?: end
        }
        val prefix = " ".repeat(path.size * 2) + "$key:"
        val at = (start until end).firstOrNull { lines[it].startsWith(prefix) }
            ?: throw IllegalStateException("config.template.yaml has no ${(path + key).joinToString(".")}")
        return lines.toMutableList().apply { this[at] = line }
    }

    private fun stripComment(line: String) = line.substringBefore(" #").trimEnd()

    /** A non-blank, non-comment line indented at most as much as the block header ends it. */
    private fun isOutside(line: String, depth: Int): Boolean {
        if (line.isBlank() || line.trimStart().startsWith("#")) return false
        return line.length - line.trimStart().length <= depth * 2
    }
}
