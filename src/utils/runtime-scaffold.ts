import path from "node:path";
import {
  CONFIG_FILE,
  DEV_SPEC_DIR,
  EASY_CODING_DIR,
  MAIN_SPEC_DIR,
  MEMORY_DIR,
  SESSIONS_DIR,
  SPEC_DIR,
  TEMPLATES_DIR,
  TOOLS_DIR,
} from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { AgentPlatform } from "../types/platform.js";
import type { SupermoduleConfig } from "../types/supermodule.js";
import {
  createDefaultConfig,
  createProjectId,
  ensureProjectId,
  writeConfigYaml,
} from "./config-yaml.js";
import {
  ensureDir,
  pathExists,
  readTextFile,
  readTextIfExists,
  writeTextFile,
} from "./file-writer.js";
import { isActiveTask, listTasks } from "./task-json.js";
import { getTemplatePath } from "./template-paths.js";

export async function writeRuntimeScaffold(
  cwd: string,
  agents: AgentPlatform[],
  opts: { supermodule?: SupermoduleConfig; projectId?: string } = {},
): Promise<string> {
  const easyCodingDir = path.join(cwd, EASY_CODING_DIR);
  await ensureDir(easyCodingDir);

  const configPath = path.join(easyCodingDir, CONFIG_FILE);
  let projectId = opts.projectId ?? createProjectId();
  if (!(await pathExists(configPath))) {
    const projectName = path.basename(cwd);
    await writeConfigYaml(
      configPath,
      createDefaultConfig({
        projectName,
        projectId,
        harnessVersion: VERSION,
        agents,
        supermodule: opts.supermodule,
      }),
    );
  } else {
    projectId = await ensureProjectId(configPath);
  }

  await ensureDir(path.join(easyCodingDir, "tasks"));
  await ensureDir(path.join(easyCodingDir, SESSIONS_DIR));
  await ensureDir(path.join(easyCodingDir, SPEC_DIR, MAIN_SPEC_DIR));
  await ensureDir(path.join(easyCodingDir, SPEC_DIR, DEV_SPEC_DIR));
  await writeMemoryScaffold(easyCodingDir);
  await writeTemplatesScaffold(easyCodingDir);
  await writeToolsScaffold(cwd);
  return projectId;
}

export async function runtimeToolUpdates(
  cwd: string,
): Promise<{ path: string; content: string }[]> {
  const frozen = (await listTasks(cwd)).some(
    ({ task }) =>
      isActiveTask(task) &&
      (task.unit_test_mode === "ut" ||
        task.unit_test_mode === "tdd" ||
        (task as unknown as Record<string, unknown>).tdd_enabled === true),
  );
  const updates: { path: string; content: string }[] = [];
  for (const file of ["easy_coding_java_coverage.py", "easy_coding_tdd_readiness.py"]) {
    const target = path.join(cwd, EASY_CODING_DIR, TOOLS_DIR, file);
    const current = await readTextIfExists(target);
    // 活动任务的证据绑定工具内容；任务结束后的 upgrade 再更新，避免全局证据失效。
    if (frozen && current !== null) continue;
    const content = await readTextFile(getTemplatePath("runtime", "tools", file));
    if (content !== current) updates.push({ path: target, content });
  }
  return updates;
}

async function writeToolsScaffold(cwd: string): Promise<void> {
  const toolsDir = path.join(cwd, EASY_CODING_DIR, TOOLS_DIR);
  await ensureDir(toolsDir);
  for (const update of await runtimeToolUpdates(cwd)) {
    await writeTextFile(update.path, update.content);
  }
}

async function writeTemplatesScaffold(easyCodingDir: string): Promise<void> {
  const templatesDir = path.join(easyCodingDir, TEMPLATES_DIR);
  await ensureDir(templatesDir);

  const src = getTemplatePath("runtime", "templates", "dev-spec-skeleton.md");
  const dest = path.join(templatesDir, "dev-spec-skeleton.md");
  await writeTextFile(dest, await readTextFile(src));
}

async function writeMemoryScaffold(easyCodingDir: string): Promise<void> {
  const memoryDir = path.join(easyCodingDir, MEMORY_DIR);
  await ensureDir(path.join(memoryDir, "short"));
  await ensureDir(path.join(memoryDir, "long"));

  for (const file of ["MEMORY.md", "BUSINESS.md", "TECHNICAL.md"]) {
    const destination = path.join(memoryDir, "long", file);
    if (await pathExists(destination)) {
      continue;
    }
    const templatePath = getTemplatePath("runtime", "memory", "long", file);
    await writeTextFile(destination, await readTextFile(templatePath));
  }

  const shortTemplateDest = path.join(memoryDir, "SHORT_MEMORY_TEMPLATE.md");
  if (!(await pathExists(shortTemplateDest))) {
    const templatePath = getTemplatePath("runtime", "memory", "SHORT_MEMORY_TEMPLATE.md");
    await writeTextFile(shortTemplateDest, await readTextFile(templatePath));
  }
}
