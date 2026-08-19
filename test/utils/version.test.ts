import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, VERSION } from "../../src/constants/version.js";

describe("version metadata", () => {
  it("uses package.json as the CLI version source", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const packageLock = JSON.parse(await readFile(path.resolve("package-lock.json"), "utf8")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    const introductionHtml = await readFile(path.resolve("docs/introduction.html"), "utf8");
    const design = await readFile(path.resolve("docs/design.md"), "utf8");
    const usage = await readFile(path.resolve("docs/usage.md"), "utf8");

    expect(PACKAGE_NAME).toBe(packageJson.name);
    expect(VERSION).toBe(packageJson.version);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""].version).toBe(packageJson.version);
    expect(introductionHtml).toContain(`版本：<code>${packageJson.version}</code>`);
    expect(design).toContain("用户接受后遵从其 carry-forward、targeted");
    expect(design).toContain("不重复 Review");
    expect(usage).toContain("用户在快照后保存的差异会被完整展示");
    expect(usage).toContain("保留原 Review\n结论");
  });
});
