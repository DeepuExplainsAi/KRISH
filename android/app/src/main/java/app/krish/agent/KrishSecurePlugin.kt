package app.krish.agent

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * API-key storage: AES-256-GCM with a non-exportable Android Keystore key.
 * Ciphertext lives in private SharedPreferences (excluded from backups). Values are never logged.
 */
@CapacitorPlugin(name = "KrishSecure")
class KrishSecurePlugin : Plugin() {
    private val prefs by lazy { context.getSharedPreferences("krish_secure", Context.MODE_PRIVATE) }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val raw = Base64.decode(stored, Base64.NO_WRAP)
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, IV_LEN)) }
        return String(c.doFinal(raw, IV_LEN, raw.size - IV_LEN), Charsets.UTF_8)
    }

    @PluginMethod fun get(call: PluginCall) {
        val name = call.getString("key") ?: return call.reject("key required")
        try {
            val v = prefs.getString(name, null)?.let { decrypt(it) }
            call.resolve(JSObject().apply { if (v != null) put("value", v) })
        } catch (e: Exception) {
            call.reject("could not read secure value") // never include details of the secret
        }
    }

    @PluginMethod fun set(call: PluginCall) {
        val name = call.getString("key") ?: return call.reject("key required")
        val value = call.getString("value") ?: return call.reject("value required")
        try {
            prefs.edit().putString(name, encrypt(value)).apply()
            call.resolve()
        } catch (e: Exception) {
            call.reject("could not store secure value")
        }
    }

    @PluginMethod fun delete(call: PluginCall) {
        prefs.edit().remove(call.getString("key") ?: return call.reject("key required")).apply()
        call.resolve()
    }

    private companion object {
        const val ALIAS = "krish_api_keys"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_LEN = 12
    }
}
