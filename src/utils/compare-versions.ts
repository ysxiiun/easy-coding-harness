import path from "node:path";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { readConfigYaml } from "./config-yaml.js";
import { pathExists } from "./file-writer.js";

export type VersionComparison = -1 | 0 | 1;

function normalize(version: string): number[] {
  const [core] = String(version ?? "").split("-");
  return core.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
}

export function compareVersions(a: string, b: string): VersionComparison {
  const left = normalize(a);
  const right = normalize(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
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
