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
} from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { AgentPlatform } from "../types/platform.js";
import type { SupermoduleConfig } from "../types/supermodule.js";
import { createDefaultConfig, writeConfigYaml } from "./config-yaml.js";
import { ensureDir, pathExists, readTextFile, writeTextFile } from "./file-writer.js";
import { getTemplatePath } from "./template-paths.js";

export async function writeRuntimeScaffold(
  cwd: string,
  agents: AgentPlatform[],
  opts: { supermodule?: SupermoduleConfig } = {},
): Promise<void> {
  const easyCodingDir = path.join(cwd, EASY_CODING_DIR);
  await ensureDir(easyCodingDir);

  const configPath = path.join(easyCodingDir, CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    const projectName = path.basename(cwd);
    await writeConfigYaml(
      configPath,
      createDefaultConfig({
        projectName,
        harnessVersion: VERSION,
        agents,
        supermodule: opts.supermodule,
      }),
    );
  }

  await ensureDir(path.join(easyCodingDir, "tasks"));
  await ensureDir(path.join(easyCodingDir, SESSIONS_DIR));
  await ensureDir(path.join(easyCodingDir, SPEC_DIR, MAIN_SPEC_DIR));
  await ensureDir(path.join(easyCodingDir, SPEC_DIR, DEV_SPEC_DIR));
  await writeMemoryScaffold(easyCodingDir);
  await writeTemplatesScaffold(easyCodingDir);
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
