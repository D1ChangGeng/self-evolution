import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { createServer } from "node:net";
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
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        // Windows sharing violations can be transient while another handle is
        // closing. Retry rename only; never unlink the authoritative target.
        if (
          process.platform !== "win32" ||
          attempt >= 12 ||
          !["EEXIST", "EPERM", "EBUSY", "EACCES"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return true;
}

/** Recover only this atomic writer's regular temporary files whose owner has
 * exited. The caller holds the worktree write lock; never infer death from age
 * or EPERM. No authoritative document is removed. */
export async function recoverInterruptedWrite(path: string): Promise<string[]> {
  if (!(await pathExists(dirname(path)))) return [];
  const prefix = `${basename(path)}.tmp-`;
  const key = createHash("sha256").update(path).digest("hex").slice(0, 8);
  const recovered: string[] = [];
  for (const name of await readdir(dirname(path))) {
    if (!name.startsWith(prefix)) continue;
    const parts = new RegExp(
      `^([1-9][0-9]*)-${key}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    ).exec(name.slice(prefix.length));
    if (!parts) continue;
    try {
      process.kill(Number(parts[1]), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
      const temporary = resolve(dirname(path), name);
      if ((await lstat(temporary)).isFile()) {
        await rm(temporary);
        recovered.push(name);
      }
    }
  }
  return recovered;
}

/** Reject static symlink/reparse traversal at controlled filesystem entry. */
export async function assertNoSymlinks(
  root: string,
  candidate: string,
): Promise<void> {
  const target = safeResolve(root, candidate);
  let cursor = resolve(root);
  for (const part of [
    "",
    ...relative(root, target).split(sep).filter(Boolean),
  ]) {
    cursor = resolve(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink())
        throw new KbError(
          `Symlink/reparse path is not a controlled write target: ${cursor}`,
          3,
          "UNSAFE_PATH",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** OS-owned, process-lifetime mutex. No persistent lock file or stale-lock
 * deletion race: process exit (including SIGKILL) releases the endpoint. */
export async function withKnowledgeLock<T>(
  root: string,
  action: () => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const canonical = await realpath(root);
  const key = createHash("sha256")
    .update(process.platform === "win32" ? canonical.toLowerCase() : canonical)
    .digest("hex");
  if (!["win32", "linux"].includes(process.platform))
    throw new KbError(
      "Controlled writes currently support Windows named pipes and Linux abstract sockets; use reviewed Git edits on this platform.",
      3,
      "WRITE_LOCK_UNAVAILABLE",
    );
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\self-evolution-${key}`
      : `\0self-evolution-${key}`;
  const started = Date.now();
  while (true) {
    const server = createServer((socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    } catch (error) {
      server.close();
      if (
        !["EADDRINUSE", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      if (Date.now() - started >= timeoutMs)
        throw new KbError(
          `Timed out acquiring knowledge write lock: ${canonical}`,
          3,
          "WRITE_LOCK_TIMEOUT",
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
      continue;
    }
    try {
      return await action();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
}

export async function guardedAtomicWrite(
  path: string,
  content: string | Uint8Array,
  expectedSha256: string | null,
  timeoutMs = 5000,
): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  return withKnowledgeLock(
    dirname(path),
    async () => {
      let actual: string | null = null;
      try {
        actual = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (actual !== expectedSha256)
        throw new KbError(
          `Target changed since it was read: ${path}`,
          3,
          "CONCURRENT_WRITE",
        );
      return await atomicWrite(path, content);
    },
    timeoutMs,
  );
}

export async function listFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  if ((await lstat(root)).isSymbolicLink())
    throw new KbError(
      `Directory is a symlink/reparse path: ${root}`,
      3,
      "UNSAFE_PATH",
    );
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
