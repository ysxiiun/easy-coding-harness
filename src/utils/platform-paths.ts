import { existsSync } from "node:fs";
import path from "node:path";
import { type AgentPlatform, PLATFORM_META, type PlatformMeta } from "../types/platform.js";

export function detectQoderCnVariant(cwd: string): boolean {
  if (process.env.EC_QODER_VARIANT === "cn" || process.env.QODER_VARIANT === "cn") {
    return true;
  }
  return existsSync(path.join(cwd, PLATFORM_META.qoder.cnVariant ?? ".qodercn"));
}

export function resolvePlatformMeta(cwd: string, platform: AgentPlatform): PlatformMeta {
  const meta = PLATFORM_META[platform];
  if (platform !== "qoder" || !detectQoderCnVariant(cwd)) {
    return meta;
  }

  return resolveQoderMetaForBaseDir(meta.cnVariant ?? ".qodercn");
}

export function resolveQoderVariantMetas(): PlatformMeta[] {
  const standardDir = PLATFORM_META.qoder.templateContext.platform_config_dir;
  const cnDir = PLATFORM_META.qoder.cnVariant ?? ".qodercn";
  return [...new Set([standardDir, cnDir])].map(resolveQoderMetaForBaseDir);
}

function resolveQoderMetaForBaseDir(baseDir: string): PlatformMeta {
  const meta = PLATFORM_META.qoder;
  return {
    ...meta,
    skillsDir: `${baseDir}/skills`,
    hooksDir: `${baseDir}/hooks`,
    hookConfigFile: `${baseDir}/settings.json`,
    agentsDir: `${baseDir}/agents`,
    templateContext: {
      ...meta.templateContext,
      platform_config_dir: baseDir,
    },
  };
}
