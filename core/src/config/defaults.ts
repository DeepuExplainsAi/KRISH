// Single editable defaults file. No model names or provider limits live anywhere else.
export const DEFAULTS = {
  agent: {
    maxSteps: 30,
    maxConsecutiveErrors: 3,
    maxStalls: 3,
    observationMaxChars: 6000,
    observationMaxElements: 80,
    readMaxChars: 20000,
    sandboxOutputMaxChars: 4000,
    historyWindow: 8,
  },
  router: {
    requestTimeoutMs: 30_000,
    defaultCooldownMs: 30_000,
    maxCooldownMs: 15 * 60_000,
    authCooldownMs: 10 * 60_000,
    circuitThreshold: 3,
    circuitOpenMs: 60_000,
  },
  /** Provider presets: URL only, user adds key and picks models from the live list. */
  presets: [
    { name: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com" },
    { name: "Groq", kind: "openai-compat", baseUrl: "https://api.groq.com/openai/v1" },
    { name: "OpenRouter", kind: "openai-compat", baseUrl: "https://openrouter.ai/api/v1" },
    { name: "Cerebras", kind: "openai-compat", baseUrl: "https://api.cerebras.ai/v1" },
    { name: "Mistral", kind: "openai-compat", baseUrl: "https://api.mistral.ai/v1" },
    {
      name: "GitHub Models",
      kind: "openai-compat",
      baseUrl: "https://models.github.ai/inference",
      modelsUrl: "https://models.github.ai/catalog/models",
    },
  ],
  /** Regex sources (case-insensitive). Edit freely. */
  patterns: {
    sensitiveUrl:
      "(login|log-in|signin|sign-in|sso|oauth|authenticate|checkout|payment|billing|2fa|mfa|verify|password|banking|netbanking|wallet)",
    sensitiveHost: "(bank|paypal|stripe|razorpay|paytm|phonepe|upi|wise\\.com|revolut)",
    secretField:
      "(pass(word|wd)?|otp|2fa|mfa|cvv|cvc|card.?(number|num|no)|ccnum|\\bpin\\b|security.?code|verification.?code|one.?time)",
    cosmeticClick:
      "^(not now|no thanks|maybe later|skip|dismiss|close|got it|reject( all)?|decline|necessary only)$",
    consentClick:
      "\\b(allow|accept( all)?|agree|enable|grant|remember me|save (password|login)|stay signed in|turn on notifications?)\\b",
    riskyClick:
      "\\b(send|submit|post|publish|tweet|reply|share|delete|remove|pay|buy|purchase|place order|subscribe|unsubscribe|confirm|transfer|save changes|update (profile|settings)|deactivate)\\b",
  },
} as const;

type Widen<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] };
export type AgentLimits = Widen<typeof DEFAULTS.agent>;
export type RouterConfig = Widen<typeof DEFAULTS.router>;
