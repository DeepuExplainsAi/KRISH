package app.krish.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class PackagePolicyTest {
    // Same file the app packages as an asset and the TypeScript tests read.
    private val policy = PackagePolicy(File("../../core/security-policy/blocklist.json").readText())
    private val allowed = listOf("com.android.chrome", "com.google.android.youtube")

    @Test fun allowsOnlyAllowlistedPackages() {
        assertEquals(PackagePolicy.Verdict.Allow, policy.check("com.android.chrome", allowed))
        assertEquals(PackagePolicy.Verdict.Block("not_allowlisted"), policy.check("com.example.game", allowed))
        assertEquals(PackagePolicy.Verdict.Allow, policy.check("COM.Android.Chrome", allowed))
    }

    @Test fun failsClosed() {
        assertEquals(PackagePolicy.Verdict.Block("empty"), policy.check(null, allowed))
        assertEquals(PackagePolicy.Verdict.Block("empty"), policy.check("  ", allowed))
        assertEquals(PackagePolicy.Verdict.Block("invalid"), policy.check("chrome", listOf("chrome")))
        assertTrue(policy.check("com.android.chrome", emptyList()) is PackagePolicy.Verdict.Block)
    }

    @Test fun hardBlocklistBeatsAllowlist() {
        mapOf(
            "com.phonepe.app" to "finance",
            "net.one97.paytm" to "finance",
            "com.google.android.gm" to "private_chat_and_mail",
            "com.whatsapp" to "private_chat_and_mail",
            "com.google.android.apps.authenticator2" to "auth_and_passwords",
            "com.android.settings" to "system_and_accounts",
            "com.android.vending" to "system_and_accounts",
        ).forEach { (pkg, group) ->
            assertEquals(pkg, PackagePolicy.Verdict.Block("hard_blocked", group), policy.check(pkg, listOf(pkg)))
        }
    }

    @Test fun doesNotBlockOwnersApps() {
        listOf("com.android.chrome", "com.google.android.youtube", "com.instagram.android", "com.openai.chatgpt", "com.anthropic.claude")
            .forEach { assertNull(it, policy.hardBlockGroup(it)) }
    }
}
