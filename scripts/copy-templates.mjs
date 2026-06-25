import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "templates");
const destination = path.join(root, "templates");

function shouldCopy(sourcePath) {
  const baseName = path.basename(sourcePath);
  return baseName !== "__pycache__" && !baseName.endsWith(".pyc");
}

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true, filter: shouldCopy });
