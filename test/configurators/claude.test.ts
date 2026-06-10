import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureClaude } from "../../src/configurators/claude.js";
import { writeRuntimeScaffold } from "../../src/utils/runtime-scaffold.js";
import { writeProjectInitTask } from "../../src/utils/task-json.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-claude-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("configureClaude", () => {
  it("writes Claude Code skills, hooks, agents, and CLAUDE.md", async () => {
    await configureClaude(tempDir);

    const skill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`/ec-init`");
    expect(skill).not.toContain("{{");

    const settings = await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8");
    expect(settings).toContain(".claude/hooks/session-start.py");

    const hook = await readFile(
      path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py"),
      "utf8",
    );
    expect(hook).toContain("build_status_context");
    expect(
      await readFile(path.join(tempDir, ".claude", "hooks", "easy_coding_status.py"), "utf8"),
    ).toContain("READY_LINE");

    const main = await readFile(path.join(tempDir, "CLAUDE.md"), "utf8");
    expect(main).toContain("easy-coding-harness generated");
    expect(main).toContain("single Markdown blockquote status line");
    expect(main).toContain(
      "- Ready: > **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks",
    );
    expect(main).not.toContain("[ Easy Coding ] ready");
    expect(main).not.toContain("tasks``");
    expect(main).not.toContain("}```");
    expect(main).toContain("`/ec-init`");
    expect(main).toContain("`/ec-meta`");

    const metaReference = await readFile(
      path.join(
        tempDir,
        ".claude",
        "skills",
        "ec-meta",
        "references",
        "platform-files",
        "README.md",
      ),
      "utf8",
    );
    expect(metaReference).toContain("Claude Code");

    const skillDirs = [
      "ec-analysis",
      "ec-brainstorming",
      "ec-git",
      "ec-implementing",
      "ec-init",
      "ec-memory",
      "ec-meta",
      "ec-reviewing",
      "ec-task-close",
      "ec-task-management",
      "ec-verification",
      "ec-workflow",
    ];
    for (const dir of skillDirs) {
      const content = await readFile(
        path.join(tempDir, ".claude", "skills", dir, "SKILL.md"),
        "utf8",
      );
      expect(content).toContain(`name: ${dir}`);
    }
  });

  it("generated hooks find the Easy Coding root from a subdirectory", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await writeProjectInitTask(tempDir, ["claude-code"]);

    const nested = path.join(tempDir, "src", "nested");
    await mkdir(nested, { recursive: true });
    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: nested,
      input: "{}",
      encoding: "utf8",
    });
    expect(stdout).toContain("> **Easy Coding** · Waiting init · Use `ec-init` to initialize");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).toContain("[easy-coding:init-required]");
    expect(stdout).not.toContain("/ec-init");
    expect(stdout).not.toContain("$ec-init");
  });

  it("generated hooks show Ready when no task is loaded", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain(
      "> **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks",
    );
    expect(stdout).not.toContain("tasks`");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).not.toContain("/ec-workflow");
    expect(stdout).not.toContain("$ec-workflow");
  });

  it("generated hooks migrate legacy state.json and show task status with handoff", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await writeProjectInitTask(tempDir, ["claude-code"]);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"),
      JSON.stringify({ type: "project-init", status: "COMPLETE" }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "state.json"),
      JSON.stringify(
        {
          current_stage: "ANALYSIS",
          current_task: "06-10-demo",
          last_agent: "codex",
          stage_history: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-10-demo"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-10-demo", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          status: "IMPLEMENT",
          created_at: "2026-06-10T00:00:00Z",
          created_by: "codex",
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-10-demo` · `IMPLEMENT` · Handoff -> `codex`");
    expect(stdout).toContain("[workflow-state:IMPLEMENT]");
    expect(stdout).toContain("[current-task:06-10-demo]");
    expect(stdout).toContain("[easy-coding:handoff-from:codex]");
  });

  it("generated hooks show idle state when session points to missing task", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "missing-task",
          created_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `missing-task` · `PENDING`");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).toContain("[current-task:missing-task]");
  });
});
