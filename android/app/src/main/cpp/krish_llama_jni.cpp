#include <jni.h>
#include "llama.h"

// Build/link probe only. Inference, model handling, grammar and safe lifecycle are NOT implemented.
extern "C" JNIEXPORT jstring JNICALL
Java_app_krish_agent_NativeLlama_systemInfo(JNIEnv *env, jobject /* instance */) {
    return env->NewStringUTF(llama_print_system_info());
}
