import { describe, expect, it } from "vitest";
import { ActionParseError, parseAction, parseReply } from "../../src/schema/actions";

describe("parseAction", () => {
  it("accepts every allowed action", () => {
    const ok = [
      { type: "navigate", url: "https://example.com/a" },
      { type: "read" },
      { type: "read", elementId: 3 },
      { type: "click", elementId: 1 },
      { type: "type", elementId: 1, text: "hi", submit: true },
      { type: "paste", elementId: 2, text: "long text" },
      { type: "upload_selected_file", elementId: 4 },
      { type: "run_sandbox_task", tool: "unzip", code: "", writesFiles: true },
      { type: "run_sandbox_task", tool: "shell", code: "ls", writesFiles: false },
      { type: "wait", ms: 500 },
      { type: "ask_user", question: "Who?" },
      { type: "ask_user", question: "Code?", secure: { kind: "otp", elementId: 2 } },
      { type: "done", summary: "finished" },
    ];
    for (const a of ok) expect(parseAction(JSON.stringify(a)).type).toBe(a.type);
  });

  it("ignores reasoning tags before the JSON", () => {
    expect(parseAction('<think>I should {read} it</think>{"type":"read"}').type).toBe("read");
  });

  it("accepts a json code fence", () => {
    expect(parseAction('```json\n{"type":"read"}\n```').type).toBe("read");
  });

  it.each([
    ["not json", "click the button"],
    ["prose around json", 'Sure! {"type":"read"}'],
    ["unknown action", '{"type":"eval","code":"1"}'],
    ["extra property", '{"type":"read","script":"x"}'],
    ["http url", '{"type":"navigate","url":"http://example.com"}'],
    ["javascript url", '{"type":"navigate","url":"javascript:alert(1)"}'],
    ["file url", '{"type":"navigate","url":"file:///etc/passwd"}'],
    ["url with credentials", '{"type":"navigate","url":"https://u:p@example.com"}'],
    ["negative id", '{"type":"click","elementId":-1}'],
    ["string id", '{"type":"click","elementId":"1"}'],
    ["wait too long", '{"type":"wait","ms":99999}'],
    ["bad sandbox tool", '{"type":"run_sandbox_task","tool":"bash","code":"","writesFiles":false}'],
    ["sandbox missing writesFiles", '{"type":"run_sandbox_task","tool":"zip","code":""}'],
    ["array", "[]"],
    ["null", "null"],
  ])("rejects %s", (_n, raw) => {
    expect(() => parseAction(raw)).toThrow(ActionParseError);
  });
});

describe("parseReply (what the agent loop accepts)", () => {
  it("takes the JSON object out of surrounding prose", () => {
    expect(parseReply('Sure! Here it is: {"type":"done","summary":"a } b"} Hope that helps.', false)).toMatchObject({ type: "done", summary: "a } b" });
  });

  it("first step: plain prose is the answer; later steps still reject it", () => {
    expect(parseReply("Hello there!", true)).toEqual({ type: "done", summary: "Hello there!" });
    expect(() => parseReply("Hello there!", false)).toThrow(ActionParseError);
  });

  it("never turns a broken action into an answer, and the schema still applies inside prose", () => {
    expect(() => parseReply('{"type":"click","elementId":"x"', true)).toThrow(ActionParseError);
    expect(() => parseReply('ok {"type":"eval","code":"1"}', true)).toThrow(ActionParseError);
  });
});
