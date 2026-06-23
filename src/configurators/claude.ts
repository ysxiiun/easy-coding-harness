import path from "node:path";
import { PLATFORM_META } from "../types/platform.js";
import {
  type InstallArtifact,
  constraintRegionArtifact,
  fileArtifact,
  hookRegistrationArtifacts,
} from "../utils/install-manifest.js";
import {
  copyPlatformTemplates,
  resolveBundledSkills,
  resolveSkills,
  writeMainConstraint,
  writeSharedHooks,
  writeSkills,
} from "./shared.js";

export async function configureClaude(cwd: string): Promise<InstallArtifact[]> {
  const platform = "claude-code";
  const meta = PLATFORM_META[platform];
  const ctx = meta.templateContext;
  const dest = path.join(cwd, ".claude");
  const hookConfigPath = path.join(cwd, meta.hookConfigFile);
  const artifacts: InstallArtifact[] = [];

  const platformFiles = await copyPlatformTemplates("claude", dest, ["hooks"], ctx);
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
    ...(await writeSharedHooks(path.join(dest, "hooks"), platform)).map((filePath) =>
      fileArtifact(filePath, "hook", platform),
    ),
  );
  artifacts.push(
    ...(
      await writeSkills(
        path.join(cwd, meta.skillsDir),
        await resolveSkills(ctx),
        await resolveBundledSkills(ctx),
      )
    ).map((filePath) => fileArtifact(filePath, "skill", platform)),
  );
  artifacts.push(constraintRegionArtifact(await writeMainConstraint(cwd, platform), platform));

  return artifacts;
}
