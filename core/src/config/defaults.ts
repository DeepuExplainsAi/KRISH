// Single editable defaults file. No model names or provider limits live anywhere else.
export const DEFAULTS = {
  agent: {
    maxSteps: 80,
    maxConsecutiveErrors: 3,
    maxStalls: 3,
    observationMaxChars: 6000,
    observationMaxElements: 80,
    readMaxChars: 20000,
    sandboxOutputMaxChars: 4000,
    historyWindow: 16,
    /** The on-screen pointer is given this long to reach a control before the click, so the user sees it arrive. */
    pointerMs: 450,
  },
  router: {
    requestTimeoutMs: 30_000,
    defaultCooldownMs: 30_000,
    maxCooldownMs: 15 * 60_000,
    authCooldownMs: 10 * 60_000,
    circuitThreshold: 3,
    circuitOpenMs: 60_000,
  },
  /**
   * Provider catalog: URL only, the user adds the key and picks models from the live list.
   * `keyUrl` = the provider's own page where the user creates a key. `free` = what is free (limits change: check the page).
   * Links and limits last checked 2026-10-26 (see HANDOFF).
   */
  /** In order of use: OpenCode Zen, OpenRouter and Gemini come first; a new key is placed by this order. */
  presets: [
    { name: "OpenCode Zen", kind: "openai-compat", baseUrl: "https://opencode.ai/zen/v1", keyUrl: "https://opencode.ai/auth", free: "Some models free for a limited time (they may log prompts)" },
    { name: "OpenRouter", kind: "openai-compat", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", free: "Free models (:free): about 20/min, 200/day" },
    { name: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com", keyUrl: "https://aistudio.google.com/apikey", free: "Free tier (not in EU/UK/CH)" },
    { name: "Groq", kind: "openai-compat", baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", free: "Free: about 30 req/min" },
    { name: "Cerebras", kind: "openai-compat", baseUrl: "https://api.cerebras.ai/v1", keyUrl: "https://cloud.cerebras.ai/", free: "Free: about 30 req/min" },
    { name: "Mistral", kind: "openai-compat", baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys", free: "Free tier: about 1 req/s" },
    {
      name: "GitHub Models",
      kind: "openai-compat",
      baseUrl: "https://models.github.ai/inference",
      modelsUrl: "https://models.github.ai/catalog/models",
      keyUrl: "https://github.com/settings/tokens",
      free: "Free with a GitHub token (models scope)",
    },
    { name: "NVIDIA NIM", kind: "openai-compat", baseUrl: "https://integrate.api.nvidia.com/v1", keyUrl: "https://build.nvidia.com/", free: "Free credits" },
    { name: "Hugging Face", kind: "openai-compat", baseUrl: "https://router.huggingface.co/v1", keyUrl: "https://huggingface.co/settings/tokens", free: "About $0.10 free credit per month" },
    { name: "SambaNova", kind: "openai-compat", baseUrl: "https://api.sambanova.ai/v1", keyUrl: "https://cloud.sambanova.ai/apis", free: "Free tier" },
  ],
  /** Regex sources (case-insensitive). Edit freely. */
  patterns: {
    secretField:
      "(pass(word|wd)?|otp|2fa|mfa|cvv|cvc|card.?(number|num|no)|ccnum|\\bpin\\b|security.?code|verification.?code|one.?time)",
  },
} as const;

type Widen<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] };
export type AgentLimits = Widen<typeof DEFAULTS.agent>;
export type RouterConfig = Widen<typeof DEFAULTS.router>;
