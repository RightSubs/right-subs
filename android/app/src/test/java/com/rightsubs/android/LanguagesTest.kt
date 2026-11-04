package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class LanguagesTest {
    /** The screen may only offer languages the RightSubs inside this APK accepts. */
    @Test
    fun matchesTheLanguagesOfTheBundledRightSubs() {
        val source = File(System.getProperty("rightsubs.languages") ?: "")
        assumeTrue("languages.ts not generated yet", source.isFile)
        val tags = Regex("""\{\s*tag:\s*'([^']+)',\s*name:\s*'([^']+)'""").findAll(source.readText()).map { it.groupValues[1] to it.groupValues[2] }.toList()
        assertEquals(tags, Languages.ALL.map { it.tag to it.name })
    }

    @Test
    fun theDefaultIsBrazilianThenEuropeanPortuguese() {
        assertEquals(LanguageChoice("pt-BR", "pt-PT"), Languages.DEFAULT)
    }
}
