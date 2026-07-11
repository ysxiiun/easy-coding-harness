import path from "node:path";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { readConfigYaml } from "./config-yaml.js";
import { pathExists } from "./file-writer.js";

export type VersionComparison = -1 | 0 | 1;

interface ParsedVersion {
  core: number[];
  prerelease: string[] | null;
}

function parseVersion(version: string): ParsedVersion {
  const withoutBuild = String(version ?? "").split("+", 1)[0];
  const separator = withoutBuild.indexOf("-");
  const coreText = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator);
  const prereleaseText = separator === -1 ? "" : withoutBuild.slice(separator + 1);
  const core = coreText.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
  return {
    core,
    prerelease: prereleaseText ? prereleaseText.split(".") : null,
  };
}

function comparePrerelease(left: string[] | null, right: string[] | null): VersionComparison {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number.parseInt(leftPart, 10);
      const rightNumber = Number.parseInt(rightPart, 10);
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a: string, b: string): VersionComparison {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.core.length, right.core.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left.core[index] ?? 0;
    const rightPart = right.core[index] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function isVersionBehind(installed: string, current = VERSION): boolean {
  return compareVersions(installed, current) === -1;
}

export async function checkForUpgrade(cwd: string): Promise<void> {
  const configPath = path.join(cwd, EASY_CODING_DIR, CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    return;
  }

  let config: Awaited<ReturnType<typeof readConfigYaml>>;
  try {
    config = await readConfigYaml(configPath);
  } catch {
    return;
  }

  const installed = String(config.harness_version ?? "");
  if (installed && isVersionBehind(installed)) {
    process.stderr.write(
      `easy-coding harness ${installed} is older than CLI ${VERSION}. Run easy-coding upgrade when ready.\n`,
    );
  }
}
