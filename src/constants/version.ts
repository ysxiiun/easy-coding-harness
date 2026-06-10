import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface PackageMetadata {
  name: string;
  version: string;
}

const packageMetadata = readPackageMetadata();

export const PACKAGE_NAME = packageMetadata.name;
export const VERSION = packageMetadata.version;

function readPackageMetadata(): PackageMetadata {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../package.json"),
    path.resolve(here, "../package.json"),
    path.resolve(process.cwd(), "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Partial<PackageMetadata>;
      if (parsed.name && parsed.version) {
        return { name: parsed.name, version: parsed.version };
      }
    } catch {
      // Try the next candidate; source, dist, and installed layouts differ.
    }
  }

  throw new Error(`Unable to locate package metadata. Tried: ${candidates.join(", ")}`);
}
