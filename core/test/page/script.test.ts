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
});
