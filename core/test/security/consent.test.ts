import { describe, expect, it } from "vitest";
import { ConsentStore, CONSENT_VERSION } from "../../src/security/consent";
import { MemoryKV } from "../../src/storage";

describe("ConsentStore", () => {
  it("is not accepted until the user accepts, and can be revoked", async () => {
    const c = new ConsentStore(new MemoryKV());
    expect(await c.accepted()).toBe(false);
    await c.accept();
    expect(await c.accepted()).toBe(true);
    await c.revoke();
    expect(await c.accepted()).toBe(false);
  });
  it("an older version or corrupt data asks again", async () => {
    const kv = new MemoryKV();
    await kv.set("phone-consent", JSON.stringify({ version: CONSENT_VERSION - 1, at: 1 }));
    expect(await new ConsentStore(kv).accepted()).toBe(false);
    await kv.set("phone-consent", "{nope");
    expect(await new ConsentStore(kv).accepted()).toBe(false);
  });
});
