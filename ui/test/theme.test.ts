import { describe, expect, it } from "vitest";
import { isNight, resolveTheme } from "../src/theme";

const at = (h: number) => new Date(2026, 9, 26, h, 30);

describe("theme", () => {
  it("auto follows the local time: dark from 19:00 to 06:59, light otherwise", () => {
    expect([0, 3, 6, 19, 23].map((h) => isNight(at(h)))).toEqual([true, true, true, true, true]);
    expect([7, 12, 18].map((h) => isNight(at(h)))).toEqual([false, false, false]);
    expect(resolveTheme("auto", false, at(22))).toBe("dark");
    expect(resolveTheme("auto", true, at(12))).toBe("light");
  });
  it("system follows the device, an explicit choice wins", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true, at(23))).toBe("light");
    expect(resolveTheme("dark", false, at(12))).toBe("dark");
  });
});
