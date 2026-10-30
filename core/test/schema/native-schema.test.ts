import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTION_GRAMMAR_SCHEMA_JSON, ACTION_JSON_SCHEMA, ActionSchema, parseAction } from "../../src";

describe("native grammar input", () => {
  it("is derived directly from the action schema and preserves discriminators", () => {
    expect(ACTION_JSON_SCHEMA).toEqual(z.toJSONSchema(ActionSchema));
    const alternatives = ACTION_JSON_SCHEMA.oneOf;
    expect(alternatives?.length).toBeGreaterThan(15);
    expect(JSON.stringify(alternatives)).toContain('"navigate"');
    expect(JSON.stringify(alternatives)).toContain('"done"');
  });
  it("loosens large string repetitions only in the first-pass grammar schema", () => {
    const grammar = JSON.parse(ACTION_GRAMMAR_SCHEMA_JSON);
    expect(JSON.stringify(grammar)).not.toContain("maxLength");
    expect(grammar.oneOf).toHaveLength(ACTION_JSON_SCHEMA.oneOf!.length);
    expect(() => parseAction(JSON.stringify({ type: "done", summary: "x".repeat(6001) }))).toThrow();
  });
  it("still requires the semantic HTTPS refinement after grammar filtering", () => {
    expect(() => parseAction('{"type":"navigate","url":"http://example.com"}')).toThrow();
    expect(() => parseAction('{"type":"open_tab","url":"https://user:pass@example.com"}')).toThrow();
    expect(parseAction('{"type":"navigate","url":"https://example.com"}').type).toBe("navigate");
  });
});
