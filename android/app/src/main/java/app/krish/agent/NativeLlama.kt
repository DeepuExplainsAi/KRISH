package app.krish.agent

/** Loaded only inside the :llm service process. */
internal object NativeLlama {
    init { System.loadLibrary("krish_llama") }
    external fun load(path: ByteArray, contextSize: Int)
    external fun complete(messages: ByteArray, schema: ByteArray): ByteArray
    external fun resetStop()
    external fun stop()
    external fun unload()
}
