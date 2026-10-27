export type ThemePref = "auto" | "system" | "light" | "dark";

/** Auto: dark from 19:00 to 06:59 local time, light otherwise. */
export const isNight = (date: Date) => date.getHours() >= 19 || date.getHours() < 7;

/** `auto` follows the clock, `system` follows the device setting, light and dark are fixed. */
export function resolveTheme(pref: ThemePref, systemDark: boolean, now: Date = new Date()): "light" | "dark" {
  if (pref === "auto") return isNight(now) ? "dark" : "light";
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}
