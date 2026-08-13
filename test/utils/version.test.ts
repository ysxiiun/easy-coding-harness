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
    expect(design).toContain("用户接受后不回退");
    expect(design).toContain("不重跑 REVIEW");
    expect(usage).toContain("必须区分“用户提出新修复”和“外部保存已产生差异”");
    expect(usage).toContain("保留原 REVIEW 结论");
  });
});
