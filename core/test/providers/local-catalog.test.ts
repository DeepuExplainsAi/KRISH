import { describe, expect, it } from "vitest";
import { LOCAL_MODEL_CATALOG, recommendedLocalModel } from "../../src";

describe("on-device model catalog", () => {
  it.each([
    [1, "qwen3.5-0.8b"], [3583, "qwen3.5-0.8b"],
    [3584, "qwen3.5-2b"], [7167, "qwen3.5-2b"],
    [7168, "qwen3.5-4b"], [11263, "qwen3.5-4b"], [11264, "qwen3.5-9b"],
  ])("recommends %s MiB as %s", (ram, id) => {
    expect(recommendedLocalModel(ram)?.id).toBe(id);
  });

  it.each([0, -1, NaN, Infinity])("does not recommend a model for invalid RAM %s", (ram) => {
    expect(recommendedLocalModel(ram)).toBeUndefined();
  });

  it("has distinct pinned entries with hashes and exact byte sizes", () => {
    expect(new Set(LOCAL_MODEL_CATALOG.map((model) => model.id)).size).toBe(4);
    for (const model of LOCAL_MODEL_CATALOG) {
      expect(model.repo).toMatch(/^unsloth\/Qwen3\.5-/);
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.file).toMatch(/-Q4_K_M\.gguf$/);
      expect(Number.isSafeInteger(model.sizeBytes)).toBe(true);
      expect(model.sizeBytes).toBeGreaterThan(0);
    }
  });
});
