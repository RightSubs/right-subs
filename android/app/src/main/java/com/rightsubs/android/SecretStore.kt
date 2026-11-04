package com.rightsubs.android

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Credentials encrypted with AES-256-GCM under a key that lives in the Android Keystore
 * (hardware-backed when the device has it; StrongBox when available). The key never
 * leaves the Keystore, so the ciphertext in the app's private preferences is useless on
 * any other device or in a backup (backups are disabled anyway). Each field is bound to
 * its name (AAD), so ciphertexts cannot be swapped between fields.
 */
class SecretStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun hasCredentials(): Boolean = FIELDS.take(3).all { prefs.contains(it) }

    /** Null when nothing is stored or the key is gone (e.g. Keystore reset): the user types again. */
    fun load(): Credentials? {
        if (!hasCredentials()) return null
        return try {
            val key = existingKey() ?: return null.also { clear() }
            val values = FIELDS.map { field -> prefs.getString(field, null)?.let { decrypt(key, field, it) }.orEmpty() }
            Credentials(values[0], values[1], values[2], values[3], values[4])
        } catch (e: GeneralSecurityException) {
            clear()
            null
        } catch (e: IllegalArgumentException) {
            clear()
            null
        }
    }

    fun save(credentials: Credentials) {
        val key = existingKey() ?: createKey()
        val values = listOf(
            credentials.openSubtitlesApiKey,
            credentials.openSubtitlesUser,
            credentials.openSubtitlesPassword,
            credentials.realDebridToken,
            credentials.deepLApiKey,
        )
        val editor = prefs.edit()
        FIELDS.zip(values).forEach { (field, value) ->
            if (value.isEmpty()) editor.remove(field) else editor.putString(field, encrypt(key, field, value))
        }
        // commit, not apply: the service reads them right after.
        check(editor.commit()) { "não foi possível gravar as credenciais" }
    }

    /** Deletes the ciphertexts and the key itself. */
    fun clear() {
        prefs.edit().clear().commit()
        try {
            keyStore().deleteEntry(ALIAS)
        } catch (_: GeneralSecurityException) {
        }
    }

    private fun encrypt(key: SecretKey, field: String, value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key) // the Keystore generates a random IV
        cipher.updateAAD(field.toByteArray())
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    private fun decrypt(key: SecretKey, field: String, stored: String): String {
        val sealed = Base64.decode(stored, Base64.NO_WRAP)
        require(sealed.size > IV_BYTES)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
        cipher.updateAAD(field.toByteArray())
        return String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES), Charsets.UTF_8)
    }

    private fun keyStore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(ALIAS, null) as SecretKey?

    private fun createKey(): SecretKey {
        fun generate(strongBox: Boolean): SecretKey {
            val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
            if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setIsStrongBoxBacked(true)
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
                init(spec.build())
                generateKey()
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return generate(strongBox = false)
        // Most TV boxes have no StrongBox; some report it with a ProviderException instead.
        return try {
            generate(strongBox = true)
        } catch (e: Exception) {
            generate(strongBox = false)
        }
    }

    private companion object {
        const val PREFS = "credentials"
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "rightsubs-credentials"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        val FIELDS = listOf("os_api_key", "os_user", "os_password", "rd_token", "deepl_key")
    }
}
