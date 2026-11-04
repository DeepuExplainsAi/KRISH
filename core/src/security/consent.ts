import type { KVStore } from "../storage";

/** Bump when the consent text, privacy policy or terms change in a way the user must see again. */
export const CONSENT_VERSION = 1;
const KEY = "phone-consent";

interface Record_ {
  version: number;
  at: number;
}

/** Remembers that the user read and accepted the consent screen. No phone-control feature may start without it. */
export class ConsentStore {
  constructor(private kv: KVStore, private now: () => number = Date.now) {}

  async accepted(): Promise<boolean> {
    const raw = await this.kv.get(KEY);
    if (!raw) return false;
    try {
      return (JSON.parse(raw) as Record_).version === CONSENT_VERSION;
    } catch {
      return false;
    }
  }

  accept = () => this.kv.set(KEY, JSON.stringify({ version: CONSENT_VERSION, at: this.now() } satisfies Record_));
  revoke = () => this.kv.delete(KEY);
}
