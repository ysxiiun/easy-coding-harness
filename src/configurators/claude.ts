import path from "node:path";
import { PLATFORM_META } from "../types/platform.js";
import {
  copyPlatformTemplates,
  resolveBundledSkills,
  resolveSkills,
  writeMainConstraint,
  writeSharedHooks,
  writeSkills,
} from "./shared.js";

export async function configureClaude(cwd: string): Promise<void> {
  const platform = "claude-code";
  const meta = PLATFORM_META[platform];
  const ctx = meta.templateContext;
  const dest = path.join(cwd, ".claude");

  await copyPlatformTemplates("claude", dest, ["hooks"], ctx);
  await writeSharedHooks(path.join(dest, "hooks"), platform);
  await writeSkills(
    path.join(cwd, meta.skillsDir),
    await resolveSkills(ctx),
    await resolveBundledSkills(ctx),
  );
  await writeMainConstraint(cwd, platform);
}
