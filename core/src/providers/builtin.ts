import type { ProviderConfig } from "./types";

const free = (id: string, name: string, baseUrl: string, models: string[]): ProviderConfig => ({
  id, name, kind: "openai-compat", baseUrl, enabled: true, keyless: true, allowSensitive: false,
  defaultModel: models[0], fallbackModel: models[1],
  models: { fetchedAt: 0, items: models.map((m) => ({ id: m })) },
});

/**
 * Free services that answer with no key, tried last and in this order, so a fresh install works before the user adds anything.
 * Each has its own small limit, so when one is busy the next one answers. None of them sees sign-in or payment pages.
 */
export const BUILTIN_PROVIDERS: ProviderConfig[] = [
  free("builtin", "Free AI", "https://text.pollinations.ai/openai", ["openai-fast"]),
  free("builtin-2", "Free AI 2", "https://api.llm7.io/v1", ["default", "gpt-oss:20b", "nemotron-3-nano:30b", "mistral-Nemo-Instruct-2407"]),
];

/** @deprecated use BUILTIN_PROVIDERS; kept for the first entry. */
export const BUILTIN_PROVIDER = BUILTIN_PROVIDERS[0]!;
