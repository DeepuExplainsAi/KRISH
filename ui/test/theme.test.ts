import { describe, expect, it } from "vitest";
import { resolveTheme } from "../src/theme";

describe("theme", () => {
  it("system follows the device, an explicit choice wins", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
