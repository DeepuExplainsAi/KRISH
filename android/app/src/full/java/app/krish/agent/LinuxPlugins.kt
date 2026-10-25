package app.krish.agent

import com.getcapacitor.Plugin

/** Full flavor: registers the optional Tier 1 plugin (still off until the user enables it in Settings). */
fun linuxPlugins(): List<Class<out Plugin>> = listOf(KrishLinuxPlugin::class.java)
