import { describe, expect, it } from "vitest";
import { DICTS, LANG_NAMES, resolveLang, translator } from "../src/i18n";
import { en } from "../src/i18n/en";

describe("i18n", () => {
  it("auto follows the device language, falls back to English, and an explicit choice wins", () => {
    expect(resolveLang("auto", "hi-IN")).toBe("hi");
    expect(resolveLang("auto", "pt_BR")).toBe("pt");
    expect(resolveLang("auto", "ja-JP")).toBe("en");
    expect(resolveLang("de", "hi-IN")).toBe("de");
  });
  it("missing keys fall back to English; values are filled in", () => {
    const t = translator("hi");
    expect(t("newChat")).toBe("नई चैट");
    expect(translator("en")("secureNote", { field: "Code", site: "instagram.com" })).toBe("Goes into Code on instagram.com. Not sent to the AI.");
    expect(t("secureNote", { field: "Code", site: "x.com" })).toContain("x.com");
  });
  it("every language only uses real keys and keeps the {placeholders} of the English text", () => {
    for (const [lang, dict] of Object.entries(DICTS)) {
      for (const [k, v] of Object.entries(dict)) {
        expect(k in en, `${lang}.${k}`).toBe(true);
        const vars = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join();
        expect(vars(v as string), `${lang}.${k}`).toBe(vars(en[k as keyof typeof en]));
      }
    }
    expect(Object.keys(LANG_NAMES).sort()).toEqual(Object.keys(DICTS).sort());
  });
});

describe("i18n coverage", () => {
  it("English and Hindi (the owner's language) are complete", () => {
    const missing = (Object.keys(en) as (keyof typeof en)[]).filter((k) => !(k in DICTS.hi));
    expect(missing).toEqual([]);
  });
  it("every t(\"key\") used in the UI exists", () => {
    const files = import.meta.glob(["../src/screens/*.tsx", "../src/components/*.tsx", "../src/App.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const used = new Set<string>();
    for (const src of Object.values(files)) for (const m of src.matchAll(/\btr?\("(\w+)"/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(50);
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });
});
