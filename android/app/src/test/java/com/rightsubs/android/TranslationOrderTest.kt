package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Test

class TranslationOrderTest {
    private val deepl = TranslationProvider.DEEPL
    private val gemini = TranslationProvider.GEMINI
    private val router = TranslationProvider.OPENROUTER

    @Test
    fun theDefaultTriesDeepLThenOpenRouterThenGemini() {
        assertEquals(listOf(deepl, router, gemini), TranslationOrder.DEFAULT.providers)
    }

    @Test
    fun choosingAServiceAlreadyUsedMovesItAndEmptiesItsOldPlace() {
        val moved = TranslationOrder.DEFAULT.with(0, router)
        assertEquals(listOf(router, null, gemini), moved.places)
        assertEquals(listOf(router, gemini), moved.providers)
    }

    @Test
    fun anEmptyPlaceIsSkipped() {
        assertEquals(listOf(deepl, router), TranslationOrder(listOf(deepl, null, router)).providers)
        assertEquals(emptyList<TranslationProvider>(), TranslationOrder.DEFAULT.with(0, null).with(1, null).with(2, null).providers)
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesTheSameServiceTwice() {
        TranslationOrder(listOf(deepl, deepl, null))
    }

    @Test
    fun savesAndReadsBack() {
        val order = TranslationOrder(listOf(gemini, null, deepl))
        assertEquals("gemini,-,deepl", TranslationOrder.format(order))
        assertEquals(order, TranslationOrder.parse(TranslationOrder.format(order)))
    }

    @Test
    fun somethingThatDoesNotParseGivesTheDefault() {
        assertEquals(TranslationOrder.DEFAULT, TranslationOrder.parse("deepl,somethingnew,-"))
        assertEquals(TranslationOrder.DEFAULT, TranslationOrder.parse("deepl,deepl,-"))
        assertEquals(TranslationOrder.DEFAULT, TranslationOrder.parse("deepl"))
    }
}
