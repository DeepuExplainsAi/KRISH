package app.krish.agent

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/** Hosts the app UI (local assets only). The agent's browser is a separate, bridge-free WebView. */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(KrishBrowserPlugin::class.java)
        registerPlugin(KrishFilesPlugin::class.java)
        registerPlugin(KrishSecurePlugin::class.java)
        registerPlugin(KrishSystemPlugin::class.java)
        linuxPlugins().forEach { registerPlugin(it) }
        super.onCreate(savedInstanceState)
    }
}
