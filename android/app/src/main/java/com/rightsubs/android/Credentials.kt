package com.rightsubs.android

/**
 * What the user types on first launch. Never logged: [toString] hides every value.
 * Passed to Node only as environment variables (the names RightSubs' config.yaml uses).
 */
class Credentials(
    val openSubtitlesApiKey: String,
    val openSubtitlesUser: String,
    val openSubtitlesPassword: String,
    /** Empty when Real-Debrid is not used (light mode). */
    val realDebridToken: String,
    /** Empty when DeepL is not used: without it, no translation (the addon's last resort). */
    val deepLApiKey: String = "",
    /** Empty when Gemini is not used. */
    val geminiApiKey: String = "",
    /** Empty when OpenRouter is not used. */
    val openRouterApiKey: String = "",
    /** Empty when TorBox is not used. */
    val torBoxToken: String = "",
) {
    fun environment(): Map<String, String> = buildMap {
        put("OPENSUBTITLES_API_KEY", openSubtitlesApiKey)
        put("OPENSUBTITLES_USER", openSubtitlesUser)
        put("OPENSUBTITLES_PASSWORD", openSubtitlesPassword)
        if (realDebridToken.isNotEmpty()) put("RD_TOKEN", realDebridToken)
        if (deepLApiKey.isNotEmpty()) put("DEEPL_API_KEY", deepLApiKey)
        if (geminiApiKey.isNotEmpty()) put("GEMINI_API_KEY", geminiApiKey)
        if (openRouterApiKey.isNotEmpty()) put("OPENROUTER_API_KEY", openRouterApiKey)
        if (torBoxToken.isNotEmpty()) put("TORBOX_TOKEN", torBoxToken)
    }

    /** Values to scrub from anything written to the log. */
    fun secrets(): List<String> = listOf(openSubtitlesApiKey, openSubtitlesPassword, realDebridToken, deepLApiKey, geminiApiKey, openRouterApiKey, torBoxToken)

    override fun toString() = "Credentials(***)"
}

/** Raw form input; a blank field keeps the stored value when editing. */
class CredentialsForm(
    val apiKey: String,
    val user: String,
    val password: String,
    val realDebridToken: String,
    val removeRealDebrid: Boolean = false,
    val deepLApiKey: String = "",
    val removeDeepL: Boolean = false,
    val geminiApiKey: String = "",
    val removeGemini: Boolean = false,
    val openRouterApiKey: String = "",
    val removeOpenRouter: Boolean = false,
    val torBoxToken: String = "",
    val removeTorBox: Boolean = false,
) {
    override fun toString() = "CredentialsForm(***)"
}

sealed interface Validation {
    class Ok(val credentials: Credentials) : Validation
    class Invalid(val errors: List<CredentialError>) : Validation
}

/** What is wrong with a field; [message] is the string resource shown to the user, in the app's language. */
enum class CredentialError(val message: Int) {
    API_KEY_MISSING(R.string.error_api_key_missing),
    API_KEY_INVALID(R.string.error_api_key_invalid),
    USER_MISSING(R.string.error_user_missing),
    USER_EMAIL(R.string.error_user_email),
    USER_INVALID(R.string.error_user_invalid),
    PASSWORD_MISSING(R.string.error_password_missing),
    PASSWORD_INVALID(R.string.error_password_invalid),
    RD_TOKEN_INVALID(R.string.error_rd_token_invalid),
    DEEPL_KEY_INVALID(R.string.error_deepl_key_invalid),
    GEMINI_KEY_INVALID(R.string.error_gemini_key_invalid),
    OPENROUTER_KEY_INVALID(R.string.error_openrouter_key_invalid),
    TORBOX_TOKEN_INVALID(R.string.error_torbox_token_invalid),
}

object CredentialsValidator {
    private val API_KEY = Regex("^[A-Za-z0-9_-]{16,128}$")
    private val RD_TOKEN = Regex("^[A-Za-z0-9]{20,128}$")
    /** DeepL Free keys end in ":fx"; the addon picks the free endpoint from that suffix. */
    private val DEEPL_KEY = Regex("^[A-Za-z0-9-]{20,128}(:fx)?$")
    /** Google AI Studio keys (they may hold dots). */
    private val GEMINI_KEY = Regex("^[A-Za-z0-9_.-]{20,128}$")
    /** OpenRouter keys look like sk-or-v1-<hex>. */
    private val OPENROUTER_KEY = Regex("^[A-Za-z0-9_-]{20,200}$")
    /** TorBox API keys are UUIDs. */
    private val TORBOX_TOKEN = Regex("^[A-Za-z0-9_-]{20,128}$")
    private val CONTROL = Regex("\\p{Cntrl}")

    /** Merges the form over the stored credentials (if any) and checks every field. */
    fun validate(form: CredentialsForm, stored: Credentials?): Validation {
        val errors = mutableListOf<CredentialError>()
        // Keys and user names never have surrounding spaces; a password may, so it is kept as typed.
        val apiKey = form.apiKey.trim().ifEmpty { stored?.openSubtitlesApiKey.orEmpty() }
        val user = form.user.trim().ifEmpty { stored?.openSubtitlesUser.orEmpty() }
        val password = form.password.ifEmpty { stored?.openSubtitlesPassword.orEmpty() }
        val rdToken = when {
            form.removeRealDebrid -> ""
            else -> form.realDebridToken.trim().ifEmpty { stored?.realDebridToken.orEmpty() }
        }

        if (apiKey.isEmpty()) errors += CredentialError.API_KEY_MISSING
        else if (!API_KEY.matches(apiKey)) errors += CredentialError.API_KEY_INVALID

        when {
            user.isEmpty() -> errors += CredentialError.USER_MISSING
            '@' in user -> errors += CredentialError.USER_EMAIL
            user.length > 64 || CONTROL.containsMatchIn(user) -> errors += CredentialError.USER_INVALID
        }

        when {
            password.isEmpty() -> errors += CredentialError.PASSWORD_MISSING
            password.length > 256 || CONTROL.containsMatchIn(password) -> errors += CredentialError.PASSWORD_INVALID
        }

        if (rdToken.isNotEmpty() && !RD_TOKEN.matches(rdToken)) {
            errors += CredentialError.RD_TOKEN_INVALID
        }

        val deepL = when {
            form.removeDeepL -> ""
            else -> form.deepLApiKey.trim().ifEmpty { stored?.deepLApiKey.orEmpty() }
        }
        if (deepL.isNotEmpty() && !DEEPL_KEY.matches(deepL)) {
            errors += CredentialError.DEEPL_KEY_INVALID
        }

        val gemini = when {
            form.removeGemini -> ""
            else -> form.geminiApiKey.trim().ifEmpty { stored?.geminiApiKey.orEmpty() }
        }
        if (gemini.isNotEmpty() && !GEMINI_KEY.matches(gemini)) errors += CredentialError.GEMINI_KEY_INVALID

        val openRouter = when {
            form.removeOpenRouter -> ""
            else -> form.openRouterApiKey.trim().ifEmpty { stored?.openRouterApiKey.orEmpty() }
        }
        if (openRouter.isNotEmpty() && !OPENROUTER_KEY.matches(openRouter)) errors += CredentialError.OPENROUTER_KEY_INVALID

        val torBox = when {
            form.removeTorBox -> ""
            else -> form.torBoxToken.trim().ifEmpty { stored?.torBoxToken.orEmpty() }
        }
        if (torBox.isNotEmpty() && !TORBOX_TOKEN.matches(torBox)) errors += CredentialError.TORBOX_TOKEN_INVALID

        return if (errors.isEmpty()) {
            Validation.Ok(Credentials(apiKey, user, password, rdToken, deepL, gemini, openRouter, torBox))
        } else {
            Validation.Invalid(errors)
        }
    }
}
