import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../../src/constants/version.js";
import { colorizeBanner, renderBanner, selectBannerPreset } from "../../src/ui/banner.js";

const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalColumns) {
    Object.defineProperty(process.stdout, "columns", originalColumns);
  }
});

describe("renderBanner", () => {
  it("uses a thick shadow font on wide terminals", () => {
    expect(selectBannerPreset(120)).toEqual({ font: "ANSI Shadow", horizontalLayout: "full" });
  });

  it("uses a compact shadow font on medium terminals", () => {
    expect(selectBannerPreset(80)).toEqual({ font: "Small Shadow", horizontalLayout: "full" });
  });

  it("uses a compact font on narrow terminals", () => {
    expect(selectBannerPreset(60)).toEqual({ font: "Small Slant" });
  });

  it("preserves figlet block glyphs while coloring the banner", () => {
    const plainOutput = stripVTControlCharacters(colorizeBanner("██\n╚═"));

    expect(plainOutput).toBe("██\n╚═");
  });

  it("prints the product name and current version", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));

    renderBanner();

    const plainOutput = stripVTControlCharacters(output.join("\n"));
    expect(plainOutput).toContain("Easy Coding Harness");
    expect(plainOutput).toContain(`v${VERSION}`);
  });

  it("falls back to a compact font on narrow terminals", () => {
    const output: string[] = [];
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 60 });
    vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));

    expect(() => renderBanner()).not.toThrow();
    expect(stripVTControlCharacters(output.join("\n"))).toContain("Easy Coding Harness");
  });

  it("renders thick block glyphs on wide terminals", () => {
    const output: string[] = [];
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 120 });
    vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));

    renderBanner();

    expect(stripVTControlCharacters(output.join("\n"))).toContain("████");
  });
});
