package app.krish.agent

import app.krish.agent.PhoneSession.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class PhoneSessionTest {
    private val policy = PackagePolicy(File("../../core/security-policy/blocklist.json").readText())
    private val own = "app.krish.agent"
    private fun session(vararg allow: String) = PhoneSession(policy).also { it.setAllowlist(allow.toList(), own) }

    @Test fun allowlistDropsBlockedAndOwnPackages() {
        val s = PhoneSession(policy)
        val rejected = s.setAllowlist(listOf("com.android.chrome", "COM.WHATSAPP", "com.phonepe.app", "app.krish.agent", "bad"), own)
        assertEquals(setOf("com.android.chrome"), s.allowlist)
        assertEquals(4, rejected.size)
    }

    @Test fun cannotStartWithoutAllowedApps() {
        assertFalse(PhoneSession(policy).start("t1"))
        assertFalse(session("com.whatsapp").start("t1"))
        assertTrue(session("com.android.chrome").start("t1"))
    }

    @Test fun checkFollowsAllowlistAndBlocklist() {
        val s = session("com.android.chrome")
        assertEquals(PackagePolicy.Verdict.Allow, s.check("com.android.chrome"))
        assertEquals(PackagePolicy.Verdict.Block("not_allowlisted"), s.check("com.example.x"))
        assertEquals(PackagePolicy.Verdict.Block("empty"), s.check(null))
    }

    @Test fun pauseNeedsUserToResumeAndStopIsFinal() {
        val s = session("com.android.chrome")
        s.start("t1")
        assertTrue(s.pause("left_allowlist"))
        assertEquals(State.PAUSED, s.snapshot.state)
        assertFalse(s.pause("again"))
        assertTrue(s.resume())
        assertEquals(State.RUNNING, s.snapshot.state)
        assertTrue(s.stop("user_stop"))
        assertEquals(PhoneSession.Snapshot(State.IDLE, "user_stop", null), s.snapshot)
        assertFalse(s.resume())
        assertFalse(s.pause("x"))
        assertFalse(s.stop("x"))
    }

    @Test fun removingEveryAppStopsTheRunningTask() {
        val s = session("com.android.chrome")
        s.start("t1")
        s.setAllowlist(emptyList(), own)
        assertEquals(State.IDLE, s.snapshot.state)
        assertEquals("allowlist_empty", s.snapshot.reason)
    }

    @Test fun listenersSeeEveryChangeAndCanUnsubscribe() {
        val s = session("com.android.chrome")
        val seen = mutableListOf<State>()
        val off = s.listen { seen += it.state }
        s.start("t1"); s.pause("x"); s.resume(); s.stop("y")
        off()
        s.start("t2")
        assertEquals(listOf(State.RUNNING, State.PAUSED, State.RUNNING, State.IDLE), seen)
    }

    @Test fun persistsSanitizedAllowlist() {
        var saved: Set<String>? = null
        PhoneSession(policy) { saved = it }.setAllowlist(listOf("com.android.chrome", "com.whatsapp"), own)
        assertEquals(setOf("com.android.chrome"), saved)
    }
}
