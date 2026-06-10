import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getTemplateRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../templates"),
    path.resolve(here, "../../templates"),
    path.resolve(process.cwd(), "src/templates"),
    path.resolve(process.cwd(), "templates"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Unable to locate templates directory. Tried: ${candidates.join(", ")}`);
  }
  return found;
}

export function getTemplatePath(...segments: string[]): string {
  return path.join(getTemplateRoot(), ...segments);
}
