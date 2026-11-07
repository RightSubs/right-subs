package com.rightsubs.android

import android.content.Context

/** A subtitle language as RightSubs' config.yaml names it (`tag`) and as the screen shows it. */
data class Language(val tag: String, val name: String)

/**
 * What to watch — the primary subtitle language and the one used when it does not exist
 * (null = none) — and the language used only to sync it, never shown (null = none).
 */
data class LanguageChoice(val primary: String, val secondary: String?, val reference: String? = "en") {
    init {
        require(Languages.find(primary) != null) { "idioma desconhecido: $primary" }
        require(secondary == null || (Languages.find(secondary) != null && secondary != primary)) { "secundária inválida: $secondary" }
        require(reference == null || Languages.find(reference) != null) { "referência inválida: $reference" }
    }
}

/**
 * The languages RightSubs knows (rightsubs/src/languages/languages.ts; LanguagesTest
 * fails the build when the two lists differ). Not a secret: kept in plain preferences.
 */
object Languages {
    val ALL = listOf(
        Language("pt-BR", "Português (Brasil)"),
        Language("pt-PT", "Português (Portugal)"),
        Language("en", "English"),
        Language("es", "Español"),
        Language("fr", "Français"),
        Language("de", "Deutsch"),
        Language("it", "Italiano"),
        Language("nl", "Nederlands"),
        Language("pl", "Polski"),
        Language("ru", "Русский"),
        Language("tr", "Türkçe"),
        Language("ar", "العربية"),
        Language("ja", "日本語"),
        Language("ko", "한국어"),
        Language("zh-CN", "中文 (简体)"),
        Language("zh-TW", "中文 (繁體)"),
    )

    /** Most subtitles made for an exact release are in English: the best reference. */
    val DEFAULT = LanguageChoice(primary = "pt-BR", secondary = "pt-PT", reference = "en")

    private const val PREFS = "settings"
    private const val PRIMARY = "language.primary"
    private const val SECONDARY = "language.secondary"
    private const val REFERENCE = "language.reference"
    /** Stored for "none", so it is told apart from "never chosen". */
    private const val NONE = ""

    fun find(tag: String): Language? = ALL.firstOrNull { it.tag == tag }

    /** The saved choice; the default when nothing (or something no longer valid) is saved. */
    fun load(context: Context): LanguageChoice {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val primary = prefs.getString(PRIMARY, null) ?: return DEFAULT
        val secondary = prefs.getString(SECONDARY, DEFAULT.secondary)
        val reference = prefs.getString(REFERENCE, DEFAULT.reference)
        return runCatching { LanguageChoice(primary, secondary?.ifEmpty { null }, reference?.ifEmpty { null }) }.getOrDefault(DEFAULT)
    }

    fun save(context: Context, choice: LanguageChoice) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(PRIMARY, choice.primary)
            .putString(SECONDARY, choice.secondary ?: NONE)
            .putString(REFERENCE, choice.reference ?: NONE)
            .apply()
    }
}
