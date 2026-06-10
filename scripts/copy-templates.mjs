import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "templates");
const destination = path.join(root, "templates");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
