import type { ProviderConfig } from "./types";

const free = (id: string, name: string, baseUrl: string, models: string[], anonymousKey?: string): ProviderConfig => ({
  id, name, kind: "openai-compat", baseUrl, enabled: true, keyless: true, ...(anonymousKey ? { anonymousKey } : {}),
  defaultModel: models[0], fallbackModel: models[1],
  models: { fetchedAt: 0, items: models.map((m) => ({ id: m })) },
});

/**
 * Free services that answer with no key, tried last and in this order, so a fresh install works before the user adds anything.
 * The model names here are only the first guess: the app fetches each service's live list (see `syncModels`). Each has its own small limit, so when one is busy the next one answers. None of them sees sign-in or payment pages.
 */
export const BUILTIN_PROVIDERS: ProviderConfig[] = [
  // OpenCode Zen's free models need no account (its own CLI uses the key "public"): the default, tried before everything else.
  free("builtin-zen", "OpenCode Zen (free)", "https://opencode.ai/zen/v1", ["big-pickle", "beam-free"], "public"),
  free("builtin", "Free AI", "https://text.pollinations.ai/openai", ["openai-fast"]),
  free("builtin-2", "Free AI 2", "https://api.llm7.io/v1", ["default", "gpt-oss:20b", "nemotron-3-nano:30b", "minimax-m2.7"]),
];

/** The service tried before the user's own keys; the others are the last resort. */
export const DEFAULT_BUILTIN_ID = "builtin-zen";
