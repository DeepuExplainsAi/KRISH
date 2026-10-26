import { useMemo } from "react";
import { useAppState } from "../state/useStore";
import { resolveLang, translator, type Lang, type T } from "./index";

export function useT(): { t: T; lang: Lang } {
  const pref = useAppState().settings.language;
  return useMemo(() => {
    const lang = resolveLang(pref);
    return { t: translator(lang), lang };
  }, [pref]);
}
