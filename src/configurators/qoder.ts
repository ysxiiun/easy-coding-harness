import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../utils/file-writer.js";
import {
  type InstallArtifact,
  constraintRegionArtifact,
  fileArtifact,
  hookRegistrationArtifacts,
} from "../utils/install-manifest.js";
import { resolvePlatformMeta } from "../utils/platform-paths.js";
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

async function claudeHarnessSkillsExist(cwd: string): Promise<boolean> {
  return pathExists(path.join(cwd, ".claude", "skills", "ec-workflow", "SKILL.md"));
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function existingManagedSkillArtifacts(
  skillsDir: string,
  skillNames: string[],
  platform: "qoder",
): Promise<InstallArtifact[]> {
  const artifacts: InstallArtifact[] = [];
  for (const skillName of skillNames) {
    for (const filePath of await listFilesRecursive(path.join(skillsDir, skillName))) {
      artifacts.push(fileArtifact(filePath, "skill", platform));
    }
  }
  return artifacts;
}

export async function configureQoder(
  cwd: string,
  opts: ConfigureOptions = {},
): Promise<InstallArtifact[]> {
  const platform = "qoder";
  const meta = resolvePlatformMeta(cwd, platform);
  const ctx = await withProjectInstallPaths(cwd, meta.templateContext, opts.projectId);
  const dest = path.join(cwd, ctx.platform_config_dir);
  const hookConfigPath = path.join(cwd, meta.hookConfigFile);
  const artifacts: InstallArtifact[] = [];

  const platformFiles = await copyPlatformTemplates("qoder", dest, ["hooks"], ctx);
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

  // Qoder scans both .qoder/skills/ and .claude/skills/ at runtime.
  // Skip writing to .qoder/skills/ when Claude Code skills already exist to avoid duplicates.
  const skills = await resolveSkills(ctx);
  const bundledSkills = await resolveBundledSkills(ctx);
  if (!(await claudeHarnessSkillsExist(cwd))) {
    artifacts.push(
      ...(await writeSkills(path.join(dest, "skills"), skills, bundledSkills)).map((filePath) =>
        fileArtifact(filePath, "skill", platform),
      ),
    );
  } else {
    artifacts.push(
      ...(await existingManagedSkillArtifacts(
        path.join(dest, "skills"),
        [...skills.map((skill) => skill.name), ...bundledSkills.map((skill) => skill.name)],
        platform,
      )),
    );
  }

  artifacts.push(
    constraintRegionArtifact(await writeMainConstraint(cwd, platform, opts), platform),
  );

  return artifacts;
}
export { detectQoderCnVariant } from "../utils/platform-paths.js";
