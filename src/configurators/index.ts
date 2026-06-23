import type { AgentPlatform } from "../types/platform.js";
import type { InstallArtifact } from "../utils/install-manifest.js";
import { configureClaude } from "./claude.js";
import { configureCodex } from "./codex.js";
import { configureQoder } from "./qoder.js";

export type ConfigureFn = (cwd: string) => Promise<InstallArtifact[]>;

export const CONFIGURATORS: Record<AgentPlatform, ConfigureFn> = {
  "claude-code": configureClaude,
  codex: configureCodex,
  qoder: configureQoder,
};
