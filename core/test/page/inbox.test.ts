// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "page-script/krish-page.js"), "utf8");
type K = { findCode(from?: string, subject?: string): string };
let api: K;
const find = (from?: string, subject?: string) => JSON.parse(api.findCode(from, subject)) as { code?: string; link?: string };

beforeEach(() => {
  delete (window as unknown as { __krishState?: unknown }).__krishState;
  // test-only: evaluates our own bundled script file, never model text
  // eslint-disable-next-line no-eval
  api = (0, eval)(script) as K;
});

/** Shaped like a temporary-inbox page: the address at the top, a message list (newest first), no frames. */
const TEMP_INBOX = `
  <header><span id="addr">abc123@tmpbox.test</span> <button>Copy</button> <button>Refresh</button></header>
  <table class="inbox"><tbody>
    <tr class="message"><td>Shop Accounts</td><td>Verify your email</td><td>Your verification code is 482913. It expires in 10 minutes.</td><td>2 min ago</td></tr>
    <tr class="message"><td>Other Site</td><td>Your code</td><td>Use code 111111 to sign in</td><td>1 hour ago</td></tr>
    <tr class="message"><td>News</td><td>Weekly digest 2025</td><td>Read 12 new stories at 10:45</td><td>yesterday</td></tr>
  </tbody></table>`;

describe("page script findCode (read_code)", () => {
  it("takes the code of the newest message (the top row)", () => {
    document.body.innerHTML = TEMP_INBOX;
    expect(find()).toEqual({ code: "482913" });
  });

  it("the sender/subject hint picks the matching message, even when it is not the newest", () => {
    document.body.innerHTML = TEMP_INBOX;
    expect(find("Other Site")).toEqual({ code: "111111" });
    expect(find("", "verify your email")).toEqual({ code: "482913" });
  });

  it("finds nothing when no message matches the hint, and ignores years, times and the address digits", () => {
    document.body.innerHTML = TEMP_INBOX;
    expect(find("Nobody")).toEqual({});
    document.body.innerHTML = `<ul><li class="mail">News: Weekly digest 2025, read at 10:45</li></ul><p>abc123@tmpbox.test</p>`;
    expect(find()).toEqual({});
  });

  it("returns a verification link when the mail has no code; a plain unsubscribe link is not taken", () => {
    document.body.innerHTML = `
      <div role="article" class="message">From: Shop Accounts. Please confirm your account.
        <a href="https://shop.test/unsubscribe">Unsubscribe</a>
        <a href="https://shop.test/account/confirm?token=abc">Confirm email</a>
      </div>`;
    expect(find("Shop")).toEqual({ link: "https://shop.test/account/confirm?token=abc" });
  });

  it("reads an opened message in a same-origin frame (Gmail-like readers and many temp inboxes)", () => {
    document.body.innerHTML = `<div class="inbox-list"><div class="message">Shop Accounts — Verify your email</div></div><iframe id="m"></iframe>`;
    const frame = document.getElementById("m") as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = `<p>Hi! Shop Accounts here.</p><p>Your one-time code:</p><p><strong>7391</strong></p>`;
    expect(find("Shop")).toEqual({ code: "7391" });
  });

  it("a page with no message structure is read only when it looks like a verification mail", () => {
    document.body.innerHTML = `<main><h1>Shop</h1><p>Enter this OTP to finish: 55 44 33? no: 554433</p></main>`;
    expect(find()).toEqual({ code: "554433" });
    document.body.innerHTML = `<main><h1>Prices</h1><p>Plan 1299 per year</p></main>`;
    expect(find()).toEqual({});
  });
});
