package app.krish.agent

/** Link probe for the pinned native library. Not registered with the app or used for inference yet. */
internal object NativeLlama {
    init { System.loadLibrary("krish_llama") }
    external fun systemInfo(): String
}
