package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class ConfigWriterTest {
    private val sample = """
        server:
          host: 0.0.0.0        # comment
          port: 7100

        languages:
          primary: pt-BR         # idioma que você quer ver
          secondary: en-US       # usado quando não existe legenda no principal
          useSecondaryWhen:
            - not_found

        streams:
          indexers:
            - id: torrentio
              enabled: false
              url: ${'$'}{TORRENTIO_URL}
          realdebrid:
            enabled: false
            token: ${'$'}{RD_TOKEN}
          stremio:
            enabled: false
            url: http://127.0.0.1:11470

        sync:
          enabled: true
          referenceLanguages: [en]
          embedded:
            enabled: true

        translation:
          deepl:
            enabled: false
            apiKey: ${'$'}{DEEPL_API_KEY}
    """.trimIndent()

    @Test
    fun setsHostPortAndRealDebrid() {
        val out = ConfigWriter.render(sample, realDebrid = true).lines()
        assertTrue("  host: 127.0.0.1" in out)
        assertTrue("  port: 7000" in out)
        assertTrue("    enabled: true" in out)
        // Only the realdebrid block changes: the indexer and sync stay as they were.
        assertTrue("      enabled: false" in out)
        assertTrue("  enabled: true" in out)
        assertTrue("    token: \${RD_TOKEN}" in out)
    }

    @Test
    fun disablesRealDebridWithoutToken() {
        val out = ConfigWriter.render(sample, realDebrid = false).lines()
        assertEquals("    enabled: false", out[out.indexOf("  realdebrid:") + 1])
    }

    @Test
    fun turnsDeepLOnOnlyWithAKey() {
        val on = ConfigWriter.render(sample, realDebrid = false, deepL = true).lines()
        assertEquals("    enabled: true", on[on.indexOf("  deepl:") + 1])
        val off = ConfigWriter.render(sample, realDebrid = false).lines()
        assertEquals("    enabled: false", off[off.indexOf("  deepl:") + 1])
        // The key itself never goes into the file.
        assertTrue("    apiKey: \${DEEPL_API_KEY}" in on)
    }

    @Test
    fun alwaysFindsTorrentsInTheLocalStremioServer() {
        for (realDebrid in listOf(true, false)) {
            val out = ConfigWriter.render(sample, realDebrid).lines()
            assertEquals("    enabled: true", out[out.indexOf("  stremio:") + 1])
        }
    }

    @Test
    fun writesTheChosenLanguagesWithPortugueseByDefault() {
        val default = ConfigWriter.render(sample, realDebrid = false).lines()
        assertTrue("  primary: pt-BR" in default)
        assertTrue("  secondary: pt-PT" in default)

        val spanish = ConfigWriter.render(sample, realDebrid = false, languages = LanguageChoice("es", "en")).lines()
        assertTrue("  primary: es" in spanish)
        assertTrue("  secondary: en" in spanish)
        assertTrue("  useSecondaryWhen:" in spanish)

        val alone = ConfigWriter.render(sample, realDebrid = false, languages = LanguageChoice("fr", null)).lines()
        assertTrue("  primary: fr" in alone)
        assertFalse(alone.any { it.startsWith("  secondary:") })
        assertEquals(sample.lines().size, alone.size)
    }

    @Test
    fun writesTheReferenceLanguageEnglishByDefault() {
        assertTrue("  referenceLanguages: [en]" in ConfigWriter.render(sample, realDebrid = false).lines())
        val spanish = ConfigWriter.render(sample, realDebrid = false, languages = LanguageChoice("pt-BR", "pt-PT", "es")).lines()
        assertTrue("  referenceLanguages: [es]" in spanish)
        val none = ConfigWriter.render(sample, realDebrid = false, languages = LanguageChoice("pt-BR", null, null)).lines()
        assertTrue("  referenceLanguages: []" in none)
        // The embedded block right below is untouched.
        assertTrue("    enabled: true" in none)
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesTheSameLanguageTwice() {
        LanguageChoice("pt-BR", "pt-BR")
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesAnUnknownLanguage() {
        LanguageChoice("xx", null)
    }

    @Test(expected = IllegalStateException::class)
    fun failsWhenTheTemplateChangesShape() {
        ConfigWriter.render("server:\n  host: x\n  port: 1\n", realDebrid = false)
    }

    /** The real config.example.yaml of the RightSubs version inside this APK. */
    @Test
    fun understandsTheBundledTemplate() {
        val template = File(System.getProperty("rightsubs.template") ?: "")
        assumeTrue("template not generated yet", template.isFile)
        val out = ConfigWriter.render(template.readText(), realDebrid = true)
        assertTrue("  host: 127.0.0.1" in out.lines())
        assertTrue("  port: 7000" in out.lines())
        // Secrets stay as placeholders, filled from the environment by RightSubs.
        assertTrue("\${OPENSUBTITLES_PASSWORD}" in out)
        assertFalse(out.lines().any { it.trimStart().startsWith("password:") && "\${" !in it })
        assertEquals(template.readText().lines().size, out.lines().size)
    }
}
