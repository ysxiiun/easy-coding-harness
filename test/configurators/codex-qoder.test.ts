import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureCodex } from "../../src/configurators/codex.js";
import { configureQoder } from "../../src/configurators/qoder.js";
import { pathExists } from "../../src/utils/file-writer.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-platforms-"));
});

afterEach(async () => {
  delete process.env.EC_QODER_VARIANT;
  await rm(tempDir, { recursive: true, force: true });
});

describe("configureCodex", () => {
  it("writes Codex skills to .agents and platform files to .codex", async () => {
    await configureCodex(tempDir);

    const skill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`$ec-init`");
    expect(skill).not.toContain("{{");

    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "session-start.py"))).toBe(true);
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "easy_coding_status.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "easy_coding_state.py"))).toBe(
      true,
    );
    expect(
      await pathExists(path.join(tempDir, ".codex", "hooks", "inject-workflow-state.py")),
    ).toBe(true);
    expect(
      await pathExists(path.join(tempDir, ".codex", "hooks", "inject-subagent-context.py")),
    ).toBe(false);

    const hooks = await readFile(path.join(tempDir, ".codex", "hooks.json"), "utf8");
    expect(hooks).toContain(".codex/hooks/session-start.py");

    const agent = await readFile(path.join(tempDir, ".codex", "agents", "ec-implementer.toml"), "utf8");
    expect(agent).toContain('name = "ec-implementer"');

    const main = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(main).toContain("Codex: `$ec-*`");
    expect(main).toContain("Qoder: `/ec-*`");
    expect(main).toContain("single Markdown blockquote status line");
    expect(main).toContain(
      "- Ready: > **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks",
    );
    expect(main).not.toContain("[ Easy Coding ] ready");
    expect(main).not.toContain("tasks``");
    expect(main).not.toContain("}```");
  });
});

describe("configureQoder", () => {
  it("writes standard Qoder files under .qoder", async () => {
    await configureQoder(tempDir);

    const skill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`/ec-init`");
    expect(skill).not.toContain("{{");

    const settings = await readFile(path.join(tempDir, ".qoder", "settings.json"), "utf8");
    expect(settings).toContain(".qoder/hooks/session-start.py");
    expect(settings).not.toContain("{{");
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "easy_coding_status.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "easy_coding_state.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "inject-subagent-context.py"))).toBe(
      true,
    );
  });

  it("uses .qodercn when the project already has the China variant directory", async () => {
    await mkdir(path.join(tempDir, ".qodercn"));
    await configureQoder(tempDir);

    const settings = await readFile(path.join(tempDir, ".qodercn", "settings.json"), "utf8");
    expect(settings).toContain(".qodercn/hooks/session-start.py");
    expect(await pathExists(path.join(tempDir, ".qodercn", "hooks", "easy_coding_status.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qodercn", "hooks", "easy_coding_state.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qodercn", "skills", "ec-meta", "SKILL.md"))).toBe(
      true,
    );
  });
});
