// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "page-script/krish-page.js"), "utf8");
type K = {
  observe(): string;
  read(id?: number): string;
  click(id: number): string;
  type(id: number, t: string, submit?: boolean): string;
  fill(id: number, v: string): string;
  highlight(id?: number | null): string;
  openFileChooser(id: number): string;
};
const k = () => (window as unknown as { __krish: K }).__krish;
const obs = () => JSON.parse(k().observe()) as { url: string; text: string; elements: Record<string, unknown>[] };

beforeEach(() => {
  delete (window as unknown as { __krish?: K }).__krish;
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
  (0, eval)(script);
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

  it("stale ids fail loudly; non-file inputs cannot open the chooser", () => {
    const o = obs();
    document.body.innerHTML = "";
    expect(() => k().click(o.elements[0]!.id as number)).toThrow(/gone/);
    document.body.innerHTML = '<input id="t" type="text">';
    const o2 = obs();
    expect(() => k().openFileChooser(o2.elements[0]!.id as number)).toThrow(/not a file/);
  });

  it("the API object is frozen", () => {
    expect(() => {
      "use strict";
      (k() as unknown as Record<string, unknown>).click = () => "pwned";
    }).toThrow();
  });
});
