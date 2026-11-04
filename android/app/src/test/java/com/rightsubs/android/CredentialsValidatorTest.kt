package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CredentialsValidatorTest {
    private val apiKey = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
    private val rdToken = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST"
    private val deepLKey = "01234567-89ab-cdef-0123-456789abcdef:fx"

    private fun ok(result: Validation) = (result as Validation.Ok).credentials
    private fun errors(result: Validation) = (result as Validation.Invalid).errors

    @Test
    fun acceptsCompleteFormAndTrimsKeys() {
        val creds = ok(CredentialsValidator.validate(CredentialsForm(" $apiKey ", " maria ", " senha com espaço ", ""), null))
        assertEquals(apiKey, creds.openSubtitlesApiKey)
        assertEquals("maria", creds.openSubtitlesUser)
        assertEquals(" senha com espaço ", creds.openSubtitlesPassword)
        assertEquals("", creds.realDebridToken)
        assertFalse(creds.environment().containsKey("RD_TOKEN"))
    }

    @Test
    fun rejectsEmailAsUserAndMissingFields() {
        val errs = errors(CredentialsValidator.validate(CredentialsForm("", "maria@example.com", "", ""), null))
        assertEquals(3, errs.size)
        assertTrue(errs.any { "e-mail" in it })
    }

    @Test
    fun rejectsControlCharactersAndBadTokens() {
        assertTrue(errors(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "a\nb", ""), null)).isNotEmpty())
        assertTrue(errors(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "x", "not a token"), null)).isNotEmpty())
        assertTrue(errors(CredentialsValidator.validate(CredentialsForm("key with spaces in it!!", "maria", "x", ""), null)).isNotEmpty())
    }

    @Test
    fun blankFieldsKeepStoredValues() {
        val stored = Credentials(apiKey, "maria", "segredo", rdToken)
        val creds = ok(CredentialsValidator.validate(CredentialsForm("", "", "", ""), stored))
        assertEquals("segredo", creds.openSubtitlesPassword)
        assertEquals(rdToken, creds.realDebridToken)
        assertEquals(rdToken, creds.environment()["RD_TOKEN"])
    }

    @Test
    fun removesRealDebridToken() {
        val stored = Credentials(apiKey, "maria", "segredo", rdToken)
        assertEquals("", ok(CredentialsValidator.validate(CredentialsForm("", "", "", "", removeRealDebrid = true), stored)).realDebridToken)
    }

    @Test
    fun deepLKeyIsOptionalAndGoesOnlyToTheEnvironment() {
        val none = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "segredo", ""), null))
        assertEquals("", none.deepLApiKey)
        assertFalse(none.environment().containsKey("DEEPL_API_KEY"))

        val free = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "segredo", "", deepLApiKey = " $deepLKey "), null))
        assertEquals(deepLKey, free.deepLApiKey)
        assertEquals(deepLKey, free.environment()["DEEPL_API_KEY"])
        assertTrue(deepLKey in free.secrets())
    }

    @Test
    fun rejectsMalformedDeepLKey() {
        val errs = errors(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "segredo", "", deepLApiKey = "not a key!"), null))
        assertTrue(errs.any { "DeepL" in it })
    }

    @Test
    fun keepsAndRemovesStoredDeepLKey() {
        val stored = Credentials(apiKey, "maria", "segredo", rdToken, deepLKey)
        assertEquals(deepLKey, ok(CredentialsValidator.validate(CredentialsForm("", "", "", ""), stored)).deepLApiKey)
        assertEquals("", ok(CredentialsValidator.validate(CredentialsForm("", "", "", "", removeDeepL = true), stored)).deepLApiKey)
    }

    @Test
    fun neverPrintsValues() {
        val creds = Credentials(apiKey, "maria", "segredo", rdToken)
        assertFalse("segredo" in creds.toString())
        assertFalse("segredo" in CredentialsForm(apiKey, "maria", "segredo", "").toString())
    }
}
