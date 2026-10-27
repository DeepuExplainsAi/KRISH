import type { ProviderConfig } from "./types";

/**
 * The free service that works with no key: always the last provider tried, so a fresh install answers
 * before the user has added anything. It never sees sign-in or payment pages (allowSensitive stays false).
 */
export const BUILTIN_PROVIDER: ProviderConfig = {
  id: "builtin",
  name: "Free AI",
  kind: "openai-compat",
  baseUrl: "https://text.pollinations.ai/openai",
  enabled: true,
  keyless: true,
  allowSensitive: false,
  defaultModel: "openai-fast",
};
