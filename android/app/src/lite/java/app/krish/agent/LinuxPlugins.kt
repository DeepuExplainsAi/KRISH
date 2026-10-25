package app.krish.agent

import com.getcapacitor.Plugin

/** Lite flavor: no Linux sandbox is packaged. Tier 0 (Web Worker) only. */
fun linuxPlugins(): List<Class<out Plugin>> = emptyList()
