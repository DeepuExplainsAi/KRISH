// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "page-script/krish-page.js"), "utf8");
type K = {
  observe(): string;
  read(id?: number): string;
  click(id: number, fp?: string | null): string;
  type(id: number, t: string, submit?: boolean, fp?: string | null): string;
  fill(id: number, v: string, fp?: string | null): string;
  highlight(id?: number | null): string;
  openFileChooser(id: number): string;
  rect(id: number): string;
};
let api: K;
const k = () => api;
const obs = () => JSON.parse(k().observe()) as { url: string; text: string; elements: Record<string, unknown>[] };

beforeEach(() => {
  delete (window as unknown as { __krishState?: unknown }).__krishState;
  document.body.innerHTML = `
    <h1>Hello</h1>
    <form id="f"><label for="q">Search</label><input id="q" name="q" type="text" placeholder="find">
    <input type="password" name="pw" id="pw"><button type="submit">Go</button></form>
    <a href="https://x.test/docs">Docs</a>
    <button id="b" style="display:none">Hidden</button>
    <input type="file" id="file">
    <script>var secret = 1</script>`;
  // test-only: evaluates our own bundled script file, never model text
  // eslint-disable-next-line no-eval
  api = (0, eval)(script) as K;
});

describe("page script", () => {
  it("observes visible interactive elements with labels, skips hidden ones", () => {
    const o = obs();
    const names = o.elements.map((e) => e.label ?? e.text ?? e.name);
    expect(names).toContain("Search");
    expect(names).toContain("Docs");
    expect(names).not.toContain("Hidden");
    expect(o.text).toContain("Hello");
    expect(o.text).not.toContain("secret = 1");
  });

  it("types with native setter and fires input/change events", () => {
    const o = obs();
    const q = o.elements.find((e) => e.name === "q")!;
    let fired = 0;
    document.getElementById("q")!.addEventListener("input", () => fired++);
    k().type(q.id as number, "hello");
    expect((document.getElementById("q") as HTMLInputElement).value).toBe("hello");
    expect(fired).toBe(1);
  });

  it("type with submit requests form submission", () => {
    const o = obs();
    let submitted = false;
    const form = document.getElementById("f") as HTMLFormElement;
    form.requestSubmit = () => void (submitted = true);
    k().type(o.elements.find((e) => e.name === "q")!.id as number, "x", true);
    expect(submitted).toBe(true);
  });

  it("fill sets the secret field value without returning it", () => {
    const o = obs();
    const pw = o.elements.find((e) => e.type === "password")!;
    expect(k().fill(pw.id as number, "S3cret")).toBe("ok");
    expect((document.getElementById("pw") as HTMLInputElement).value).toBe("S3cret");
    expect(JSON.stringify(o)).not.toContain("S3cret");
  });

  it("click triggers handlers", () => {
    let clicked = false;
    document.querySelector("a")!.addEventListener("click", (e) => (e.preventDefault(), (clicked = true)));
    const o = obs();
    k().click(o.elements.find((e) => e.text === "Docs")!.id as number);
    expect(clicked).toBe(true);
  });

  it("highlight adds and removes an overlay", () => {
    const o = obs();
    k().highlight(o.elements[0]!.id as number);
    expect(document.querySelector("[data-krish-overlay]")).not.toBeNull();
    k().highlight(null);
    expect(document.querySelector("[data-krish-overlay]")).toBeNull();
  });

  it("a click shows a pointer and a tap ripple that never catch events or show up as page elements", () => {
    const o = obs();
    const before = o.elements.length;
    k().click(o.elements[0]!.id as number);
    const marks = document.querySelectorAll<HTMLElement>("[data-krish-cursor]");
    expect(marks.length).toBeGreaterThanOrEqual(2); // the pointer and the ripple
    for (const m of marks) expect(m.style.pointerEvents).toBe("none");
    expect(obs().elements.length).toBe(before);
    expect(k().read()).not.toContain("krish");
  });

  it("the native-tap path (rect) shows the pointer and ripple too, and returns the tap position", () => {
    const o = obs();
    const pos = JSON.parse(k().rect(o.elements[0]!.id as number)) as { x: number; y: number };
    expect(typeof pos.x).toBe("number");
    expect(document.querySelectorAll("[data-krish-cursor]").length).toBeGreaterThanOrEqual(2);
  });

  it("lists a hidden file input (with nearby text as its label) but still skips other hidden elements", () => {
    document.body.innerHTML = '<div>Add your photo <input type="file" style="display:none"></div><button style="display:none">Nope</button><input type="file" aria-label="Doc">';
    const els = obs().elements;
    expect(els.map((e) => e.type)).toEqual(["file", "file"]);
    expect(els[0]).toMatchObject({ hidden: true, label: "Add your photo" });
    expect(els[1]!.hidden).toBeUndefined();
    expect(els[1]!.label).toBe("Doc");
    expect(() => k().rect(els[0]!.id as number)).toThrow(/no label/); // never taps an unrelated parent/sibling
  });

  it("a hidden file input with a real <label> is tapped through that label; hidden file inputs are capped so real fields stay visible", () => {
    document.body.innerHTML = '<label for="u">Choose</label><input id="u" type="file" style="display:none">';
    const id = obs().elements[0]!.id as number;
    expect(JSON.parse(k().rect(id)).x).toBeTypeOf("number");
    document.body.innerHTML = '<input type="file" style="display:none">'.repeat(50) + '<input type="password" aria-label="Pw">';
    const els = obs().elements;
    expect(els.filter((e) => e.hidden)).toHaveLength(5);
    expect(els.some((e) => e.type === "password")).toBe(true);
  });

  it("stale ids fail loudly; non-file inputs cannot open the chooser", () => {
    const o = obs();
    document.body.innerHTML = "";
    expect(() => k().click(o.elements[0]!.id as number)).toThrow(/gone/);
    document.body.innerHTML = '<input id="t" type="text">';
    const o2 = obs();
    expect(() => k().openFileChooser(o2.elements[0]!.id as number)).toThrow(/not a file/);
  });

  it("re-injection keeps element ids valid and ignores a page-planted fake window.__krish", () => {
    const o = obs();
    Object.defineProperty(window, "__krish", { value: { click: () => "fake" }, writable: false, configurable: false });
    // eslint-disable-next-line no-eval
    api = (0, eval)(script) as K;
    expect(k().click(o.elements.find((e) => e.text === "Docs")!.id as number)).toBe("ok");
  });

  it("rect returns the element center", () => {
    const o = obs();
    const r = JSON.parse(k().rect(o.elements[0]!.id as number));
    expect(r).toHaveProperty("x");
    expect(r).toHaveProperty("innerWidth");
  });

  it("the API object is frozen", () => {
    expect(() => {
      "use strict";
      (k() as unknown as Record<string, unknown>).click = () => "pwned";
    }).toThrow();
  });

  it("reports effective submit behavior and the element fingerprint", () => {
    const o = obs();
    const go = o.elements.find((e) => e.text === "Go")!;
    expect(go.submits).toBe(true);
    expect(typeof go.fp).toBe("string");
    document.body.insertAdjacentHTML("beforeend", '<form><button>Continue</button></form>');
    const cont = obs().elements.find((e) => e.text === "Continue")!;
    expect(cont.submits).toBe(true); // no type attribute, still submits
  });

  it("numbers the form a control belongs to, so the app can pick the Log in button of the form it filled", () => {
    document.body.innerHTML =
      '<form id="a"><input name="q"><button>Search</button></form>' +
      '<form id="b"><input type="email" name="email"><input type="password" name="pw"><button>Log in</button></form><button>Outside</button>';
    const els = obs().elements;
    const form = (t: string) => els.find((e) => e.text === t || e.name === t)!.form;
    expect(form("Search")).toBe(form("q"));
    expect(form("Log in")).toBe(form("pw"));
    expect(form("Log in")).not.toBe(form("Search"));
    expect(form("Outside")).toBeUndefined();
  });

  it("refuses an element the page swapped into the registry after observation", () => {
    const o = obs();
    const q = o.elements.find((e) => e.name === "q")!;
    const state = (window as unknown as { __krishState: { els: Element[] } }).__krishState;
    const pw = document.getElementById("pw")!;
    state.els[q.id as number] = pw; // hostile page rewrites the registry entry
    expect(() => k().fill(q.id as number, "x", q.fp as string)).toThrow(/changed since/);
    expect((pw as HTMLInputElement).value).toBe("");
    // untouched elements still work with their own fingerprint
    const docs = o.elements.find((e) => e.text === "Docs")!;
    expect(k().click(docs.id as number, docs.fp as string)).toBe("ok");
  });
  it("types into a contenteditable box and keeps its fingerprint after the text changes", () => {
    document.body.innerHTML = '<div id="ed" contenteditable="true" role="textbox" aria-label="Message"></div>';
    const ed = obs().elements.find((e) => e.label === "Message")!;
    expect(ed).toBeTruthy();
    expect(k().type(ed.id as number, "hello", false, ed.fp as string)).toBe("ok");
    expect(document.getElementById("ed")!.textContent).toBe("hello");
    // typing changed the text, but the same element must still pass the identity check
    expect(k().type(ed.id as number, "hello again", false, ed.fp as string)).toBe("ok");
    expect(document.getElementById("ed")!.textContent).toBe("hello again");
  });

  it("a plain input keeps passing the identity check after it was typed into", () => {
    const q = obs().elements.find((e) => e.name === "q")!;
    k().type(q.id as number, "one", false, q.fp as string);
    expect(() => k().type(q.id as number, "two", false, q.fp as string)).not.toThrow();
  });

  it("click sends the press and release events before the click", () => {
    const seen: string[] = [];
    const b = document.getElementById("f")!.querySelector("button")!;
    for (const t of ["mousedown", "mouseup", "click"]) b.addEventListener(t, (e) => { seen.push(e.type); e.preventDefault(); });
    const go = obs().elements.find((e) => e.text === "Go")!;
    k().click(go.id as number, go.fp as string);
    expect(seen.slice(-3)).toEqual(["mousedown", "mouseup", "click"]);
  });

  it("lists elements that are on screen before the rest, and keeps ids matching the list", () => {
    const rects = new Map<Element, { top: number }>();
    document.body.innerHTML = '<button id="far">Far</button><button id="near">Near</button>';
    const far = document.getElementById("far")!;
    const near = document.getElementById("near")!;
    rects.set(far, { top: 5000 });
    rects.set(near, { top: 100 });
    for (const el of [far, near]) {
      el.getBoundingClientRect = () => ({ top: rects.get(el)!.top, bottom: rects.get(el)!.top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: rects.get(el)!.top, toJSON: () => ({}) });
    }
    const o = obs();
    expect(o.elements.map((e) => e.text)).toEqual(["Near", "Far"]);
    expect(k().read(o.elements[0]!.id as number)).toBe("Near");
  });
});
