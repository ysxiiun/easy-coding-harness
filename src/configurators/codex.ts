import path from "node:path";
import { PLATFORM_META } from "../types/platform.js";
import {
  type InstallArtifact,
  constraintRegionArtifact,
  fileArtifact,
  hookRegistrationArtifacts,
} from "../utils/install-manifest.js";
import type { ConfigureOptions } from "./index.js";
import {
  copyPlatformTemplates,
  resolveBundledSkills,
  resolveSkills,
  withProjectInstallPaths,
  writeMainConstraint,
  writeSharedHooks,
  writeSkills,
} from "./shared.js";

export async function configureCodex(
  cwd: string,
  opts: ConfigureOptions = {},
): Promise<InstallArtifact[]> {
  const platform = "codex";
  const meta = PLATFORM_META[platform];
  const ctx = await withProjectInstallPaths(cwd, meta.templateContext, opts.projectId);
  const hookConfigPath = path.join(cwd, meta.hookConfigFile);
  const artifacts: InstallArtifact[] = [];

  artifacts.push(
    ...(
      await writeSkills(
        path.join(cwd, meta.skillsDir),
        await resolveSkills(ctx),
        await resolveBundledSkills(ctx),
      )
    ).map((filePath) => fileArtifact(filePath, "skill", platform)),
  );
  artifacts.push(
    ...(
      await writeSharedHooks(path.join(cwd, meta.hooksDir), platform, {
        skipSubagentContext: true,
      })
    ).map((filePath) => fileArtifact(filePath, "hook", platform)),
  );

  const platformFiles = await copyPlatformTemplates(
    "codex",
    path.join(cwd, ".codex"),
    ["hooks"],
    ctx,
  );
  artifacts.push(
    ...platformFiles
      .filter((filePath) => filePath !== hookConfigPath)
      .map((filePath) =>
        fileArtifact(
          filePath,
          filePath.startsWith(path.join(cwd, meta.agentsDir)) ? "agent" : "platform-config",
          platform,
        ),
      ),
  );
  artifacts.push(...(await hookRegistrationArtifacts(hookConfigPath, platform)));
  artifacts.push(
    constraintRegionArtifact(await writeMainConstraint(cwd, platform, opts), platform),
  );

  return artifacts;
}
