package com.rightsubs.android

import android.app.Activity
import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Single screen, D-pad friendly: addon status, install in Stremio, subtitle languages, credentials, log.
 * The window is FLAG_SECURE (no screenshots, casting or recents thumbnail) and stored
 * values are never shown again — editing only replaces them.
 */
class MainActivity : Activity() {
    private lateinit var store: SecretStore
    private lateinit var runtime: NodeRuntime

    private lateinit var status: TextView
    private lateinit var detail: TextView
    private lateinit var health: TextView
    private lateinit var form: View
    private lateinit var formErrors: TextView
    private lateinit var apiKey: EditText
    private lateinit var user: EditText
    private lateinit var password: EditText
    private lateinit var rdToken: EditText
    private lateinit var removeRd: CheckBox
    private lateinit var deepLKey: EditText
    private lateinit var removeDeepL: CheckBox
    private lateinit var showValues: CheckBox
    private lateinit var log: TextView
    private lateinit var main: View
    private lateinit var primaryLanguage: Spinner
    private lateinit var secondaryLanguage: Spinner
    private lateinit var referenceLanguage: Spinner
    private lateinit var phonePanel: View
    private var phoneSetup: PhoneSetupServer? = null

    private val onState: (AddonState.Snapshot) -> Unit = { render(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        setContentView(R.layout.activity_main)
        store = SecretStore(this)
        Prefill.apply(this, store)
        runtime = NodeRuntime(this)

        status = findViewById(R.id.status)
        detail = findViewById(R.id.status_detail)
        health = findViewById(R.id.health)
        main = findViewById(R.id.main_panel)
        form = findViewById(R.id.form_panel)
        formErrors = findViewById(R.id.form_errors)
        apiKey = findViewById(R.id.api_key)
        user = findViewById(R.id.user)
        password = findViewById(R.id.password)
        rdToken = findViewById(R.id.rd_token)
        removeRd = findViewById(R.id.remove_rd)
        deepLKey = findViewById(R.id.deepl_key)
        removeDeepL = findViewById(R.id.remove_deepl)
        showValues = findViewById(R.id.show_values)
        log = findViewById(R.id.log)
        findViewById<TextView>(R.id.manifest_url).text = MANIFEST_URL

        findViewById<Button>(R.id.install_stremio).setOnClickListener { installInStremio() }
        findViewById<Button>(R.id.edit_credentials).setOnClickListener { showForm() }
        findViewById<Button>(R.id.restart).setOnClickListener { AddonService.restart(this) }
        findViewById<Button>(R.id.show_log).setOnClickListener { toggleLog() }
        findViewById<Button>(R.id.save).setOnClickListener { save() }
        findViewById<Button>(R.id.cancel).setOnClickListener { hideForm() }
        findViewById<Button>(R.id.clear).setOnClickListener { clearCredentials() }
        phonePanel = findViewById(R.id.phone_panel)
        findViewById<Button>(R.id.phone_setup).setOnClickListener { startPhoneSetup() }
        findViewById<Button>(R.id.phone_cancel).setOnClickListener { endPhoneSetup(); showForm() }
        showValues.setOnCheckedChangeListener { _, visible -> setSecretsVisible(visible) }
        setSecretsVisible(false)
        setUpLanguages()
    }

    override fun onResume() {
        super.onResume()
        AddonState.listen(onState)
        if (!store.hasCredentials()) {
            if (form.visibility != View.VISIBLE) showForm()
        } else if (AddonState.current.status == AddonState.Status.STOPPED) {
            AddonService.start(this)
        }
        checkHealth()
    }

    override fun onPause() {
        AddonState.unlisten(onState)
        super.onPause()
    }

    override fun onStop() {
        // The phone form only lives while the TV shows it.
        if (phoneSetup != null) {
            endPhoneSetup()
            showForm()
        }
        super.onStop()
    }

    private fun render(snapshot: AddonState.Snapshot) {
        status.setText(
            when (snapshot.status) {
                AddonState.Status.STOPPED -> R.string.status_stopped
                AddonState.Status.STARTING -> R.string.status_starting
                AddonState.Status.RUNNING -> R.string.status_running
                AddonState.Status.RESTARTING -> R.string.status_restarting
                AddonState.Status.CONFIG_ERROR -> R.string.status_config_error
                AddonState.Status.FAILED -> R.string.status_failed
            },
        )
        detail.text = snapshot.detail
        detail.visibility = if (snapshot.detail.isEmpty()) View.GONE else View.VISIBLE
        if (snapshot.status == AddonState.Status.RUNNING) checkHealth()
    }

    /** Reads /health once (no polling): version, Node and whether ffmpeg was found. */
    private fun checkHealth() {
        Thread {
            val text = try {
                val connection = URL("http://${ConfigWriter.HOST}:${ConfigWriter.PORT}/health").openConnection() as HttpURLConnection
                connection.connectTimeout = 1500
                connection.readTimeout = 3000
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                connection.disconnect()
                val json = JSONObject(body)
                val tools = json.optJSONObject("tools")
                val ffmpeg = tools?.optJSONObject("ffmpeg")?.optBoolean("available") == true
                getString(
                    R.string.health_ok,
                    json.optString("version"),
                    json.optJSONObject("runtime")?.optString("node").orEmpty(),
                    getString(if (ffmpeg) R.string.yes else R.string.no),
                    getString(if (json.isNull("locator")) R.string.mode_light else R.string.mode_realdebrid),
                )
            } catch (e: Exception) {
                ""
            }
            runOnUiThread {
                health.text = text
                health.visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
            }
        }.start()
    }

    private fun installInStremio() {
        // Stremio rewrites every stremio:// link to https:// and the addon only speaks http, so no
        // stremio:// link can install it (measured on the Shield, Stremio 1.12.0). On a phone,
        // web.stremio.com keeps the http address. TVs usually have no browser (Google TV opens a
        // stub instead of failing) and the remote cannot paste, so there the address must be typed.
        if (isTv()) {
            Toast.makeText(this, getString(R.string.install_tv, MANIFEST_URL), Toast.LENGTH_LONG).show()
            return
        }
        val url = "https://web.stremio.com/#/addons?addon=" + Uri.encode(MANIFEST_URL)
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            copyManifestUrl()
        }
    }

    private fun isTv(): Boolean =
        getSystemService(UiModeManager::class.java).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION

    private fun copyManifestUrl() {
        getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText(getString(R.string.manifest_clip_label), MANIFEST_URL))
        Toast.makeText(this, getString(R.string.install_manually, MANIFEST_URL), Toast.LENGTH_LONG).show()
    }

    private fun setUpLanguages() {
        primaryLanguage = findViewById(R.id.language_primary)
        secondaryLanguage = findViewById(R.id.language_secondary)
        referenceLanguage = findViewById(R.id.language_reference)
        val names = Languages.ALL.map { it.name }
        primaryLanguage.adapter = spinnerAdapter(names)
        secondaryLanguage.adapter = spinnerAdapter(listOf(getString(R.string.language_none)) + names)
        referenceLanguage.adapter = spinnerAdapter(listOf(getString(R.string.language_none)) + names)
        showLanguages(Languages.load(this))
        // Also fires once for the initial selection: onLanguageSelected ignores what is already saved.
        val listener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>, view: View?, position: Int, id: Long) = onLanguageSelected(parent)
            override fun onNothingSelected(parent: AdapterView<*>) {}
        }
        primaryLanguage.onItemSelectedListener = listener
        secondaryLanguage.onItemSelectedListener = listener
        referenceLanguage.onItemSelectedListener = listener
    }

    private fun spinnerAdapter(items: List<String>) =
        ArrayAdapter(this, android.R.layout.simple_spinner_item, items).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }

    private fun showLanguages(choice: LanguageChoice) {
        primaryLanguage.setSelection(Languages.ALL.indexOfFirst { it.tag == choice.primary }, false)
        secondaryLanguage.setSelection(optionalPosition(choice.secondary), false)
        referenceLanguage.setSelection(optionalPosition(choice.reference), false)
    }

    /** Position in a list that starts with "Nenhuma". */
    private fun optionalPosition(tag: String?) = tag?.let { 1 + Languages.ALL.indexOfFirst { it.tag == tag } } ?: 0

    private fun optionalTag(spinner: Spinner) = spinner.selectedItemPosition.takeIf { it > 0 }?.let { Languages.ALL[it - 1].tag }

    /**
     * Applies a new choice right away: saved, then the addon restarts with the new config.
     * Picking the secondary language as primary swaps the two instead of refusing.
     */
    private fun onLanguageSelected(changed: AdapterView<*>) {
        val saved = Languages.load(this)
        val primary = Languages.ALL[primaryLanguage.selectedItemPosition].tag
        var secondary = optionalTag(secondaryLanguage)
        val reference = optionalTag(referenceLanguage)
        if (primary == saved.primary && secondary == saved.secondary && reference == saved.reference) return
        if (secondary == primary) {
            if (changed == secondaryLanguage) {
                Toast.makeText(this, R.string.languages_same, Toast.LENGTH_SHORT).show()
                showLanguages(saved)
                return
            }
            secondary = saved.primary
        }
        val choice = LanguageChoice(primary, secondary, reference)
        Languages.save(this, choice)
        showLanguages(choice)
        val names = listOfNotNull(choice.primary, choice.secondary).mapNotNull { Languages.find(it)?.name }
        val referenceName = choice.reference?.let { Languages.find(it)?.name } ?: getString(R.string.language_none)
        Toast.makeText(this, getString(R.string.languages_saved, names.joinToString(" · "), referenceName), Toast.LENGTH_SHORT).show()
        if (store.hasCredentials()) AddonService.restart(this)
    }

    private fun showForm() {
        val stored = store.hasCredentials()
        val keep = if (stored) getString(R.string.hint_keep) else ""
        apiKey.hint = getString(R.string.hint_api_key) + keep
        user.hint = getString(R.string.hint_user) + keep
        password.hint = getString(R.string.hint_password) + keep
        rdToken.hint = getString(R.string.hint_rd_token) + keep
        deepLKey.hint = getString(R.string.hint_deepl_key) + keep
        removeRd.isChecked = false
        removeRd.visibility = if (stored) View.VISIBLE else View.GONE
        removeDeepL.isChecked = false
        removeDeepL.visibility = if (stored) View.VISIBLE else View.GONE
        findViewById<View>(R.id.clear).visibility = if (stored) View.VISIBLE else View.GONE
        findViewById<View>(R.id.cancel).visibility = if (stored) View.VISIBLE else View.GONE
        formErrors.visibility = View.GONE
        main.visibility = View.GONE
        log.visibility = View.GONE
        form.visibility = View.VISIBLE
        apiKey.requestFocus()
    }

    private fun hideForm() {
        clearFields()
        form.visibility = View.GONE
        main.visibility = View.VISIBLE
        findViewById<View>(R.id.install_stremio).requestFocus()
    }

    private fun save() {
        val input = CredentialsForm(
            apiKey = apiKey.text.toString(),
            user = user.text.toString(),
            password = password.text.toString(),
            realDebridToken = rdToken.text.toString(),
            removeRealDebrid = removeRd.isChecked,
            deepLApiKey = deepLKey.text.toString(),
            removeDeepL = removeDeepL.isChecked,
        )
        when (val result = CredentialsValidator.validate(input, store.load())) {
            is Validation.Invalid -> {
                formErrors.text = result.errors.joinToString("\n")
                formErrors.visibility = View.VISIBLE
            }
            is Validation.Ok -> {
                store.save(result.credentials)
                hideForm()
                Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
                AddonService.restart(this)
            }
        }
    }

    /** Opens the temporary form on the home network and shows its QR, address and code. */
    private fun startPhoneSetup() {
        val address = PhoneSetupServer.homeNetworkAddress()
        if (address == null) {
            Toast.makeText(this, R.string.phone_no_network, Toast.LENGTH_LONG).show()
            return
        }
        val server = try {
            PhoneSetupServer(
                address = address,
                editing = store.hasCredentials(),
                submit = { form ->
                    // Same rules and storage as the form on the TV.
                    CredentialsValidator.validate(form, store.load()).also { if (it is Validation.Ok) store.save(it.credentials) }
                },
                closed = { ending -> runOnUiThread { onPhoneSetupEnded(ending) } },
            )
        } catch (e: java.io.IOException) {
            Toast.makeText(this, R.string.phone_no_network, Toast.LENGTH_LONG).show()
            return
        }
        phoneSetup = server
        findViewById<ImageView>(R.id.phone_qr).setImageDrawable(
            BitmapDrawable(resources, qrBitmap(QrCode.encode(server.qrContent))).apply { isFilterBitmap = false },
        )
        findViewById<TextView>(R.id.phone_url).text = server.url
        findViewById<TextView>(R.id.phone_code).text = getString(R.string.phone_code, server.code)
        clearFields()
        form.visibility = View.GONE
        phonePanel.visibility = View.VISIBLE
        findViewById<View>(R.id.phone_cancel).requestFocus()
        server.start()
    }

    private fun onPhoneSetupEnded(ending: PhoneSetupServer.Ending) {
        endPhoneSetup()
        when (ending) {
            PhoneSetupServer.Ending.SAVED -> {
                hideForm()
                Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
                AddonService.restart(this)
            }
            PhoneSetupServer.Ending.EXPIRED, PhoneSetupServer.Ending.TOO_MANY_ATTEMPTS -> {
                showForm()
                formErrors.setText(if (ending == PhoneSetupServer.Ending.EXPIRED) R.string.phone_expired else R.string.phone_attempts)
                formErrors.visibility = View.VISIBLE
            }
        }
    }

    private fun endPhoneSetup() {
        phoneSetup?.stop()
        phoneSetup = null
        phonePanel.visibility = View.GONE
        findViewById<ImageView>(R.id.phone_qr).setImageDrawable(null)
    }

    /** One pixel per module plus the 4-module quiet zone; the view scales it without smoothing. */
    private fun qrBitmap(qr: QrCode): Bitmap {
        val border = 4
        val side = qr.size + border * 2
        val dark = getColor(R.color.qr_dark)
        val light = getColor(R.color.qr_light)
        val pixels = IntArray(side * side) { i ->
            val x = i % side - border
            val y = i / side - border
            if (x in 0 until qr.size && y in 0 until qr.size && qr.isDark(x, y)) dark else light
        }
        return Bitmap.createBitmap(pixels, side, side, Bitmap.Config.ARGB_8888)
    }

    private fun clearCredentials() {
        AddonService.stop(this)
        store.clear()
        showForm()
        Toast.makeText(this, R.string.cleared, Toast.LENGTH_SHORT).show()
    }

    private fun toggleLog() {
        if (log.visibility == View.VISIBLE) {
            log.visibility = View.GONE
            return
        }
        // Already redacted when written; masked again in case the credentials changed since.
        val redactor = Redactor(store.load()?.secrets().orEmpty())
        log.text = runtime.log.tail(LOG_LINES).joinToString("\n") { redactor.redact(it) }.ifEmpty { getString(R.string.log_empty) }
        log.visibility = View.VISIBLE
        log.requestFocus()
    }

    private fun setSecretsVisible(visible: Boolean) {
        val type = InputType.TYPE_CLASS_TEXT or
            if (visible) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD
        for (field in listOf(apiKey, password, rdToken, deepLKey)) {
            val selection = field.selectionEnd
            field.inputType = type
            field.setSelection(selection.coerceIn(0, field.length()))
        }
    }

    private fun clearFields() {
        for (field in listOf(apiKey, user, password, rdToken, deepLKey)) field.text.clear()
        showValues.isChecked = false
    }

    private companion object {
        val MANIFEST_URL = "http://${ConfigWriter.HOST}:${ConfigWriter.PORT}/manifest.json"
        const val LOG_LINES = 80
    }
}
