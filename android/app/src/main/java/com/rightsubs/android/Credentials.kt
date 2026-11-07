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
) {
    fun environment(): Map<String, String> = buildMap {
        put("OPENSUBTITLES_API_KEY", openSubtitlesApiKey)
        put("OPENSUBTITLES_USER", openSubtitlesUser)
        put("OPENSUBTITLES_PASSWORD", openSubtitlesPassword)
        if (realDebridToken.isNotEmpty()) put("RD_TOKEN", realDebridToken)
        if (deepLApiKey.isNotEmpty()) put("DEEPL_API_KEY", deepLApiKey)
    }

    /** Values to scrub from anything written to the log. */
    fun secrets(): List<String> = listOf(openSubtitlesApiKey, openSubtitlesPassword, realDebridToken, deepLApiKey)

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
) {
    override fun toString() = "CredentialsForm(***)"
}

sealed interface Validation {
    class Ok(val credentials: Credentials) : Validation
    class Invalid(val errors: List<String>) : Validation
}

object CredentialsValidator {
    private val API_KEY = Regex("^[A-Za-z0-9_-]{16,128}$")
    private val RD_TOKEN = Regex("^[A-Za-z0-9]{20,128}$")
    /** DeepL Free keys end in ":fx"; the addon picks the free endpoint from that suffix. */
    private val DEEPL_KEY = Regex("^[A-Za-z0-9-]{20,128}(:fx)?$")
    private val CONTROL = Regex("\\p{Cntrl}")

    /** Merges the form over the stored credentials (if any) and checks every field. */
    fun validate(form: CredentialsForm, stored: Credentials?): Validation {
        val errors = mutableListOf<String>()
        // Keys and user names never have surrounding spaces; a password may, so it is kept as typed.
        val apiKey = form.apiKey.trim().ifEmpty { stored?.openSubtitlesApiKey.orEmpty() }
        val user = form.user.trim().ifEmpty { stored?.openSubtitlesUser.orEmpty() }
        val password = form.password.ifEmpty { stored?.openSubtitlesPassword.orEmpty() }
        val rdToken = when {
            form.removeRealDebrid -> ""
            else -> form.realDebridToken.trim().ifEmpty { stored?.realDebridToken.orEmpty() }
        }

        if (apiKey.isEmpty()) errors += "Informe a API key da OpenSubtitles."
        else if (!API_KEY.matches(apiKey)) errors += "API key da OpenSubtitles inválida (só letras e números)."

        when {
            user.isEmpty() -> errors += "Informe o nome de usuário da OpenSubtitles."
            '@' in user -> errors += "Use o nome de usuário da OpenSubtitles, não o e-mail."
            user.length > 64 || CONTROL.containsMatchIn(user) -> errors += "Nome de usuário da OpenSubtitles inválido."
        }

        when {
            password.isEmpty() -> errors += "Informe a senha da OpenSubtitles."
            password.length > 256 || CONTROL.containsMatchIn(password) -> errors += "Senha da OpenSubtitles inválida."
        }

        if (rdToken.isNotEmpty() && !RD_TOKEN.matches(rdToken)) {
            errors += "Token do Real-Debrid inválido (copie de real-debrid.com/apitoken)."
        }

        val deepL = when {
            form.removeDeepL -> ""
            else -> form.deepLApiKey.trim().ifEmpty { stored?.deepLApiKey.orEmpty() }
        }
        if (deepL.isNotEmpty() && !DEEPL_KEY.matches(deepL)) {
            errors += "Chave do DeepL inválida (copie de deepl.com, em Conta › Chaves de API)."
        }

        return if (errors.isEmpty()) {
            Validation.Ok(Credentials(apiKey, user, password, rdToken, deepL))
        } else {
            Validation.Invalid(errors)
        }
    }
}
