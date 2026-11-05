import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTION_GRAMMAR_SCHEMA_JSON, ACTION_JSON_SCHEMA, PhoneActionSchema, parsePhoneAction } from "../../src";

describe("native grammar input", () => {
  it("is derived directly from the phone action schema and keeps every action", () => {
    expect(ACTION_JSON_SCHEMA).toEqual(z.toJSONSchema(PhoneActionSchema));
    const text = JSON.stringify(ACTION_JSON_SCHEMA.oneOf);
    for (const t of ["open_app", "read_screen", "tap", "type", "scroll", "back", "wait", "ask_user", "done"]) expect(text).toContain(`"${t}"`);
  });
  it("drops large string limits only in the grammar copy; the strict parser still enforces them", () => {
    const grammar = JSON.parse(ACTION_GRAMMAR_SCHEMA_JSON);
    expect(JSON.stringify(grammar)).not.toContain("maxLength");
    expect(grammar.oneOf).toHaveLength(ACTION_JSON_SCHEMA.oneOf!.length);
    expect(parsePhoneAction({ type: "done", summary: "x".repeat(501) })).toBeUndefined();
  });
  it("web actions of the old browser agent are no longer accepted", () => {
    for (const type of ["navigate", "click", "paste", "sign_in", "run_sandbox_task"]) expect(parsePhoneAction({ type, url: "https://a.com" })).toBeUndefined();
  });
});
