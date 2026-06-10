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

export async function configureCodex(cwd: string): Promise<void> {
  const platform = "codex";
  const meta = PLATFORM_META[platform];
  const ctx = meta.templateContext;

  await writeSkills(
    path.join(cwd, meta.skillsDir),
    await resolveSkills(ctx),
    await resolveBundledSkills(ctx),
  );
  await writeSharedHooks(path.join(cwd, meta.hooksDir), platform, { skipSubagentContext: true });
  await copyPlatformTemplates("codex", path.join(cwd, ".codex"), ["hooks"], ctx);
  await writeMainConstraint(cwd, platform);
}
