import path from "node:path";
import {
  CONFIG_FILE,
  DEV_SPEC_DIR,
  EASY_CODING_DIR,
  MAIN_SPEC_DIR,
  MEMORY_DIR,
  SESSIONS_DIR,
  SPEC_DIR,
} from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { AgentPlatform } from "../types/platform.js";
import { createDefaultConfig, writeConfigYaml } from "./config-yaml.js";
import { ensureDir, pathExists, readTextFile, writeTextFile } from "./file-writer.js";
import { getTemplatePath } from "./template-paths.js";

export async function writeRuntimeScaffold(cwd: string, agents: AgentPlatform[]): Promise<void> {
  const easyCodingDir = path.join(cwd, EASY_CODING_DIR);
  await ensureDir(easyCodingDir);

  const configPath = path.join(easyCodingDir, CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    const projectName = path.basename(cwd);
    await writeConfigYaml(
      configPath,
      createDefaultConfig({ projectName, harnessVersion: VERSION, agents }),
    );
  }

  await ensureDir(path.join(easyCodingDir, "tasks"));
  await ensureDir(path.join(easyCodingDir, SESSIONS_DIR));
  await ensureDir(path.join(easyCodingDir, SPEC_DIR, MAIN_SPEC_DIR));
  await ensureDir(path.join(easyCodingDir, SPEC_DIR, DEV_SPEC_DIR));
  await writeMemoryScaffold(easyCodingDir);
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
}
