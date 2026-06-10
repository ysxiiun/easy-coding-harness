import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PLATFORM_META, type TemplateContext } from "../types/platform.js";
import {
  copyPlatformTemplates,
  resolveBundledSkills,
  resolveSkills,
  writeMainConstraint,
  writeSharedHooks,
  writeSkills,
} from "./shared.js";

function claudeSkillsExist(cwd: string): boolean {
  const claudeSkillsDir = path.join(cwd, ".claude", "skills");
  if (!existsSync(claudeSkillsDir)) return false;
  try {
    return readdirSync(claudeSkillsDir).some((d) => d.startsWith("ec-"));
  } catch {
    return false;
  }
}

export async function configureQoder(cwd: string): Promise<void> {
  const platform = "qoder";
  const baseDir = detectQoderCnVariant(cwd) ? ".qodercn" : ".qoder";
  const ctx: TemplateContext = {
    ...PLATFORM_META[platform].templateContext,
    platform_config_dir: baseDir,
  };
  const dest = path.join(cwd, baseDir);

  await copyPlatformTemplates("qoder", dest, ["hooks"], ctx);
  await writeSharedHooks(path.join(dest, "hooks"), platform);

  // Qoder scans both .qoder/skills/ and .claude/skills/ at runtime.
  // Skip writing to .qoder/skills/ when Claude Code skills already exist to avoid duplicates.
  if (!claudeSkillsExist(cwd)) {
    await writeSkills(
      path.join(dest, "skills"),
      await resolveSkills(ctx),
      await resolveBundledSkills(ctx),
    );
  }

  await writeMainConstraint(cwd, platform);
}

export function detectQoderCnVariant(cwd: string): boolean {
  if (process.env.EC_QODER_VARIANT === "cn" || process.env.QODER_VARIANT === "cn") {
    return true;
  }
  return existsSync(path.join(cwd, ".qodercn"));
}
