import { siteOf } from "../agent/policy";
import { secretKind } from "../privacy/redact";
import type { PageElement, PageObservation } from "../page/types";
import type { KeyStore } from "../storage";
import { newId } from "../memory/stores";

/** One saved login. `note` holds anything else worth keeping safe (security answers, recovery codes). */
export interface VaultEntry {
  id: string;
  /** Registrable domain, e.g. instagram.com. Autofill only happens on the same site. */
  site: string;
  label: string;
  username: string;
  password: string;
  note?: string;
  updatedAt: number;
}

export type VaultInput = Omit<VaultEntry, "id" | "updatedAt" | "label" | "note"> & { id?: string; label?: string; note?: string };

export class VaultError extends Error {}

const STORE_KEY = "krishLogins";
const MAX_ENTRIES = 500;

/** A login saved for this "site" is the default account: it is offered on every site that has no login of its own. */
export const ALL_SITES = "*";

/** "instagram.com", "https://www.instagram.com/x" or "m.instagram.com" -> "instagram.com". "*" stays "*" (every site). */
export const normalizeSite = (input: string): string | undefined => {
  const t = input.trim();
  if (t === ALL_SITES) return ALL_SITES;
  return siteOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
};

/**
 * KrishVault: saved logins, kept for good. They are stored through the platform KeyStore (Android Keystore / OS keychain), which
 * encrypts them at rest; there is no passphrase to type. One login per site and username: saving it again replaces it.
 */
export class Vault {
  private entries: VaultEntry[] = [];
  private listeners = new Set<() => void>();
  /** Every write runs here, one at a time, so two saves can never finish out of order. */
  private queue: Promise<unknown> = Promise.resolve();
  private loadedOk = false;
  private loadFailed = false;

  constructor(private store: KeyStore, private opts: { now?: () => number } = {}) {}

  /** Reads the stored logins. If that fails the vault is NOT treated as empty: saving would overwrite what is stored. */
  async load(): Promise<void> {
    try {
      const raw = await this.store.get(STORE_KEY);
      this.entries = raw ? (JSON.parse(raw) as VaultEntry[]) : [];
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
    }
    this.loadedOk = true;
    this.notify();
  }

  get loaded() { return this.loadedOk; }
  /** The stored logins could not be read (storage error or damaged data). Nothing is overwritten until a restart reads them. */
  get unreadable() { return this.loadFailed; }
  onChange(cb: () => void) { this.listeners.add(cb); return () => void this.listeners.delete(cb); }
  private notify() { this.listeners.forEach((l) => l()); }

  list(): VaultEntry[] {
    return [...this.entries].sort((a, b) => a.site.localeCompare(b.site) || a.label.localeCompare(b.label));
  }

  /** Writes `next` through the queue; the in-memory list changes only after it was stored. */
  private commit(change: (current: VaultEntry[]) => VaultEntry[]): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.loadFailed) throw new VaultError("the saved logins could not be read; restart the app");
      const next = change(this.entries);
      await this.store.set(STORE_KEY, JSON.stringify(next));
      this.entries = next;
      this.notify();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async put(input: VaultInput): Promise<VaultEntry> {
    const site = normalizeSite(input.site);
    if (!site) throw new VaultError("enter a site, e.g. instagram.com");
    if (!input.password) throw new VaultError("password is empty");
    const username = input.username.trim().slice(0, 200);
    let entry!: VaultEntry;
    // Looked up inside the queued change, so two saves of the same login cannot both pass as "new".
    await this.commit((cur) => {
      const same = cur.find((e) => e.site === site && e.username === username);
      entry = {
        id: input.id ?? same?.id ?? newId(), site, label: (input.label?.trim() || (site === ALL_SITES ? "All sites" : site)).slice(0, 80), username,
        password: input.password.slice(0, 500), note: input.note?.trim().slice(0, 2000) || undefined, updatedAt: (this.opts.now ?? Date.now)(),
      };
      const rest = cur.filter((e) => e.id !== entry.id);
      if (rest.length >= MAX_ENTRIES) throw new VaultError("KrishVault is full");
      return [...rest, entry];
    });
    return entry;
  }

  async remove(id: string) {
    await this.commit((cur) => cur.filter((e) => e.id !== id));
  }

  /** Saved logins for the site of `url`, the site's own first, then the default account(s) for every site. */
  logins(url: string): VaultEntry[] {
    const site = siteOf(url);
    if (!site) return [];
    return [...this.entries.filter((e) => e.site === site), ...this.entries.filter((e) => e.site === ALL_SITES)];
  }
}

/** The login form of a page: the password field and the plain text field right before it. */
const LOGIN_WALL_TEXT = /(log[\s-]?in|sign[\s-]?in|sign[\s-]?up)\b[^.]{0,40}\b(to continue|or create)|continue with email|create account/i;
const FEDERATED = /\b(google|apple|facebook|microsoft)\b/i;
const GOOGLE = /\bgoogle\b/i;
const SIGN_IN_HEADING = /\b(log[\s-]?in|sign[\s-]?in)\b/i;

/**
 * A sign-in wall without a password field yet: an email box next to "Continue with Google", or a page that says
 * "log in or create account" (email-first sites). A newsletter box or a "Sign in" link in a header does not match.
 */
export function findLoginWall(obs: Pick<PageObservation, "text" | "elements">): { username: PageElement; google?: PageElement } | undefined {
  const field = obs.elements.find((e) => !e.disabled && e.tag === "input" && secretKind(e) === undefined && [undefined, "", "text", "email", "tel"].includes(e.type) && /mail|user|phone|login/i.test([e.label, e.name, e.placeholder, e.autocomplete].filter(Boolean).join(" ")));
  if (!field) return undefined;
  const buttons = obs.elements.filter((e) => !e.disabled && (e.tag === "button" || e.tag === "a" || e.role === "button"));
  const labelOf = (e: PageElement) => [e.text, e.label, e.title].filter(Boolean).join(" ");
  const google = buttons.find((e) => GOOGLE.test(labelOf(e)));
  const federated = google ?? buttons.find((e) => FEDERATED.test(labelOf(e)));
  // A sign-in heading with an email box and a Continue/Next/Log in button is the first step of a two-step login.
  const twoStep = SIGN_IN_HEADING.test(obs.text.slice(0, 400)) && buttons.some((e) => labelsOf(e).some((l) => SIGN_IN_BUTTON.test(l)) && !labelsOf(e).some((l) => SIGN_UP_BUTTON.test(l)));
  return federated || twoStep || LOGIN_WALL_TEXT.test(obs.text) ? { username: field, google } : undefined;
}

export function findLoginFields(elements: PageElement[]): { password: PageElement; username?: PageElement } | undefined {
  const at = elements.findIndex((e) => !e.disabled && secretKind(e) === "password");
  if (at < 0) return undefined;
  const before = elements.slice(0, at).filter((e) => e.tag === "input" && !e.disabled && secretKind(e) === undefined && [undefined, "", "text", "email", "tel"].includes(e.type));
  const username = before.find((e) => /username|email/i.test(e.autocomplete ?? "")) ?? before[before.length - 1];
  return { password: elements[at]!, username };
}

const SIGN_IN_BUTTON = /^\s*(log[\s-]?in|sign[\s-]?in|continue|next|लॉग\s?इन|लॉगिन|साइन\s?इन|आगे)\s*[.!→>]*\s*$/iu;
const SIGN_UP_BUTTON = /\b(sign[\s-]?up|create|register|join|subscribe|forgot|reset)\b|साइन\s?अप/iu;
const labelsOf = (e: PageElement) => [e.text, e.label, e.title, e.value].filter((x): x is string => Boolean(x)).map((x) => x.trim());

/**
 * The button that sends a filled login form. Looks only at the form (`form`, the number of the password or email box that was just filled)
 * when it has one, and only at buttons whose own label is Log in / Sign in / Continue / Next; "Sign up", "Create account", Google
 * and Apple buttons are never picked. A form with exactly one other submit button is accepted (custom wording). No match = undefined:
 * the model gets to see the page instead of the app guessing.
 */
export function findSignInButton(elements: PageElement[], form?: number): PageElement | undefined {
  const scoped = form !== undefined ? elements.filter((e) => e.form === form) : elements;
  const buttons = scoped.filter((e) => !e.disabled && (e.tag === "button" || e.role === "button" || (e.tag === "input" && ["submit", "button", "image"].includes(e.type ?? ""))) && !labelsOf(e).some((l) => FEDERATED.test(l) || SIGN_UP_BUTTON.test(l)));
  const named = buttons.filter((e) => labelsOf(e).some((l) => SIGN_IN_BUTTON.test(l)));
  const pick = named.find((e) => e.submits) ?? named[0];
  if (pick) return pick;
  const submits = form !== undefined ? buttons.filter((e) => e.submits) : [];
  return submits.length === 1 ? submits[0] : undefined;
}
