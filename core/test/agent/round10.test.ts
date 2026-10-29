import { describe, expect, it } from "vitest";
import {
  AgentController, MemoryKeyStore, parseAction, ActionParseError, runAgent, Vault, generatePassword, passwordRules, rejectionText, maskCodes, isInboxUrl,
  type AgentEvent, type AgentUI, type CodeFound, type PageDriver, type TabInfo,
} from "../../src";
import { ProviderRouter } from "../../src/providers/router";
import { mockFetch, openaiReply, provider, stores } from "../helpers";
import type { PageObservation } from "../../src/page/types";

const A = (o: object) => JSON.stringify(o);

/** A browser with real tabs: each tab has its own url; pages are looked up by url. */
function tabbedDriver(pages: Record<string, Partial<PageObservation>>, start: string, code: CodeFound = {}) {
  let tabs: { id: number; url: string }[] = [{ id: 1, url: start }];
  let active = 1;
  let next = 2;
  const log: string[] = [];
  const secrets: { id: number; value: string; tab: number }[] = [];
  const reads: { tab: number; from?: string; subject?: string }[] = [];
  const cur = () => tabs.find((t) => t.id === active)!;
  const driver: PageDriver = {
    observe: async () => ({ url: cur().url, title: `title ${cur().url}`, text: "", elements: [], ...pages[cur().url] }) as PageObservation,
    navigate: async (u) => void ((cur().url = u), log.push(`navigate ${active} ${u}`)),
    read: async () => pages[cur().url]?.text ?? "",
    click: async (id) => void log.push(`click ${active} ${id}`),
    type: async (id, t) => void log.push(`type ${active} ${id} ${t}`),
    paste: async (id, t) => void log.push(`paste ${active} ${id} ${t}`),
    upload: async () => {},
    fillSecret: async (id, value) => void secrets.push({ id, value, tab: active }),
    scroll: async () => {},
    highlight: async () => {},
    tabs: async (): Promise<TabInfo[]> => tabs.map((t) => ({ id: t.id, title: `title ${t.url}`, url: t.url, active: t.id === active })),
    openTab: async (u) => {
      const id = next++;
      tabs.push({ id, url: u });
      active = id;
      log.push(`open_tab ${id} ${u}`);
      return id;
    },
    switchTab: async (id) => {
      if (!tabs.some((t) => t.id === id)) throw new Error(`no tab ${id}`);
      active = id;
      log.push(`switch_tab ${id}`);
    },
    closeTab: async (id) => {
      tabs = tabs.filter((t) => t.id !== id);
      if (active === id) active = tabs[tabs.length - 1]!.id;
      log.push(`close_tab ${id}`);
    },
    readCode: async (tab, hint) => (reads.push({ tab, ...hint }), code),
  };
  return { driver, log, secrets, reads, activeTab: () => active };
}

function fakeUI(over: Partial<AgentUI> = {}) {
  const events: AgentEvent[] = [];
  const asked: string[] = [];
  const logins: unknown[] = [];
  const ui: AgentUI = {
    ask: async (q) => (asked.push(q), ""),
    askSecure: async () => undefined,
    askLogin: async (req) => (logins.push(req), { signUp: true, username: req.email ?? "me@inbox.test" }),
    solveCaptcha: async () => {},
    pickFile: async () => undefined,
    emit: (e) => events.push(e),
    ...over,
  };
  return { ui, events, asked, logins };
}

async function harness(script: (string | ((prompt: string) => string))[]) {
  const prompts: string[] = [];
  let i = 0;
  const { fn } = mockFetch({
    "a.test": (_u, init) => {
      const prompt = JSON.parse(String(init?.body)).messages[1].content as string;
      prompts.push(prompt);
      const next = script[Math.min(i++, script.length - 1)]!;
      return openaiReply(typeof next === "function" ? next(prompt) : next);
    },
  });
  const s = await stores(["a"]);
  return { router: new ProviderRouter({ ...s, fetch: fn, providers: () => [provider("a")] }), prompts };
}

const run = (task: string, deps: Omit<Parameters<typeof runAgent>[1], "controller">) =>
  runAgent({ task, startOnPage: true, providerWaits: [], pointerMs: 0 }, { ...deps, controller: new AgentController() });

const SIGNUP = "https://shop.test/signup";
const INBOX = "https://inbox.test/";
const signupPage = (over: Partial<PageObservation> = {}): Partial<PageObservation> => ({
  text: "Create your account. Password must be at least 10 characters.",
  elements: [
    { id: 1, tag: "input", type: "email", label: "Email", value: "abc123@inbox.test" },
    { id: 2, tag: "input", type: "password", label: "Password" },
    { id: 3, tag: "input", type: "password", label: "Confirm password" },
    { id: 4, tag: "button", text: "Create account", submits: true },
    { id: 5, tag: "input", type: "text", label: "Verification code", autocomplete: "one-time-code" },
  ],
  ...over,
});

describe("round 10 schema", () => {
  it("accepts the new actions with their strict shapes", () => {
    expect(parseAction(A({ type: "open_tab", url: "https://inbox.test/" }))).toMatchObject({ type: "open_tab" });
    expect(parseAction(A({ type: "switch_tab", tabId: 2 }))).toMatchObject({ tabId: 2 });
    expect(parseAction(A({ type: "close_tab", tabId: 2 }))).toMatchObject({ type: "close_tab" });
    expect(parseAction(A({ type: "read_code", tabId: 2, from: "Shop", subject: "Verify" }))).toMatchObject({ from: "Shop" });
    expect(parseAction(A({ type: "fill_code", elementId: 5 }))).toMatchObject({ elementId: 5 });
    expect(parseAction(A({ type: "sign_up", passwordElementId: 2, confirmElementId: 3, email: "a@b.test" }))).toMatchObject({ type: "sign_up" });
  });
  it.each([
    ["open_tab http", { type: "open_tab", url: "http://x.test/" }],
    ["open_tab extra field", { type: "open_tab", url: "https://x.test/", tabId: 1 }],
    ["switch_tab string id", { type: "switch_tab", tabId: "2" }],
    ["read_code without tab", { type: "read_code" }],
    ["read_code with a code value", { type: "read_code", tabId: 1, code: "123456" }],
    ["fill_code with a value", { type: "fill_code", elementId: 1, text: "123456" }],
    ["sign_up with a password", { type: "sign_up", passwordElementId: 2, password: "hunter2hunter2" }],
    ["sign_up without field", { type: "sign_up" }],
  ])("rejects %s", (_n, o) => {
    expect(() => parseAction(A(o))).toThrow(ActionParseError);
  });
});

describe("tabs in the loop", () => {
  it("open_tab, switch_tab and close_tab route the following actions to the right tab, and TABS lists them", async () => {
    const { router, prompts } = await harness([
      A({ type: "open_tab", url: INBOX }),
      A({ type: "click", elementId: 7 }),
      A({ type: "switch_tab", tabId: 1 }),
      A({ type: "click", elementId: 4 }),
      A({ type: "close_tab", tabId: 2 }),
      A({ type: "done", summary: "ok" }),
    ]);
    const { driver, log } = tabbedDriver({ [SIGNUP]: signupPage(), [INBOX]: { elements: [{ id: 7, tag: "button", text: "Refresh" }] } }, SIGNUP);
    const r = await run("do it", { driver, router, ui: fakeUI().ui });
    expect(r.status).toBe("done");
    expect(log).toEqual([`open_tab 2 ${INBOX}`, "click 2 7", "switch_tab 1", "click 1 4", "close_tab 2"]);
    expect(prompts[1]).toContain("<TABS>");
    expect(prompts[1]).toMatch(/\[2\] title https:\/\/inbox\.test\/ — https:\/\/inbox\.test\/ \(active\)/);
    expect(prompts[0]).not.toContain("<TABS>"); // one tab: no block
  });

  it("refuses a 5th tab and an unknown tab id", async () => {
    const { router, prompts } = await harness([
      A({ type: "open_tab", url: "https://a.test/" }),
      A({ type: "open_tab", url: "https://b.test/" }),
      A({ type: "open_tab", url: "https://c.test/" }),
      A({ type: "open_tab", url: "https://d.test/" }),
      A({ type: "switch_tab", tabId: 9 }),
      A({ type: "done", summary: "ok" }),
    ]);
    const { driver, log } = tabbedDriver({}, SIGNUP);
    await run("tabs", { driver, router, ui: fakeUI().ui });
    expect(log.filter((l) => l.startsWith("open_tab"))).toHaveLength(3);
    expect(prompts[4]).toContain("limit 4");
    expect(prompts[5]).toContain("no tab 9");
  });
});

describe("email code flow", () => {
  it("read_code keeps the code in the app: the model only hears 'found', fill_code puts it into the field, no prompt ever holds it", async () => {
    const { router, prompts } = await harness([
      A({ type: "open_tab", url: INBOX }),
      A({ type: "read_code", tabId: 2, from: "Shop" }),
      A({ type: "switch_tab", tabId: 1 }),
      A({ type: "fill_code", elementId: 5 }),
      A({ type: "done", summary: "verified" }),
    ]);
    const { driver, secrets, reads } = tabbedDriver(
      { [SIGNUP]: signupPage(), [INBOX]: { text: "Shop: Your verification code is 482913. It expires soon. Order 55555" } },
      SIGNUP,
      { code: "482913" },
    );
    const { ui, events } = fakeUI();
    const r = await run("signup karo", { driver, router, ui });
    expect(r.status).toBe("done");
    expect(reads).toEqual([{ tab: 2, from: "Shop", subject: undefined }]);
    expect(secrets).toEqual([{ id: 5, value: "482913", tab: 1 }]);
    for (const p of prompts) expect(p).not.toContain("482913");
    expect(prompts[2]).toContain("a verification code was found");
    expect(prompts[1]).not.toContain("55555"); // an inbox tab hides every 4-8 digit number once a code flow is running
    expect(JSON.stringify(events)).not.toContain("482913");
  });

  it("a read of the inbox tab during a code flow never returns the code digits", async () => {
    const { router, prompts } = await harness([A({ type: "open_tab", url: INBOX }), A({ type: "read_code", tabId: 2 }), A({ type: "read" }), A({ type: "done", summary: "ok" })]);
    const { driver } = tabbedDriver({ [SIGNUP]: signupPage(), [INBOX]: { text: "Shop 482913 welcome" } }, SIGNUP, {});
    await run("t", { driver, router, ui: fakeUI().ui });
    expect(prompts[3]).toContain("Shop [REDACTED:otp] welcome");
    expect(prompts[1]).toContain("Shop [REDACTED:otp] welcome"); // a mail/inbox host is masked from the first look, before read_code
    for (const p of prompts) expect(p).not.toContain("482913");
  });

  it("fill_code without a found code fills nothing; nothing found tells the model to wait and refresh", async () => {
    const { router, prompts } = await harness([
      A({ type: "fill_code", elementId: 5 }),
      A({ type: "open_tab", url: INBOX }),
      A({ type: "read_code", tabId: 2 }),
      A({ type: "done", summary: "x" }),
    ]);
    const { driver, secrets } = tabbedDriver({ [SIGNUP]: signupPage(), [INBOX]: {} }, SIGNUP, {});
    await run("t", { driver, router, ui: fakeUI().ui });
    expect(secrets).toEqual([]);
    expect(prompts[1]).toContain("no code has been found yet");
    expect(prompts[3]).toContain("refresh the inbox");
  });

  it("a verification link is opened by the app in the inbox tab and its address is never shown to the model", async () => {
    const link = "https://shop.test/verify?token=abcdef0123456789secret";
    const { router, prompts } = await harness([A({ type: "open_tab", url: INBOX }), A({ type: "read_code", tabId: 2 }), A({ type: "done", summary: "ok" })]);
    const { driver, log } = tabbedDriver({ [SIGNUP]: signupPage(), [INBOX]: {} }, SIGNUP, { link });
    await run("t", { driver, router, ui: fakeUI().ui });
    expect(log).toContain(`navigate 2 ${link}`);
    for (const p of prompts) expect(p).not.toContain("abcdef0123456789secret");
    expect(prompts[2]).toContain("verification link was found and opened in tab 2");
  });
});

describe("sign_up", () => {
  it("the app makes the password, fills password + confirm, saves the login after the card, and the model never sees it", async () => {
    const { router, prompts } = await harness([A({ type: "sign_up", passwordElementId: 2, confirmElementId: 3 }), A({ type: "click", elementId: 4 }), A({ type: "done", summary: "ok" })]);
    const { driver, secrets } = tabbedDriver({ [SIGNUP]: signupPage() }, SIGNUP);
    const vault = new Vault(new MemoryKeyStore());
    await vault.load();
    const { ui, events, logins } = fakeUI();
    await run("signup karo", { driver, router, ui, vault });
    expect(logins).toEqual([{ site: "shop.test", google: false, signUp: true, email: "abc123@inbox.test" }]);
    expect(secrets.map((s) => s.id)).toEqual([2, 3]);
    const pw = secrets[0]!.value;
    expect(secrets[1]!.value).toBe(pw);
    expect(pw).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z\d]*![A-Za-z\d]*$/);
    expect(pw.length).toBe(14);
    expect(vault.logins(SIGNUP)).toMatchObject([{ username: "abc123@inbox.test", password: pw }]);
    for (const p of prompts) expect(p).not.toContain(pw);
    expect(JSON.stringify(events)).not.toContain(pw);
  });

  it("closing the card creates nothing; a second sign_up on the same site in one command is refused", async () => {
    const declined = await harness([A({ type: "sign_up", passwordElementId: 2 }), A({ type: "done", summary: "x" })]);
    const d1 = tabbedDriver({ [SIGNUP]: signupPage() }, SIGNUP);
    await run("t", { driver: d1.driver, router: declined.router, ui: fakeUI({ askLogin: async () => undefined }).ui });
    expect(d1.secrets).toEqual([]);
    expect(declined.prompts[1]).toContain("did not confirm");

    const twice = await harness([A({ type: "sign_up", passwordElementId: 2 }), A({ type: "sign_up", passwordElementId: 2 }), A({ type: "done", summary: "x" })]);
    const d2 = tabbedDriver({ [SIGNUP]: signupPage() }, SIGNUP);
    const { ui, logins } = fakeUI();
    await run("t", { driver: d2.driver, router: twice.router, ui });
    expect(logins).toHaveLength(1);
    expect(twice.prompts[2]).toContain("One account per site");
  });

  it("refuses a field that is not a password field", async () => {
    const { router, prompts } = await harness([A({ type: "sign_up", passwordElementId: 1 }), A({ type: "done", summary: "x" })]);
    const { driver, secrets } = tabbedDriver({ [SIGNUP]: signupPage() }, SIGNUP);
    await run("t", { driver, router, ui: fakeUI().ui });
    expect(secrets).toEqual([]);
    expect(prompts[1]).toContain("not a password field");
  });
});

describe("policy: a refused email stops the run for the user", () => {
  it("after the model typed an email, a 'temporary emails not supported' page asks the user; an empty answer stops, no other address is tried", async () => {
    const pages: Record<string, Partial<PageObservation>> = { [SIGNUP]: signupPage() };
    const { router, prompts } = await harness([
      A({ type: "type", elementId: 1, text: "abc123@inbox.test" }),
      A({ type: "click", elementId: 4 }),
      A({ type: "type", elementId: 1, text: "other999@inbox.test" }),
      A({ type: "done", summary: "x" }),
    ]);
    const t = tabbedDriver(pages, SIGNUP);
    const click = t.driver.click;
    t.driver.click = async (id) => { await click(id); pages[SIGNUP] = signupPage({ text: "Sorry, temporary emails are not supported. Please use a different email." }); };
    const { ui, asked } = fakeUI();
    const r = await run("signup karo", { driver: t.driver, router, ui });
    expect(r.status).toBe("failed");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("will not try other addresses");
    expect(t.log.filter((l) => l.includes("other999"))).toEqual([]);
    expect(prompts).toHaveLength(2);
  });

  it("sign_up on a page that already says 'already in use' is refused, and typing another address is blocked until the user answers", async () => {
    const { router, prompts } = await harness([
      A({ type: "sign_up", passwordElementId: 2 }),
      A({ type: "type", elementId: 1, text: "new@inbox.test" }),
      A({ type: "done", summary: "x" }),
    ]);
    const t = tabbedDriver({ [SIGNUP]: signupPage({ text: "This email is already in use." }) }, SIGNUP);
    const { ui, logins } = fakeUI();
    await run("t", { driver: t.driver, router, ui });
    expect(logins).toEqual([]);
    expect(prompts[1]).toContain("Do NOT try another address");
    expect(prompts[2]).toContain("blocked:");
    expect(t.log).toEqual([]);
  });

  it("an answer from the user lets the work go on (the user decided)", async () => {
    const pages: Record<string, Partial<PageObservation>> = { [SIGNUP]: signupPage() };
    const { router, prompts } = await harness([A({ type: "type", elementId: 1, text: "abc123@inbox.test" }), A({ type: "click", elementId: 4 }), A({ type: "done", summary: "ok" })]);
    const t = tabbedDriver(pages, SIGNUP);
    const click = t.driver.click;
    t.driver.click = async (id) => { await click(id); pages[SIGNUP] = signupPage({ text: "That email address is already registered." }); };
    const r = await run("t", { driver: t.driver, router, ui: fakeUI({ ask: async () => "use my gmail instead" }).ui });
    expect(r.status).toBe("done");
    expect(prompts[2]).toContain("use my gmail instead");
  });

  it("a rejection text on a site where no email was entered is not acted on", async () => {
    const { router } = await harness([A({ type: "read" }), A({ type: "done", summary: "ok" })]);
    const t = tabbedDriver({ [SIGNUP]: { text: "FAQ: temporary emails are not allowed here." } }, SIGNUP);
    const { ui, asked } = fakeUI();
    const r = await run("read the faq", { driver: t.driver, router, ui });
    expect(r.status).toBe("done");
    expect(asked).toEqual([]);
  });
});

describe("password rules, rejection text, code masking", () => {
  it("reads the form's visible rules", () => {
    expect(passwordRules("")).toEqual({ length: 14, symbols: true });
    expect(passwordRules("Use at least 16 characters")).toEqual({ length: 16, symbols: true });
    expect(passwordRules("8-12 characters, letters and numbers only")).toEqual({ length: 12, symbols: false });
    expect(passwordRules("Maximum 10 characters. No special characters.")).toEqual({ length: 10, symbols: false });
  });
  it("generates passwords that meet the rules", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ length: 14, symbols: true });
      expect(p).toHaveLength(14);
      expect(p.split("!").length - 1).toBe(1);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/\d/);
    }
    expect(generatePassword({ length: 10, symbols: false })).toMatch(/^[A-Za-z\d]{10}$/);
  });
  it("finds a rejection sentence and ignores ordinary text", () => {
    expect(rejectionText("Oops. Disposable email addresses are not allowed. Try again")).toContain("Disposable email addresses are not allowed");
    expect(rejectionText("An account with this email already exists.")).toBeTruthy();
    expect(rejectionText("Please use a different email address")).toBeTruthy();
    expect(rejectionText("Welcome! Check your email for a code.")).toBeUndefined();
  });
  it("knows webmail and temporary-inbox hosts", () => {
    for (const u of ["https://mail.google.com/mail/u/0/", "https://www.smailpro.com/", "https://www.emailnator.com/", "https://22.do/inbox", "https://outlook.live.com/mail/"]) expect(isInboxUrl(u)).toBe(true);
    expect(isInboxUrl("https://shop.test/signup")).toBe(false);
  });
  it("masks codes near code words, and every number on an inbox", () => {
    expect(maskCodes("Your Shop verification code: 123456")).not.toContain("123456");
    expect(maskCodes("Order total 4999 rupees")).toContain("4999");
    expect(maskCodes("Order total 4999 rupees", true)).not.toContain("4999");
    expect(maskCodes("Your address: abc123456@inbox.test. Code 482913.", true)).toBe("Your address: abc123456@inbox.test. Code [REDACTED:otp].");
  });
});
