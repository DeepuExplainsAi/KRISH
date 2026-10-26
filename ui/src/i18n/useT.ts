import { useMemo } from "react";
import { useAppSelector } from "../state/useStore";
import { resolveLang, translator, type Lang, type T } from "./index";

export function useT(): { t: T; lang: Lang } {
  const pref = useAppSelector((s) => s.settings.language);
  return useMemo(() => {
    const lang = resolveLang(pref);
    return { t: translator(lang), lang };
  }, [pref]);
}
