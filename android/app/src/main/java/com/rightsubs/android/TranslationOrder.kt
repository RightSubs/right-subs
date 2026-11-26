package com.rightsubs.android

import android.content.Context

/** A translation service the addon can use as the last resort; [id] is the name RightSubs' config.yaml uses. */
enum class TranslationProvider(val id: String, val label: String) {
    DEEPL("deepl", "DeepL"),
    GEMINI("gemini", "Gemini"),
    OPENROUTER("openrouter", "OpenRouter"),
}

/**
 * Who translates first, second and third (null = nobody in that place). A service without a
 * key is skipped by the addon, so the order can be kept even before the keys are typed.
 */
data class TranslationOrder(val places: List<TranslationProvider?>) {
    init {
        require(places.size == PLACES) { "the order has $PLACES places" }
        val chosen = places.filterNotNull()
        require(chosen.size == chosen.toSet().size) { "a service is listed twice: $places" }
    }

    /** The services in order, without the empty places. */
    val providers: List<TranslationProvider> get() = places.filterNotNull()

    /** [provider] in [place], and wherever it was before it is emptied: the newest choice wins. */
    fun with(place: Int, provider: TranslationProvider?): TranslationOrder =
        TranslationOrder(places.mapIndexed { index, current -> if (index == place) provider else current.takeUnless { it == provider } })

    companion object {
        const val PLACES = 3
        val DEFAULT = TranslationOrder(listOf(TranslationProvider.DEEPL, TranslationProvider.OPENROUTER, TranslationProvider.GEMINI))

        private const val PREFS = "settings"
        private const val KEY = "translation.order"
        /** Stored for an empty place, so it is told apart from "never chosen". */
        private const val NONE = "-"

        fun load(context: Context): TranslationOrder {
            val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return DEFAULT
            return parse(saved)
        }

        fun save(context: Context, order: TranslationOrder) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, format(order)).apply()
        }

        internal fun format(order: TranslationOrder) = order.places.joinToString(",") { it?.id ?: NONE }

        /** Anything that does not parse (a service removed in a later version, a hand edit) gives the default. */
        internal fun parse(text: String): TranslationOrder = runCatching {
            TranslationOrder(text.split(',').map { id -> if (id == NONE) null else TranslationProvider.entries.first { it.id == id } })
        }.getOrDefault(DEFAULT)
    }
}
