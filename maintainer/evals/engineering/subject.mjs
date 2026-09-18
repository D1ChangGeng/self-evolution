import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { stableJson } from "../contract.mjs";
import { gunzipSync } from "node:zlib";
import { safe } from "./workspace.mjs";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export async function distribution(root) {
  const files = {};
  async function walk(directory, prefix = "") {
    for (const name of (await readdir(directory)).sort()) {
      const path = resolve(directory, name);
      const relative = prefix + name;
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error(`Subject symlink: ${relative}`);
      if (info.isDirectory()) await walk(path, relative + "/");
      else if (info.isFile()) files[relative] = digest(await readFile(path));
      else throw new Error(`Unsupported subject file: ${relative}`);
    }
  }
  await walk(root);
  return { sha256: digest(stableJson(files)), files };
}

export async function restoreFrozen(root, destination) {
  const compressed = await readFile(resolve(root, "baseline/current.json.gz"));
  const envelope = JSON.parse(gunzipSync(compressed));
  const manifest = JSON.parse(
    await readFile(resolve(root, "baseline/manifest.json"), "utf8"),
  );
  if (digest(compressed) !== manifest.archive_sha256)
    throw new Error("Frozen archive digest mismatch");
  await mkdir(destination, { recursive: false });
  for (const [path, base64] of Object.entries(envelope.files)) {
    const target = safe(resolve(destination, "skill"), path),
      bytes = Buffer.from(base64, "base64");
    if (digest(bytes) !== envelope.manifest.files[path])
      throw new Error("Frozen baseline file mismatch");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  if (
    (await distribution(resolve(destination, "skill"))).sha256 !==
    manifest.subject_sha256
  )
    throw new Error("Frozen subject mismatch after restore");
  await writeFile(
    resolve(destination, "manifest.json"),
    stableJson(envelope.manifest),
  );
  return resolve(destination, "skill");
}

export async function freeze(root, destination) {
  await mkdir(destination, { recursive: false });
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  const source = resolve(root, "skills/self-evolution");
  const before = await distribution(source);
  await cp(source, resolve(destination, "skill"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const after = await distribution(resolve(destination, "skill"));
  if (before.sha256 !== after.sha256)
    throw new Error("Distribution changed while freezing");
  const protocols = {};
  for (const path of [
    "AGENTS.md",
    "package.json",
    "package-lock.json",
    "maintainer/evals/SPEC.md",
    "maintainer/evals/public/PUBLIC-BENCHMARKS.md",
    "maintainer/evals/run.mjs",
  ]) {
    protocols[path] = digest(await readFile(resolve(root, path)));
  }
  const manifest = {
    schema: "engineering-subject/1",
    arm: "B4",
    created_at: new Date().toISOString(),
    commit: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    workspace_status: git("status", "--porcelain=v1", "--untracked-files=all"),
    distribution_status: git(
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      "skills/self-evolution",
    ),
    bundle_sha256: before.files["references/bin/kb.mjs"],
    ...before,
    protocols,
  };
  await writeFile(resolve(destination, "manifest.json"), stableJson(manifest));
  return manifest;
}

if (process.argv[2] === "freeze") {
  console.log(
    JSON.stringify(
      await freeze(resolve(process.argv[3] ?? "."), resolve(process.argv[4])),
      null,
      2,
    ),
  );
}
