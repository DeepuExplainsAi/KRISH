import type { PhoneAction } from "./actions";

/** Apps where automation can get the user's account restricted. Matching is by package prefix. */
export const SOCIAL_PREFIXES = [
  "com.instagram.", "com.facebook.katana", "com.facebook.lite", "com.twitter.", "com.x.", "com.zhiliaoapp.musically", "com.ss.android.ugc.",
  "com.linkedin.", "com.reddit.", "com.pinterest", "com.tumblr", "app.threads", "com.google.android.youtube",
] as const;

export const isSocialApp = (pkg: string | null | undefined) => !!pkg && SOCIAL_PREFIXES.some((p) => pkg.toLowerCase().startsWith(p));

export const INSTAGRAM_WARNING = "Automating Instagram (and other social apps) can get your account limited or banned. Krish slows down and caps actions there, but the risk stays with you.";
export const isInstagram = (pkg: string | null | undefined) => !!pkg && pkg.toLowerCase().startsWith("com.instagram.");

export interface PacingConfig {
  /** Random wait before each action in a social app. */
  minDelayMs: number;
  maxDelayMs: number;
  /** Actions per rolling window per app. */
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
}

export const SOCIAL_PACING: PacingConfig = { minDelayMs: 1200, maxDelayMs: 4500, maxPerMinute: 8, maxPerHour: 120, maxPerDay: 600 };
export const DEFAULT_PACING: PacingConfig = { minDelayMs: 150, maxDelayMs: 500, maxPerMinute: 60, maxPerHour: 2000, maxPerDay: 10_000 };

/** Actions that touch the app (reading or waiting does not count against a rate limit). */
export const countsAsActivity = (a: PhoneAction) => a.type === "tap" || a.type === "type" || a.type === "scroll" || a.type === "back" || a.type === "open_app";

export type Pace = { ok: true; delayMs: number } | { ok: false; retryAfterMs: number; window: "minute" | "hour" | "day" };

const WINDOWS = [
  ["minute", 60_000, "maxPerMinute"],
  ["hour", 3_600_000, "maxPerHour"],
  ["day", 86_400_000, "maxPerDay"],
] as const;

/** Rolling-window limiter, in memory only. `now` and `random` are injectable for tests. */
export class Pacer {
  private times = new Map<string, number[]>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  configFor(pkg: string): PacingConfig {
    return isSocialApp(pkg) ? SOCIAL_PACING : DEFAULT_PACING;
  }

  /** Ask before an action. On `ok`, wait `delayMs`, run it, then call `record`. */
  check(pkg: string, action: PhoneAction): Pace {
    if (!countsAsActivity(action)) return { ok: true, delayMs: 0 };
    const cfg = this.configFor(pkg);
    const t = this.now();
    const list = (this.times.get(pkg) ?? []).filter((x) => t - x < 86_400_000);
    this.times.set(pkg, list);
    for (const [window, ms, key] of WINDOWS) {
      const inWindow = list.filter((x) => t - x < ms);
      if (inWindow.length >= cfg[key]) return { ok: false, window, retryAfterMs: ms - (t - (inWindow[0] ?? t)) };
    }
    return { ok: true, delayMs: Math.round(cfg.minDelayMs + this.random() * (cfg.maxDelayMs - cfg.minDelayMs)) };
  }

  record(pkg: string, action: PhoneAction) {
    if (countsAsActivity(action)) this.times.set(pkg, [...(this.times.get(pkg) ?? []), this.now()]);
  }
}
