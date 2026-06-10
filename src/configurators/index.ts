import type { AgentPlatform } from "../types/platform.js";
import { configureClaude } from "./claude.js";
import { configureCodex } from "./codex.js";
import { configureQoder } from "./qoder.js";

export type ConfigureFn = (cwd: string) => Promise<void>;

export const CONFIGURATORS: Record<AgentPlatform, ConfigureFn> = {
  "claude-code": configureClaude,
  codex: configureCodex,
  qoder: configureQoder,
};
