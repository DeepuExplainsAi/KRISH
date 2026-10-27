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

export const MIN_PASSPHRASE = 8;
const STORE_KEY = "krishVault";
const MAX_ENTRIES = 500;

const enc = new TextEncoder();
const toB64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

interface Blob { v: 1; iter: number; salt: string; iv: string; ct: string }

/** A login saved for this "site" is the default account: it is offered on every site that has no login of its own. */
export const ALL_SITES = "*";

/** "instagram.com", "https://www.instagram.com/x" or "m.instagram.com" -> "instagram.com". "*" stays "*" (every site). */
export const normalizeSite = (input: string): string | undefined => {
  const t = input.trim();
  if (t === ALL_SITES) return ALL_SITES;
  return siteOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
};

/**
 * KrishVault: logins encrypted with a master passphrase (PBKDF2-SHA256 -> AES-256-GCM, fresh IV on every save).
 * The ciphertext is then stored through the platform KeyStore (Android Keystore / OS keychain), so it is encrypted twice.
 * Decrypted entries exist only in memory while unlocked; the vault locks itself after `autoLockMs` without use.
 */
export class Vault {
  private blob?: Blob;
  private key?: CryptoKey;
  private entries: VaultEntry[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  /** Bumped by lock/erase: an unlock or create that was still computing when the vault was locked must not unlock it afterwards. */
  private session = 0;
  /** Every write runs here, one at a time, so two saves can never finish out of order or resurrect an erased vault. */
  private queue: Promise<unknown> = Promise.resolve();
  private loadedOk = false;
  private loadFailed = false;

  constructor(
    private store: KeyStore,
    private opts: { iterations?: number; autoLockMs?: number; now?: () => number } = {},
  ) {}

  /** Reads the stored (still encrypted) vault. If that fails the vault is NOT treated as absent: creating a new one would overwrite it. */
  async load(): Promise<void> {
    try {
      const raw = await this.store.get(STORE_KEY);
      this.blob = raw ? (JSON.parse(raw) as Blob) : undefined;
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
    }
    this.loadedOk = true;
    this.notify();
  }

  get loaded() { return this.loadedOk; }
  /** The stored vault could not be read (storage error or damaged data). Nothing is created or overwritten until a restart reads it. */
  get unreadable() { return this.loadFailed; }
  get exists() { return this.blob !== undefined; }
  get unlocked() { return this.key !== undefined; }
  onChange(cb: () => void) { this.listeners.add(cb); return () => void this.listeners.delete(cb); }
  private notify() { this.listeners.forEach((l) => l()); }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async derive(pass: string, salt: Uint8Array, iter: number) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  private touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lock(), this.opts.autoLockMs ?? 15 * 60_000);
  }

  /** Encrypts `entries` under `key` and stores them. Nothing in memory changes unless storing worked. */
  private async persist(entries: VaultEntry[], key: CryptoKey, base: Blob): Promise<Blob> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(JSON.stringify(entries))));
    const next: Blob = { ...base, iv: toB64(iv), ct: toB64(ct) };
    await this.store.set(STORE_KEY, JSON.stringify(next));
    return next;
  }

  create(pass: string): Promise<void> {
    return this.serial(async () => {
      if (this.loadFailed) throw new VaultError("the saved KrishVault could not be read; restart the app instead of creating a new one");
      if (this.exists) throw new VaultError("KrishVault already exists");
      if (pass.length < MIN_PASSPHRASE) throw new VaultError(`passphrase needs at least ${MIN_PASSPHRASE} characters`);
      const session = this.session;
      const iter = this.opts.iterations ?? 600_000;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await this.derive(pass, salt, iter);
      const blob = await this.persist([], key, { v: 1, iter, salt: toB64(salt), iv: "", ct: "" });
      if (session !== this.session) return;
      this.blob = blob;
      this.key = key;
      this.entries = [];
      this.touch();
      this.notify();
    });
  }

  /** false = wrong passphrase. The passphrase is never stored. */
  async unlock(pass: string): Promise<boolean> {
    if (!this.blob) throw new VaultError("KrishVault does not exist yet");
    const session = this.session;
    const blob = this.blob;
    const key = await this.derive(pass, fromB64(blob.salt), blob.iter);
    let entries: VaultEntry[];
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) as BufferSource }, key, fromB64(blob.ct) as BufferSource);
      entries = JSON.parse(new TextDecoder().decode(plain)) as VaultEntry[];
    } catch {
      return false;
    }
    if (session !== this.session) return false; // locked or erased while the key was being derived
    this.key = key;
    this.entries = entries;
    this.touch();
    this.notify();
    return true;
  }

  lock() {
    this.session++;
    clearTimeout(this.timer);
    this.key = undefined;
    this.entries = [];
    this.notify();
  }

  private open(): VaultEntry[] {
    if (!this.key) throw new VaultError("KrishVault is locked");
    return this.entries;
  }

  /** Reading the list does not count as use: only unlock, add, remove and autofill keep the idle timer going. */
  list(): VaultEntry[] {
    return [...this.open()].sort((a, b) => a.site.localeCompare(b.site) || a.label.localeCompare(b.label));
  }

  /** Writes `next` through the queue; the in-memory list changes only after it was stored, and only if still the same unlocked session. */
  private commit(change: (current: VaultEntry[]) => VaultEntry[]): Promise<void> {
    return this.serial(async () => {
      const key = this.key;
      if (!key || !this.blob) throw new VaultError("KrishVault is locked");
      const session = this.session;
      const next = change(this.entries);
      const blob = await this.persist(next, key, this.blob);
      if (session !== this.session) return;
      this.blob = blob;
      this.entries = next;
      this.touch();
      this.notify();
    });
  }

  async put(input: VaultInput): Promise<VaultEntry> {
    this.open();
    const site = normalizeSite(input.site);
    if (!site) throw new VaultError("enter a site, e.g. instagram.com");
    if (!input.password) throw new VaultError("password is empty");
    const entry: VaultEntry = {
      id: input.id ?? newId(), site, label: (input.label?.trim() || site).slice(0, 80), username: input.username.trim().slice(0, 200),
      password: input.password.slice(0, 500), note: input.note?.trim().slice(0, 2000) || undefined, updatedAt: (this.opts.now ?? Date.now)(),
    };
    await this.commit((cur) => {
      const rest = cur.filter((e) => e.id !== entry.id);
      if (rest.length >= MAX_ENTRIES) throw new VaultError("KrishVault is full");
      return [...rest, entry];
    });
    return entry;
  }

  async remove(id: string) {
    this.open();
    await this.commit((cur) => cur.filter((e) => e.id !== id));
  }

  /** Saved logins for the site of `url`, the site's own first, then the default account(s) for every site. Unlocked only. */
  logins(url: string): VaultEntry[] {
    const site = siteOf(url);
    const entries = this.open();
    this.touch();
    if (!site) return [];
    return [...entries.filter((e) => e.site === site), ...entries.filter((e) => e.site === ALL_SITES)];
  }

  /** Forgot the passphrase: deletes everything. Runs after any save already under way, and no earlier work can bring the vault back. */
  erase(): Promise<void> {
    this.lock();
    return this.serial(async () => {
      await this.store.delete(STORE_KEY);
      this.blob = undefined;
      this.loadFailed = false;
      this.notify();
    });
  }
}

/** The login form of a page: the password field and the plain text field right before it. */
const LOGIN_WALL_TEXT = /(log[\s-]?in|sign[\s-]?in|sign[\s-]?up)\b[^.]{0,40}\b(to continue|or create)|continue with email|create account/i;
const FEDERATED = /\b(google|apple|facebook|microsoft)\b/i;

/**
 * A sign-in wall without a password field yet: an email box next to "Continue with Google", or a page that says
 * "log in or create account" (email-first sites). A newsletter box or a "Sign in" link in a header does not match.
 */
export function findLoginWall(obs: Pick<PageObservation, "text" | "elements">): { username: PageElement; google?: PageElement } | undefined {
  const field = obs.elements.find((e) => !e.disabled && e.tag === "input" && secretKind(e) === undefined && [undefined, "", "text", "email", "tel"].includes(e.type) && /mail|user|phone|login/i.test([e.label, e.name, e.placeholder, e.autocomplete].filter(Boolean).join(" ")));
  if (!field) return undefined;
  const google = obs.elements.find((e) => !e.disabled && (e.tag === "button" || e.tag === "a" || e.role === "button") && FEDERATED.test([e.text, e.label, e.title].filter(Boolean).join(" ")));
  return google || LOGIN_WALL_TEXT.test(obs.text) ? { username: field, google } : undefined;
}

export function findLoginFields(elements: PageElement[]): { password: PageElement; username?: PageElement } | undefined {
  const at = elements.findIndex((e) => !e.disabled && secretKind(e) === "password");
  if (at < 0) return undefined;
  const before = elements.slice(0, at).filter((e) => e.tag === "input" && !e.disabled && secretKind(e) === undefined && [undefined, "", "text", "email", "tel"].includes(e.type));
  const username = before.find((e) => /username|email/i.test(e.autocomplete ?? "")) ?? before[before.length - 1];
  return { password: elements[at]!, username };
}
