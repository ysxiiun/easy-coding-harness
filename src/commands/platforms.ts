import { cancel, confirm, multiselect } from "@clack/prompts";
import {
  AGENT_PLATFORMS,
  type AgentPlatform,
  PLATFORM_META,
  isAgentPlatform,
} from "../types/platform.js";
import type { SubmoduleEntry } from "../types/supermodule.js";

export interface PlatformOptions {
  agent?: string;
  yes?: boolean;
  submodules?: string | false;
}

export function parseAgentList(agentList: string): AgentPlatform[] {
  const values = agentList
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error("No agent platform specified.");
  }

  const invalid = values.filter((value) => !isAgentPlatform(value));
  if (invalid.length > 0) {
    throw new Error(`Unknown agent platform: ${invalid.join(", ")}`);
  }

  return [...new Set(values)] as AgentPlatform[];
}

export async function resolvePlatforms(
  opts: PlatformOptions,
  defaults: AgentPlatform[] = ["claude-code"],
): Promise<AgentPlatform[]> {
  if (opts.agent) {
    return parseAgentList(opts.agent);
  }

  if (opts.yes) {
    return defaults;
  }

  let selectedDefaults = defaults;

  while (true) {
    const result = await multiselect({
      message: "Select agent platforms (Space to toggle, Enter to review)",
      options: AGENT_PLATFORMS.map((platform) => ({
        label: PLATFORM_META[platform].label,
        value: platform,
      })),
      initialValues: selectedDefaults,
      required: true,
    });

    if (typeof result === "symbol") {
      cancel("Platform selection cancelled.");
      process.exit(1);
    }

    const labels = result.map((platform) => PLATFORM_META[platform].label).join(", ");
    const shouldInstall = await confirm({
      message: `Install Easy Coding for: ${labels}?`,
      initialValue: true,
    });

    if (typeof shouldInstall === "symbol") {
      cancel("Platform selection cancelled.");
      process.exit(1);
    }

    if (shouldInstall) {
      return result;
    }

    selectedDefaults = result;
  }
}

export function parseSubmoduleList(
  submoduleList: string,
  available: SubmoduleEntry[],
): SubmoduleEntry[] {
  const requested = submoduleList
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    throw new Error("No submodule specified.");
  }

  const byPathOrName = new Map<string, SubmoduleEntry>();
  for (const submodule of available) {
    byPathOrName.set(submodule.path, submodule);
    byPathOrName.set(submodule.name, submodule);
  }

  const selected: SubmoduleEntry[] = [];
  const invalid: string[] = [];
  for (const value of requested) {
    const submodule = byPathOrName.get(value);
    if (!submodule) {
      invalid.push(value);
      continue;
    }
    if (!selected.some((item) => item.path === submodule.path)) {
      selected.push(submodule);
    }
  }

  if (invalid.length > 0) {
    throw new Error(`Unknown or unavailable submodule: ${invalid.join(", ")}`);
  }

  return selected.sort((a, b) => a.path.localeCompare(b.path));
}

export async function resolveSubmodules(
  opts: PlatformOptions,
  available: SubmoduleEntry[],
  defaultSelection: SubmoduleEntry[] = available,
): Promise<SubmoduleEntry[]> {
  if (opts.submodules === false) {
    return [];
  }

  if (typeof opts.submodules === "string") {
    return parseSubmoduleList(opts.submodules, available);
  }

  if (available.length === 0) {
    return [];
  }

  if (opts.yes) {
    return defaultSelection;
  }

  const result = await multiselect({
    message: "Select checked-out submodules to initialize (Space to toggle, Enter to confirm)",
    options: available.map((submodule) => ({
      label: `${submodule.path} (${submodule.name})`,
      value: submodule.path,
    })),
    initialValues: defaultSelection.map((submodule) => submodule.path),
    required: false,
  });

  if (typeof result === "symbol") {
    cancel("Submodule selection cancelled.");
    process.exit(1);
  }

  const selected = new Set(result);
  return available.filter((submodule) => selected.has(submodule.path));
}
