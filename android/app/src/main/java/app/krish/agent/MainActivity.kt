package app.krish.agent

import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

/** Hosts the app UI (local assets only). The agent's browser is a separate, bridge-free WebView. */
class MainActivity : BridgeActivity() {
    override fun onStart() { super.onStart(); KrishInferencePlugin.foreground() }
    override fun onStop() { KrishInferencePlugin.background(); super.onStop() }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(KrishBrowserPlugin::class.java)
        registerPlugin(KrishFilesPlugin::class.java)
        registerPlugin(KrishSecurePlugin::class.java)
        registerPlugin(KrishSystemPlugin::class.java)
        registerPlugin(KrishLocalPlugin::class.java)
        registerPlugin(KrishInferencePlugin::class.java)
        linuxPlugins().forEach { registerPlugin(it) }
        super.onCreate(savedInstanceState)
        // The agent loop runs in this page; it must keep running while the user's own browser is in front.
        bridge.webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
    }
}
