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
        val creds = ok(CredentialsValidator.validate(CredentialsForm(" $apiKey ", " maria ", " password with spaces ", ""), null))
        assertEquals(apiKey, creds.openSubtitlesApiKey)
        assertEquals("maria", creds.openSubtitlesUser)
        assertEquals(" password with spaces ", creds.openSubtitlesPassword)
        assertEquals("", creds.realDebridToken)
        assertFalse(creds.environment().containsKey("RD_TOKEN"))
    }

    @Test
    fun rejectsEmailAsUserAndMissingFields() {
        val errs = errors(CredentialsValidator.validate(CredentialsForm("", "maria@example.com", "", ""), null))
        assertEquals(listOf(CredentialError.API_KEY_MISSING, CredentialError.USER_EMAIL, CredentialError.PASSWORD_MISSING), errs)
    }

    @Test
    fun rejectsControlCharactersAndBadTokens() {
        assertTrue(errors(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "a\nb", ""), null)).isNotEmpty())
        assertTrue(errors(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "x", "not a token"), null)).isNotEmpty())
        assertTrue(errors(CredentialsValidator.validate(CredentialsForm("key with spaces in it!!", "maria", "x", ""), null)).isNotEmpty())
    }

    @Test
    fun blankFieldsKeepStoredValues() {
        val stored = Credentials(apiKey, "maria", "secret", rdToken)
        val creds = ok(CredentialsValidator.validate(CredentialsForm("", "", "", ""), stored))
        assertEquals("secret", creds.openSubtitlesPassword)
        assertEquals(rdToken, creds.realDebridToken)
        assertEquals(rdToken, creds.environment()["RD_TOKEN"])
    }

    @Test
    fun removesRealDebridToken() {
        val stored = Credentials(apiKey, "maria", "secret", rdToken)
        assertEquals("", ok(CredentialsValidator.validate(CredentialsForm("", "", "", "", removeRealDebrid = true), stored)).realDebridToken)
    }

    @Test
    fun deepLKeyIsOptionalAndGoesOnlyToTheEnvironment() {
        val none = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", ""), null))
        assertEquals("", none.deepLApiKey)
        assertFalse(none.environment().containsKey("DEEPL_API_KEY"))

        val free = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", "", deepLApiKey = " $deepLKey "), null))
        assertEquals(deepLKey, free.deepLApiKey)
        assertEquals(deepLKey, free.environment()["DEEPL_API_KEY"])
        assertTrue(deepLKey in free.secrets())
    }

    @Test
    fun rejectsMalformedDeepLKey() {
        val errs = errors(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", "", deepLApiKey = "not a key!"), null))
        assertEquals(listOf(CredentialError.DEEPL_KEY_INVALID), errs)
    }

    @Test
    fun keepsAndRemovesStoredDeepLKey() {
        val stored = Credentials(apiKey, "maria", "secret", rdToken, deepLKey)
        assertEquals(deepLKey, ok(CredentialsValidator.validate(CredentialsForm("", "", "", ""), stored)).deepLApiKey)
        assertEquals("", ok(CredentialsValidator.validate(CredentialsForm("", "", "", "", removeDeepL = true), stored)).deepLApiKey)
    }

    @Test
    fun geminiAndOpenRouterKeysAreOptionalAndGoOnlyToTheEnvironment() {
        val none = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", ""), null))
        assertFalse(none.environment().containsKey("GEMINI_API_KEY"))
        assertFalse(none.environment().containsKey("OPENROUTER_API_KEY"))

        val gemini = "AQ.FakeGeminiKeyForTests_0123456789"
        val router = "sk-or-v1-0123456789abcdef0123456789abcdef"
        val both = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", "", geminiApiKey = " $gemini ", openRouterApiKey = router), null))
        assertEquals(gemini, both.environment()["GEMINI_API_KEY"])
        assertEquals(router, both.environment()["OPENROUTER_API_KEY"])
        assertTrue(gemini in both.secrets() && router in both.secrets())
    }

    @Test
    fun rejectsMalformedGeminiAndOpenRouterKeys() {
        val errs = errors(
            CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", "", geminiApiKey = "not a key!", openRouterApiKey = "x"), null),
        )
        assertEquals(listOf(CredentialError.GEMINI_KEY_INVALID, CredentialError.OPENROUTER_KEY_INVALID), errs)
    }

    @Test
    fun keepsAndRemovesStoredGeminiAndOpenRouterKeys() {
        val gemini = "AQ.FakeGeminiKeyForTests_0123456789"
        val router = "sk-or-v1-0123456789abcdef0123456789abcdef"
        val stored = Credentials(apiKey, "maria", "secret", rdToken, deepLKey, gemini, router)
        val kept = ok(CredentialsValidator.validate(CredentialsForm("", "", "", ""), stored))
        assertEquals(gemini, kept.geminiApiKey)
        assertEquals(router, kept.openRouterApiKey)
        val removed = ok(CredentialsValidator.validate(CredentialsForm("", "", "", "", removeGemini = true, removeOpenRouter = true), stored))
        assertEquals("", removed.geminiApiKey)
        assertEquals("", removed.openRouterApiKey)
        assertEquals(deepLKey, removed.deepLApiKey)
    }

    @Test
    fun torBoxTokenIsOptionalValidatedKeptRemovedAndOnlyInTheEnvironment() {
        val token = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9"
        val none = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", ""), null))
        assertFalse(none.environment().containsKey("TORBOX_TOKEN"))
        val set = ok(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", "", torBoxToken = " $token "), null))
        assertEquals(token, set.environment()["TORBOX_TOKEN"])
        assertTrue(token in set.secrets())
        assertEquals(token, ok(CredentialsValidator.validate(CredentialsForm("", "", "", ""), set)).torBoxToken)
        assertEquals("", ok(CredentialsValidator.validate(CredentialsForm("", "", "", "", removeTorBox = true), set)).torBoxToken)
        val bad = errors(CredentialsValidator.validate(CredentialsForm(apiKey, "maria", "secret", "", torBoxToken = "not a token!"), null))
        assertEquals(listOf(CredentialError.TORBOX_TOKEN_INVALID), bad)
    }

    @Test
    fun neverPrintsValues() {
        val creds = Credentials(apiKey, "maria", "secret", rdToken)
        assertFalse("secret" in creds.toString())
        assertFalse("secret" in CredentialsForm(apiKey, "maria", "secret", "").toString())
    }
}
