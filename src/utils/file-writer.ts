import { constants } from "node:fs";
import { access, cp, writeFile as fsWriteFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fsWriteFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readTextFile(filePath);
}

export async function copyDir(source: string, destination: string): Promise<void> {
  await ensureDir(destination);
  await cp(source, destination, { recursive: true });
}

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}
