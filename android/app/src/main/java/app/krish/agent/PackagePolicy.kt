package app.krish.agent

import android.content.Context
import org.json.JSONObject

/**
 * Kotlin twin of core/src/security/packages.ts. Both read core/security-policy/blocklist.json (packaged as an asset),
 * so the hard blocklist cannot differ between the engine and the AccessibilityService.
 * Fails closed: unknown, empty or malformed packages are never allowed, and the blocklist wins over the user's allowlist.
 */
class PackagePolicy(policyJson: String) {
    sealed class Verdict {
        object Allow : Verdict()
        data class Block(val reason: String, val group: String? = null) : Verdict()
    }

    private class Group(val name: String, val packages: Set<String>, val prefixes: List<String>, val contains: List<String>, val words: Set<String>)

    private val groups: List<Group>

    init {
        val root = JSONObject(policyJson).getJSONObject("groups")
        groups = root.keys().asSequence().map { name ->
            val g = root.getJSONObject(name)
            fun list(k: String) = g.getJSONArray(k).let { a -> (0 until a.length()).map { a.getString(it).lowercase() } }
            Group(name, list("packages").toSet(), list("prefixes"), list("contains"), list("words").toSet())
        }.toList()
    }

    fun hardBlockGroup(pkg: String): String? {
        val p = normalize(pkg)
        val words = p.split('.', '_')
        return groups.firstOrNull { g ->
            p in g.packages || g.prefixes.any { p.startsWith(it) } || g.contains.any { p.contains(it) } || words.any { it in g.words }
        }?.name
    }

    fun check(pkg: String?, allowlist: Collection<String>): Verdict {
        if (pkg == null || pkg.isBlank()) return Verdict.Block("empty")
        if (!NAME.matches(pkg.trim())) return Verdict.Block("invalid")
        hardBlockGroup(pkg)?.let { return Verdict.Block("hard_blocked", it) }
        val p = normalize(pkg)
        return if (allowlist.any { normalize(it) == p }) Verdict.Allow else Verdict.Block("not_allowlisted")
    }

    companion object {
        private val NAME = Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+$")
        fun normalize(pkg: String) = pkg.trim().lowercase()

        fun load(context: Context): PackagePolicy =
            PackagePolicy(context.assets.open("blocklist.json").bufferedReader().use { it.readText() })
    }
}
