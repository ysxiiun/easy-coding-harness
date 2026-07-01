import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { GENERATED_REGION_END, GENERATED_REGION_START } from "../constants/paths.js";
import type { AgentPlatform, TemplateContext } from "../types/platform.js";
import { PLATFORM_META } from "../types/platform.js";
import type { SupermoduleBoundary } from "../types/supermodule.js";
import {
  ensureDir,
  isDirectory,
  pathExists,
  readTextFile,
  readTextIfExists,
  writeTextFile,
} from "../utils/file-writer.js";
import { extractMarkedRegion, replaceMarkedRegion } from "../utils/marked-region.js";
import { getTemplatePath } from "../utils/template-paths.js";

export interface SkillTemplate {
  name: string;
  content: string;
}

export interface BundledSkillTemplate {
  name: string;
  sourceDir: string;
  context: TemplateContext;
}

export interface SharedHookOptions {
  skipSubagentContext?: boolean;
}

export class UnresolvedPlaceholderError extends Error {
  constructor(contentName: string, placeholders: string[]) {
    super(`Unresolved placeholders in ${contentName}: ${placeholders.join(", ")}`);
    this.name = "UnresolvedPlaceholderError";
  }
}

export function resolvePlaceholders(
  content: string,
  ctx: TemplateContext,
  contentName = "template",
): string {
  const withPython = content.replace(/\{\{PYTHON_CMD\}\}/g, ctx.python_cmd);
  const resolved = withPython.replace(/\{\{(\w+)\}\}/g, (match, key: keyof TemplateContext) => {
    const value = ctx[key];
    return value === undefined ? match : String(value);
  });

  const unresolved = [...resolved.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]);
  if (unresolved.length > 0) {
    throw new UnresolvedPlaceholderError(contentName, unresolved);
  }

  return resolved;
}

export async function resolveSkills(ctx: TemplateContext): Promise<SkillTemplate[]> {
  const skillsRoot = getTemplatePath("common", "skills");
  const entries = await readdir(skillsRoot);
  const skills: SkillTemplate[] = [];

  for (const entry of entries.sort()) {
    const skillDir = path.join(skillsRoot, entry);
    if (!(await isDirectory(skillDir))) {
      continue;
    }
    const content = await readTextFile(path.join(skillDir, "SKILL.md"));
    skills.push({
      name: entry,
      content: resolvePlaceholders(content, ctx, `common/skills/${entry}/SKILL.md`),
    });
  }

  return skills;
}

export async function resolveBundledSkills(ctx: TemplateContext): Promise<BundledSkillTemplate[]> {
  const bundledRoot = getTemplatePath("common", "bundled-skills");
  if (!(await pathExists(bundledRoot))) {
    return [];
  }

  const entries = await readdir(bundledRoot);
  const bundled: BundledSkillTemplate[] = [];
  for (const entry of entries.sort()) {
    const sourceDir = path.join(bundledRoot, entry);
    if (await isDirectory(sourceDir)) {
      bundled.push({ name: entry, sourceDir, context: ctx });
    }
  }
  return bundled;
}

export async function writeSkills(
  dir: string,
  skills: SkillTemplate[],
  bundled: BundledSkillTemplate[],
): Promise<string[]> {
  await ensureDir(dir);
  const written: string[] = [];

  for (const skill of skills) {
    const destination = path.join(dir, skill.name, "SKILL.md");
    await writeTextFile(destination, skill.content);
    written.push(destination);
  }

  for (const skill of bundled) {
    written.push(
      ...(await copyTemplateDirectory(skill.sourceDir, path.join(dir, skill.name), skill.context)),
    );
  }

  return written;
}

export async function writeSharedHooks(
  dir: string,
  platform: AgentPlatform,
  opts: SharedHookOptions = {},
): Promise<string[]> {
  const hooksRoot = getTemplatePath("shared-hooks");
  const ctx = PLATFORM_META[platform].templateContext;
  const entries = await readdir(hooksRoot);
  await ensureDir(dir);
  const written: string[] = [];

  for (const entry of entries.sort()) {
    if (opts.skipSubagentContext && entry === "inject-subagent-context.py") {
      continue;
    }
    const sourcePath = path.join(hooksRoot, entry);
    if ((await stat(sourcePath)).isDirectory()) {
      continue;
    }
    const content = resolvePlaceholders(
      await readTextFile(sourcePath),
      ctx,
      `shared-hooks/${entry}`,
    );
    const destination = path.join(dir, entry);
    await writeTextFile(destination, content);
    await import("node:fs/promises").then(({ chmod }) => chmod(destination, 0o755));
    written.push(destination);
  }

  return written;
}

export async function copyPlatformTemplates(
  platformTemplateDir: string,
  destination: string,
  skipDirs: string[],
  ctx: TemplateContext,
): Promise<string[]> {
  const source = getTemplatePath(platformTemplateDir);
  return copyTemplateDirectory(source, destination, ctx, new Set(skipDirs));
}

export async function writeMainConstraint(
  cwd: string,
  platform: AgentPlatform,
  opts: { supermodule?: SupermoduleBoundary } = {},
): Promise<string> {
  const meta = PLATFORM_META[platform];
  const ctx: TemplateContext = {
    ...meta.templateContext,
    supermodule_boundary: renderSupermoduleBoundary(opts.supermodule),
  };
  const templateName = `${meta.mainConstraint}.tpl`;
  const template = await readTextFile(getTemplatePath("main-constraint", templateName));
  const generated = resolvePlaceholders(template, ctx, `main-constraint/${templateName}`);

  if (!generated.includes(GENERATED_REGION_START) || !generated.includes(GENERATED_REGION_END)) {
    throw new Error(`Main constraint template ${templateName} does not contain generated markers.`);
  }

  const destination = path.join(cwd, meta.mainConstraint);
  const current = await readTextIfExists(destination);
  if (current) {
    const markerContent = extractMarkedRegion(generated);
    if (!markerContent) {
      throw new Error(`Main constraint template ${templateName} generated content lacks markers.`);
    }
    await writeTextFile(destination, replaceMarkedRegion(current, markerContent));
  } else {
    await writeTextFile(destination, generated);
  }
  return destination;
}

function renderSupermoduleBoundary(boundary?: SupermoduleBoundary): string {
  if (!boundary || boundary.submodulePaths.length === 0) {
    return "";
  }

  const submodules = boundary.submodulePaths.map((submodulePath) => `- \`${submodulePath}\``);
  return [
    "",
    "## Supermodule Boundary",
    "",
    "This directory is a git supermodule root. The following subdirectories are independent",
    "submodule harness roots with their own git boundaries and Easy Coding runtime:",
    "",
    ...submodules,
    "",
    "- Cross-repo work launched from this root uses the parent `.easy-coding` task, session, state, and spec as the source of truth.",
    "- Child `.easy-coding` directories are not parent workflow state sources.",
    "- During memory archive, technical memory that belongs to a child repo is written only to that child's `.easy-coding/memory`; do not write child task/session/state files from the parent.",
    "- Commit submodule changes in two steps: push each child repo first, then commit and push the parent gitlink update.",
    "- Parent memory should keep cross-repo context; child technical details should follow the owning child repo.",
    "",
  ].join("\n");
}

async function copyTemplateDirectory(
  source: string,
  destination: string,
  ctx: TemplateContext,
  skipDirs = new Set<string>(),
): Promise<string[]> {
  await ensureDir(destination);
  const written: string[] = [];

  for (const entry of (await readdir(source)).sort()) {
    if (skipDirs.has(entry) || shouldSkipTemplateEntry(entry)) {
      continue;
    }

    const sourcePath = path.join(source, entry);
    const destinationPath = path.join(destination, stripTemplateExtension(entry));
    const sourceStat = await stat(sourcePath);

    if (sourceStat.isDirectory()) {
      written.push(...(await copyTemplateDirectory(sourcePath, destinationPath, ctx, skipDirs)));
      continue;
    }

    const content = resolvePlaceholders(await readTextFile(sourcePath), ctx, sourcePath);
    await writeTextFile(destinationPath, content);
    written.push(destinationPath);
  }

  return written;
}

function shouldSkipTemplateEntry(entry: string): boolean {
  return (
    entry === ".DS_Store" ||
    entry === "__pycache__" ||
    entry.endsWith(".ts") ||
    entry.endsWith(".js") ||
    entry.endsWith(".map")
  );
}

function stripTemplateExtension(fileName: string): string {
  return fileName.endsWith(".tpl") ? fileName.slice(0, -4) : fileName;
}
