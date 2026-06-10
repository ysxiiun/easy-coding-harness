import path from "node:path";
import { pathExists } from "./file-writer.js";

export type ProjectMode = "startup" | "iterative";

const codeSignals = [
  "package.json",
  "pom.xml",
  "build.gradle",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
];

export async function detectProjectMode(cwd: string): Promise<ProjectMode> {
  for (const signal of codeSignals) {
    if (await pathExists(path.join(cwd, signal))) {
      return "iterative";
    }
  }
  return "startup";
}
