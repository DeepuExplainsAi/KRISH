package app.krish.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenChecksTest {
    @Test fun passwordFieldsAreSecretEvenWithoutTheFlag() {
        assertTrue(ScreenChecks.isSecretInput(true, 0))
        assertTrue(ScreenChecks.isSecretInput(false, 0x81))  // text | password
        assertTrue(ScreenChecks.isSecretInput(false, 0x91))  // text | visible password
        assertTrue(ScreenChecks.isSecretInput(false, 0xe1))  // text | web password
        assertTrue(ScreenChecks.isSecretInput(false, 0x12))  // number | password
        assertFalse(ScreenChecks.isSecretInput(false, 0x1))  // plain text
        assertFalse(ScreenChecks.isSecretInput(false, 0x2))  // plain number
        assertFalse(ScreenChecks.isSecretInput(false, 0x21)) // email address
    }

    @Test fun blankScreenshotsAreDetected() {
        assertTrue(ScreenChecks.isBlank(100, 200) { _, _ -> 0xFF000000.toInt() })
        assertTrue(ScreenChecks.isBlank(100, 200) { _, _ -> 0 })
        assertTrue(ScreenChecks.isBlank(0, 10) { _, _ -> 0xFFFFFFFF.toInt() })
        assertFalse(ScreenChecks.isBlank(100, 200) { _, _ -> 0xFFFFFFFF.toInt() })
        assertFalse(ScreenChecks.isBlank(100, 200) { x, y -> if (x > 50 && y > 100) 0xFF112233.toInt() else 0xFF000000.toInt() })
    }

    @Test fun urlBarIdsOnlyForKnownBrowsers() {
        assertEquals("com.android.chrome:id/url_bar", ScreenChecks.urlBarId("com.android.chrome"))
        assertNull(ScreenChecks.urlBarId("com.instagram.android"))
    }
}
