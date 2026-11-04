package app.krish.agent

import java.util.concurrent.CopyOnWriteArrayList

/**
 * State of one phone-control task and the user's app allowlist. Pure Kotlin (no Android types) so it is unit-tested on the JVM.
 * Rules: a task starts only with a non-empty allowlist; a pause is lifted only by the user (resume); a stop ends the task for good.
 */
class PhoneSession(private val policy: PackagePolicy, private val persist: (Set<String>) -> Unit = {}) {
    enum class State { IDLE, RUNNING, PAUSED }
    /** `reason` is why the task paused, or (when IDLE) why the last task stopped. */
    data class Snapshot(val state: State, val reason: String?, val taskId: String?)

    @Volatile var snapshot = Snapshot(State.IDLE, null, null)
        private set
    @Volatile var allowlist: Set<String> = emptySet()
        private set
    private val listeners = CopyOnWriteArrayList<(Snapshot) -> Unit>()

    val running get() = snapshot.state == State.RUNNING

    fun listen(l: (Snapshot) -> Unit): () -> Unit {
        listeners.add(l)
        return { listeners.remove(l) }
    }

    /** Keeps only packages the policy would ever allow (never the hard-blocked ones, never this app). Returns the rejected ones. */
    @Synchronized fun setAllowlist(pkgs: Collection<String>, ownPackage: String): List<String> {
        val own = PackagePolicy.normalize(ownPackage)
        val (ok, bad) = pkgs.partition { PackagePolicy.normalize(it) != own && policy.check(it, listOf(it)) is PackagePolicy.Verdict.Allow }
        allowlist = ok.map(PackagePolicy::normalize).toSet()
        persist(allowlist)
        if (snapshot.state != State.IDLE) {
            // A running task must not keep an app the user just removed.
            if (snapshot.state == State.RUNNING && allowlist.isEmpty()) stop("allowlist_empty")
        }
        return bad
    }

    fun restoreAllowlist(pkgs: Collection<String>, ownPackage: String) {
        setAllowlist(pkgs, ownPackage)
    }

    fun check(pkg: String?): PackagePolicy.Verdict = policy.check(pkg, allowlist)

    @Synchronized fun start(taskId: String): Boolean {
        if (snapshot.state != State.IDLE || allowlist.isEmpty()) return false
        set(Snapshot(State.RUNNING, null, taskId))
        return true
    }

    @Synchronized fun pause(reason: String): Boolean {
        if (snapshot.state != State.RUNNING) return false
        set(snapshot.copy(state = State.PAUSED, reason = reason))
        return true
    }

    /** Only the user calls this (after seeing why it paused). */
    @Synchronized fun resume(): Boolean {
        if (snapshot.state != State.PAUSED) return false
        set(snapshot.copy(state = State.RUNNING, reason = null))
        return true
    }

    @Synchronized fun stop(reason: String): Boolean {
        if (snapshot.state == State.IDLE) return false
        set(Snapshot(State.IDLE, reason, null))
        return true
    }

    private fun set(s: Snapshot) {
        snapshot = s
        listeners.forEach { it(s) }
    }
}
