import { bn } from "./bn";
import { de } from "./de";
import { en, type Dict, type Key } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { hi } from "./hi";
import { pt } from "./pt";

export type { Key };

/** To add a language: create `xx.ts` (`Partial<Dict>`), then add one line here. Missing keys show English. */
export const DICTS = { en, hi, bn, es, fr, de, pt } as const satisfies Record<string, Partial<Dict>>;
export type Lang = keyof typeof DICTS;
export type LangPref = Lang | "auto";

/** Names are written in their own language so a user can always find theirs. */
export const LANG_NAMES: Record<Lang, string> = {
  en: "English", hi: "हिन्दी", bn: "বাংলা", es: "Español", fr: "Français", de: "Deutsch", pt: "Português",
};

export function resolveLang(pref: LangPref, deviceLanguage: string = typeof navigator === "undefined" ? "en" : navigator.language): Lang {
  const code = (pref === "auto" ? deviceLanguage : pref).toLowerCase().split(/[-_]/)[0] ?? "en";
  return code in DICTS ? (code as Lang) : "en";
}

export type T = (key: Key, vars?: Record<string, string>) => string;

export function translator(lang: Lang): T {
  const dict: Partial<Dict> = DICTS[lang];
  return (key, vars) => (dict[key] ?? en[key]).replace(/\{(\w+)\}/g, (m, k: string) => vars?.[k] ?? m);
}
