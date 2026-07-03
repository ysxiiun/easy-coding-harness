import type { AgentPlatform } from "../types/platform.js";
import type { SupermoduleBoundary } from "../types/supermodule.js";
import type { InstallArtifact } from "../utils/install-manifest.js";
import { configureClaude } from "./claude.js";
import { configureCodex } from "./codex.js";
import { configureQoder } from "./qoder.js";

export interface ConfigureOptions {
  supermodule?: SupermoduleBoundary;
  projectId?: string;
}

export type ConfigureFn = (cwd: string, opts?: ConfigureOptions) => Promise<InstallArtifact[]>;

export const CONFIGURATORS: Record<AgentPlatform, ConfigureFn> = {
  "claude-code": configureClaude,
  codex: configureCodex,
  qoder: configureQoder,
};
