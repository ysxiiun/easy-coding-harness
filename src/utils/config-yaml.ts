import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import YAML, { isScalar, isSeq, parseDocument } from "yaml";
import type { AgentPlatform } from "../types/platform.js";
import type { SupermoduleConfig } from "../types/supermodule.js";
import { writeTextFile } from "./file-writer.js";

export interface EasyCodingConfig {
  version: number;
  harness_version: string;
  agents: AgentPlatform[];
  project: {
    id: string;
    name: string;
  };
  memory: {
    short_term_max: number;
    short_term_keep: number;
    schema_version: number;
  };
  tasks: {
    auto_archive_days: number;
  };
  behavior: {
    strict_confirm: boolean;
    auto_mode: boolean;
  };
  supermodule?: SupermoduleConfig;
  [key: string]: unknown;
}

export function createDefaultConfig(params: {
  projectName: string;
  harnessVersion: string;
  agents: AgentPlatform[];
  supermodule?: SupermoduleConfig;
  projectId?: string;
}): EasyCodingConfig {
  const config: EasyCodingConfig = {
    version: 1,
    harness_version: params.harnessVersion,
    agents: params.agents,
    project: {
      id: params.projectId ?? createProjectId(),
      name: params.projectName,
    },
    memory: {
      short_term_max: 10,
      short_term_keep: 5,
      schema_version: 2,
    },
    tasks: {
      auto_archive_days: 30,
    },
    behavior: {
      strict_confirm: true,
      auto_mode: false,
    },
  };
  if (params.supermodule) {
    config.supermodule = params.supermodule;
  }
  return config;
}

export function stringifyConfig(config: EasyCodingConfig): string {
  return YAML.stringify(config);
}

export async function writeConfigYaml(filePath: string, config: EasyCodingConfig): Promise<void> {
  await writeTextFile(filePath, stringifyConfig(config));
}

export async function readConfigYaml(filePath: string): Promise<EasyCodingConfig> {
  const content = await readFile(filePath, "utf8");
  return YAML.parse(content) as EasyCodingConfig;
}

export async function readProjectIdIfExists(filePath: string): Promise<string | null> {
  try {
    const config = await readConfigYaml(filePath);
    return typeof config.project?.id === "string" && config.project.id.trim()
      ? config.project.id
      : null;
  } catch {
    return null;
  }
}

export async function updateConfigYaml(
  filePath: string,
  updater: (config: EasyCodingConfig) => void,
): Promise<EasyCodingConfig> {
  const content = await readFile(filePath, "utf8");
  const document = parseDocument(content);
  const config = document.toJSON() as EasyCodingConfig;
  updater(config);

  for (const [key, value] of Object.entries(config)) {
    document.set(key, value);
  }

  await writeTextFile(filePath, document.toString());
  return config;
}

export async function addAgentsToConfig(
  filePath: string,
  agents: AgentPlatform[],
): Promise<EasyCodingConfig> {
  return updateConfigYaml(filePath, (config) => {
    const merged = new Set([...(config.agents ?? []), ...agents]);
    config.agents = [...merged];
  });
}

export async function updateHarnessVersion(
  filePath: string,
  version: string,
): Promise<EasyCodingConfig> {
  return updateConfigYaml(filePath, (config) => {
    config.harness_version = version;
  });
}

export async function ensureProjectId(filePath: string): Promise<string> {
  let projectId = "";
  await updateConfigYaml(filePath, (config) => {
    if (!config.project || typeof config.project !== "object") {
      config.project = { id: createProjectId(), name: "" };
    }
    if (typeof config.project.id !== "string" || !config.project.id.trim()) {
      config.project.id = createProjectId();
    }
    projectId = config.project.id;
  });
  return projectId;
}

export async function updateSupermoduleConfig(
  filePath: string,
  supermodule: SupermoduleConfig,
): Promise<EasyCodingConfig> {
  return updateConfigYaml(filePath, (config) => {
    config.supermodule = supermodule;
  });
}

export function yamlHasAgent(documentContent: string, agent: AgentPlatform): boolean {
  const document = parseDocument(documentContent);
  const agents = document.get("agents", true);
  if (!isSeq(agents)) {
    return false;
  }
  return agents.items.some((item) => isScalar(item) && String(item.value) === agent);
}

export function createProjectId(): string {
  return `ec-${randomUUID()}`;
}
