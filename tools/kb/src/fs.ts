import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { KbError } from "./types.js";

export function toPosix(value: string): string {
  return value.split(sep).join("/");
}

export function within(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

export function safeResolve(root: string, relativePath: string): string {
  const candidate = resolve(root, relativePath);
  if (!within(root, candidate)) {
    throw new KbError(
      `Path escapes the project root: ${relativePath}`,
      3,
      "PATH_ESCAPE",
    );
  }
  return candidate;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function atomicWrite(
  path: string,
  content: string | Uint8Array,
): Promise<boolean> {
  const bytes =
    typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
  try {
    const current = await readFile(path);
    if (current.equals(bytes)) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${createHash("sha256").update(path).digest("hex").slice(0, 8)}-${randomUUID()}`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")
    ) {
      await rm(path, { force: true });
      await rename(temporary, path);
    } else {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  return true;
}

export async function listFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  await walk(root);
  return result;
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function hashFiles(
  root: string,
  paths: string[],
): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [...paths].sort((a, b) => a.localeCompare(b, "en"))) {
    const absolute = safeResolve(root, path);
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function copyTree(
  source: string,
  destination: string,
): Promise<void> {
  const info = await stat(source);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      await copyTree(
        resolve(source, entry.name),
        resolve(destination, entry.name),
      );
    }
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

export async function writeJson(
  path: string,
  value: unknown,
): Promise<boolean> {
  return atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextUnsafe(
  path: string,
  value: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
