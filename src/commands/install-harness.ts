import path from "node:path";
import { CONFIGURATORS } from "../configurators/index.js";
import { writeMainConstraint } from "../configurators/shared.js";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { AgentPlatform } from "../types/platform.js";
import type {
  InstallContext,
  SupermoduleBoundary,
  SupermoduleConfig,
} from "../types/supermodule.js";
import { createProjectId, updateSupermoduleConfig } from "../utils/config-yaml.js";
import { ensureEasyCodingSessionsIgnored, ensureHookBytecodeIgnored } from "../utils/gitignore.js";
import { type InstallArtifact, writeInstallManifest } from "../utils/install-manifest.js";
import { writeRuntimeScaffold } from "../utils/runtime-scaffold.js";
import { writeProjectInitTask } from "../utils/task-json.js";

export async function configurePlatformsForDir(
  targetDir: string,
  platforms: AgentPlatform[],
  opts: { supermodule?: SupermoduleBoundary; projectId?: string } = {},
): Promise<InstallArtifact[]> {
  const artifacts: InstallArtifact[] = [];

  for (const platform of platforms) {
    artifacts.push(...(await CONFIGURATORS[platform](targetDir, opts)));
  }

  return artifacts;
}

export async function installHarnessToDir(
  targetDir: string,
  platforms: AgentPlatform[],
  ctx: InstallContext,
): Promise<InstallArtifact[]> {
  const projectId = createProjectId();
  const artifacts = await configurePlatformsForDir(targetDir, platforms, {
    supermodule: boundaryFromContext(ctx),
    projectId,
  });
  await writeRuntimeScaffold(targetDir, platforms, {
    supermodule: supermoduleConfigFromContext(ctx),
    projectId,
  });
  await writeInstallManifest(targetDir, {
    harnessVersion: VERSION,
    agents: platforms,
    artifacts,
  });
  await writeProjectInitTask(targetDir, platforms, {
    initSource: ctx.initSource,
    legacyAssets: ctx.legacyAssets,
    legacyMissingHarnessFiles: ctx.legacyMissingHarnessFiles,
  });
  await ensureEasyCodingSessionsIgnored(targetDir);
  await ensureHookBytecodeIgnored(targetDir);

  return artifacts;
}

export function supermoduleConfigFromContext(ctx: InstallContext): SupermoduleConfig {
  if (ctx.role === "super-parent") {
    return {
      role: "super-parent",
      submodules: ctx.submodulePaths ?? [],
    };
  }

  if (ctx.role === "submodule-child") {
    return {
      role: "submodule-child",
      parent: ctx.parent,
    };
  }

  return { role: "standalone" };
}

export async function refreshSupermoduleParent(
  targetDir: string,
  platforms: AgentPlatform[],
  submodulePaths: string[],
): Promise<void> {
  const supermodule: SupermoduleConfig = {
    role: "super-parent",
    submodules: submodulePaths,
  };
  await updateSupermoduleConfig(path.join(targetDir, EASY_CODING_DIR, CONFIG_FILE), supermodule);

  for (const platform of platforms) {
    await writeMainConstraint(targetDir, platform, {
      supermodule: { submodulePaths },
    });
  }
}

function boundaryFromContext(ctx: InstallContext): SupermoduleBoundary | undefined {
  if (ctx.role !== "super-parent") {
    return undefined;
  }
  return { submodulePaths: ctx.submodulePaths ?? [] };
}
