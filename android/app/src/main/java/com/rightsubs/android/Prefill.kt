package com.rightsubs.android

import android.content.Context
import org.json.JSONObject
import java.io.IOException

/**
 * TEST BUILDS ONLY (`build.ps1 -Prefill`): the APK carries assets/prefill.json with the
 * developer's own credentials (copied from .env at build time) and the first start stores
 * them as if typed. Normal builds never have that asset (scripts/container-build.sh), so
 * there this does nothing. Never distribute a `-prefill.apk`: the file is plain text.
 */
object Prefill {
    private const val ASSET = "prefill.json"
    private const val PREFS = "prefill"
    private const val DONE = "done"

    /** Runs once per install, and only when nothing is saved yet. A bad file is ignored. */
    fun apply(context: Context, store: SecretStore) {
        val text = try {
            context.assets.open(ASSET).bufferedReader().use { it.readText() }
        } catch (_: IOException) {
            return
        }
        // Separate from the credentials' own preferences: "clear" must not bring them back.
        val flags = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (flags.getBoolean(DONE, false)) return
        flags.edit().putBoolean(DONE, true).commit()
        if (store.hasCredentials()) return
        runCatching {
            val json = JSONObject(text)
            val form = CredentialsForm(
                apiKey = json.optString("OPENSUBTITLES_API_KEY"),
                user = json.optString("OPENSUBTITLES_USER"),
                password = json.optString("OPENSUBTITLES_PASSWORD"),
                realDebridToken = json.optString("RD_TOKEN"),
                deepLApiKey = json.optString("DEEPL_API_KEY"),
            )
            val result = CredentialsValidator.validate(form, null)
            if (result is Validation.Ok) store.save(result.credentials)
        }
    }
}
