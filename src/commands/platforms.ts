import { cancel, confirm, multiselect } from "@clack/prompts";
import {
  AGENT_PLATFORMS,
  type AgentPlatform,
  PLATFORM_META,
  isAgentPlatform,
} from "../types/platform.js";

export interface PlatformOptions {
  agent?: string;
  yes?: boolean;
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
