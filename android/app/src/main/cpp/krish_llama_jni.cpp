#include <jni.h>
#include <algorithm>
#include <atomic>
#include <stdexcept>
#include <string>
#include <vector>
#include "llama.h"
#include "chat.h"
#include "json-schema-to-grammar.h"

// All methods except stop are serialized by the service worker. This library is loaded only in :llm.
static llama_model * model = nullptr;
static llama_context * ctx = nullptr;
static std::atomic<bool> cancelled{false};
static void unload() {
    if (ctx) llama_free(ctx);
    if (model) llama_model_free(model);
    ctx = nullptr; model = nullptr;
}
static void fail(JNIEnv * env, const char * message) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message);
}
static std::string bytes(JNIEnv * env, jbyteArray array) {
    if (!array) throw std::runtime_error("missing input");
    auto n = env->GetArrayLength(array);
    std::string out(n, '\0');
    env->GetByteArrayRegion(array, 0, n, reinterpret_cast<jbyte *>(out.data()));
    return out;
}
static jbyteArray to_bytes(JNIEnv * env, const std::string & str) {
    jbyteArray out = env->NewByteArray(static_cast<jsize>(str.size()));
    if (out) env->SetByteArrayRegion(out, 0, static_cast<jsize>(str.size()), reinterpret_cast<const jbyte *>(str.data()));
    return out;
}
extern "C" JNIEXPORT void JNICALL Java_app_krish_agent_NativeLlama_resetStop(JNIEnv *, jobject) { cancelled.store(false); }
extern "C" JNIEXPORT void JNICALL Java_app_krish_agent_NativeLlama_stop(JNIEnv *, jobject) { cancelled.store(true); }
extern "C" JNIEXPORT void JNICALL Java_app_krish_agent_NativeLlama_unload(JNIEnv *, jobject) { unload(); }
extern "C" JNIEXPORT void JNICALL Java_app_krish_agent_NativeLlama_load(JNIEnv * env, jobject, jbyteArray path, jint size) {
    try {
        unload();
        llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr); // never log prompts or model data
        llama_backend_init();
        auto mp = llama_model_default_params();
        mp.n_gpu_layers = 0;
        mp.progress_callback = [](float, void *) { return !cancelled.load(); };
        auto filename = bytes(env, path);
        model = llama_model_load_from_file(filename.c_str(), mp);
        if (!model || cancelled.load()) throw std::runtime_error("model load failed or stopped");
        if (!llama_model_chat_template(model, nullptr)) throw std::runtime_error("model chat template missing");
        auto cp = llama_context_default_params();
        cp.n_ctx = static_cast<uint32_t>(size);
        cp.n_batch = 512; cp.n_ubatch = 256;
        cp.n_threads = 4; cp.n_threads_batch = 4;
        ctx = llama_init_from_model(model, cp);
        if (!ctx) throw std::runtime_error("could not create model context");
        llama_set_abort_callback(ctx, [](void *) { return cancelled.load(); }, nullptr);
    } catch (const std::exception &) { unload(); fail(env, "Unable to load on-device model (memory or model error)"); }
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_app_krish_agent_NativeLlama_complete(JNIEnv * env, jobject, jbyteArray messages_data, jbyteArray schema_data) {
    try {
        if (!model || !ctx) throw std::runtime_error("model not loaded");
        auto messages = common_json::parse(bytes(env, messages_data));
        auto schema = common_json::parse(bytes(env, schema_data));
        auto templates = common_chat_templates_init(model, "");
        if (!templates || !common_chat_templates_support_enable_thinking(templates.get())) throw std::runtime_error("thinking control not supported");
        common_chat_templates_inputs inputs;
        inputs.use_jinja = true; inputs.enable_thinking = false;
        inputs.messages = common_chat_msgs_parse_oaicompat(messages);
        auto prompt = common_chat_templates_apply(templates.get(), inputs).prompt;
        const auto * vocab = llama_model_get_vocab(model);
        std::vector<llama_token> tokens;
        bool first = true;
        for (const auto & part : prompt.parts) {
            int count = -llama_tokenize(vocab, part.text.data(), static_cast<int32_t>(part.text.size()), nullptr, 0, first, !part.is_input);
            if (count < 0) throw std::runtime_error("tokenization failed");
            std::vector<llama_token> tmp(count);
            int n = llama_tokenize(vocab, part.text.data(), static_cast<int32_t>(part.text.size()), tmp.data(), count, first, !part.is_input);
            if (n < 0) throw std::runtime_error("tokenization failed");
            tokens.insert(tokens.end(), tmp.begin(), tmp.begin() + n);
            first = false;
        }
        if (tokens.empty() || tokens.size() + 256 >= llama_n_ctx(ctx)) throw std::runtime_error("prompt is too long");
        const auto grammar = json_schema_to_grammar(schema);
        llama_sampler * sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
        if (!sampler) throw std::runtime_error("sampler failed");
        struct SamplerGuard { llama_sampler * p; ~SamplerGuard() { llama_sampler_free(p); } } guard{sampler};
        auto grammar_sampler = llama_sampler_init_grammar(vocab, grammar.c_str(), "root");
        if (!grammar_sampler) throw std::runtime_error("grammar failed");
        llama_sampler_chain_add(sampler, grammar_sampler);
        llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
        llama_memory_clear(llama_get_memory(ctx), true);
        llama_batch_ext * batch = llama_batch_ext_init(ctx);
        if (!batch) throw std::runtime_error("batch failed");
        struct BatchGuard { llama_batch_ext * p; ~BatchGuard() { llama_batch_ext_free(p); } } bg{batch};
        int pos = 0;
        auto evaluate = [&](const llama_token * t, int count) {
            llama_batch_ext_clear(batch);
            for (int i = 0; i < count; ++i) {
                auto idx = llama_batch_ext_add_token(batch, 0, t[i]);
                llama_pos p = pos + i;
                llama_batch_ext_set_pos(batch, idx, &p);
            }
            llama_batch_ext_set_output_logits(batch, count - 1, true);
            if (cancelled.load() || llama_process(ctx, LLAMA_PROCESS_TYPE_DECODE, batch) != 0) throw std::runtime_error("generation stopped or failed");
            pos += count;
        };
        for (size_t i = 0; i < tokens.size(); i += 512) evaluate(tokens.data() + i, static_cast<int>(std::min<size_t>(512, tokens.size() - i)));
        std::string output;
        for (int i = 0; i < 1024 && pos < static_cast<int>(llama_n_ctx(ctx)); ++i) {
            if (cancelled.load()) throw std::runtime_error("generation stopped");
            llama_token token = llama_sampler_sample(sampler, ctx, -1);
            if (llama_vocab_is_eog(vocab, token)) return to_bytes(env, output);
            char piece[1024];
            int n = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
            if (n < 0) throw std::runtime_error("token too large");
            output.append(piece, n);
            if (output.size() > 65536) throw std::runtime_error("output too long");
            evaluate(&token, 1);
        }
        throw std::runtime_error("generation limit reached"); // never accept truncated JSON
    } catch (const std::exception &) { fail(env, "On-device generation failed or was stopped"); return nullptr; }
}
