package app.krish.agent

import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

/** Hosts the app UI (local assets only). There is no agent browser: the agent works in the real apps through the Accessibility Service. */
class MainActivity : BridgeActivity() {
    override fun onStart() { super.onStart(); KrishInferencePlugin.foreground() }
    override fun onStop() { KrishInferencePlugin.background(); super.onStop() }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(KrishFilesPlugin::class.java)
        registerPlugin(KrishSecurePlugin::class.java)
        registerPlugin(KrishSystemPlugin::class.java)
        registerPlugin(KrishLocalPlugin::class.java)
        registerPlugin(KrishInferencePlugin::class.java)
        registerPlugin(KrishPhonePlugin::class.java)
        linuxPlugins().forEach { registerPlugin(it) }
        super.onCreate(savedInstanceState)
        // The task engine runs in this page; it must keep running while the controlled app is in front.
        bridge.webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
    }
}
