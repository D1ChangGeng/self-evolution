import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { stableJson } from "../contract.mjs";
import { parse, stringify } from "yaml";

const exec = promisify(execFile);
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function safe(root, path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    isAbsolute(path) ||
    /^[a-z]:/i.test(path) ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error(`Unsafe relative path: ${path}`);
  const target = resolve(root, path);
  const offset = relative(resolve(root), target);
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset))
    throw new Error(`Path escapes root: ${path}`);
  return target;
}
export async function noLinks(root, path = "") {
  const parts = path ? path.split("/") : [];
  let cursor = root;
  for (const part of ["", ...parts]) {
    cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error(`Link traversal rejected: ${cursor}`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
export async function snapshot(root) {
  await noLinks(root);
  const entries = {};
  async function walk(dir, prefix = "") {
    for (const name of (await readdir(dir)).sort()) {
      if (!prefix && name === ".git") continue; // Git owns history; project content is never broadly ignored.
      const path = resolve(dir, name),
        rel = prefix + name,
        info = await lstat(path);
      if (info.isSymbolicLink())
        entries[rel] = { type: "symlink", target: await readlink(path) };
      else if (info.isDirectory()) {
        entries[rel] = { type: "directory" };
        await walk(path, rel + "/");
      } else if (info.isFile()) {
        const bytes = await readFile(path);
        entries[rel] = {
          type: "file",
          sha256: digest(bytes),
          bytes: bytes.length,
          executable:
            process.platform === "win32" ? null : !!(info.mode & 0o111),
        };
      } else entries[rel] = { type: "special" };
    }
  }
  await walk(root);
  return { entries, sha256: digest(stableJson(entries)) };
}
export function changes(before, after) {
  return [
    ...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)]),
  ]
    .sort()
    .filter(
      (path) =>
        stableJson(before.entries[path] ?? null) !==
        stableJson(after.entries[path] ?? null),
    )
    .map((path) => ({
      path,
      before: before.entries[path] ?? null,
      after: after.entries[path] ?? null,
    }));
}
export function matches(path, rules) {
  return rules.some((rule) =>
    rule.endsWith("/**")
      ? path === rule.slice(0, -3) || path.startsWith(rule.slice(0, -2))
      : path === rule,
  );
}
export function substantiveChanges(diff) {
  return diff
    .filter(
      (d) =>
        d.before?.type !== "directory" ||
        (d.after?.type && d.after.type !== "directory"),
    )
    .filter((d) => d.before?.type || d.after?.type !== "directory");
}
export async function materialize(root, files) {
  for (const f of files) {
    const path = safe(root, f.path);
    await noLinks(root, f.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, f.content);
  }
}
export async function git(root, args) {
  return (
    await exec("git", args, {
      cwd: root,
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim();
}
export async function initGit(root) {
  await git(root, ["init", "-q", "-b", "engineering-task"]);
  for (const [key, val] of [
    ["core.autocrlf", "false"],
    ["core.filemode", "false"],
    ["user.email", "eval@example.invalid"],
    ["user.name", "Engineering evaluator"],
  ])
    await git(root, ["config", key, val]);
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-qm", "Controlled initial task"]);
  return git(root, ["rev-parse", "HEAD"]);
}

// Git patch contains tracked modifications, deletions and reviewed untracked
// regular files (including binary). Links/special files fail before export.
export async function patch(root) {
  const snap = await snapshot(root);
  if (
    Object.values(snap.entries).some(
      (e) => !["file", "directory"].includes(e.type),
    )
  )
    throw new Error("Unsupported link/special file in transfer");
  await git(root, ["add", "-A"]);
  const result = await exec(
    "git",
    [
      "diff",
      "--cached",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "HEAD",
      "--",
    ],
    {
      cwd: root,
      windowsHide: true,
      timeout: 15000,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return result.stdout;
}

export async function exportContinuation({
  project,
  destination,
  repo,
  base,
  objective,
  constraints = [],
  verified = [],
  refs = [],
  next,
}) {
  await mkdir(destination, { recursive: false });
  const bytes = await patch(project),
    state = await snapshot(project);
  const metadata = {
    schema: "continuation/1",
    repo,
    base_commit: base,
    branch_or_worktree: await git(project, ["branch", "--show-current"]),
    workspace_diff_digest: digest(bytes),
    objective,
    constraints,
    verified_state: verified,
    open_risks: [
      "Re-run verification after branch, source or environment changes.",
    ],
    next_action: next,
    next_verification:
      "Run this task's current regression and acceptance checks.",
    knowledge_refs: refs,
    recheck_when: ["source, branch or environment changes"],
  };
  await writeFile(resolve(destination, "workspace.patch"), bytes);
  await writeFile(
    resolve(destination, "continuation.md"),
    `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n# Continue the task\nApply workspace.patch only after validating its digest and base.\n`,
  );
  const manifest = {
    schema: "engineering-transfer/1",
    repo,
    base_commit: base,
    branch: metadata.branch_or_worktree,
    workspace_sha256: state.sha256,
    files: {},
  };
  for (const name of ["continuation.md", "workspace.patch"])
    manifest.files[name] = digest(await readFile(resolve(destination, name)));
  await writeFile(resolve(destination, "manifest.json"), stableJson(manifest));
  return manifest;
}

export async function receiveContinuation({
  initial,
  destination,
  packet,
  repo,
  expectedBase,
  expectedBranch = "engineering-task",
}) {
  await noLinks(packet);
  const names = (await readdir(packet)).sort();
  if (
    stableJson(names) !==
    stableJson(["continuation.md", "manifest.json", "workspace.patch"])
  )
    throw new Error("Forbidden or missing handoff artifact");
  for (const name of names) {
    await noLinks(packet, name);
    if (!(await lstat(resolve(packet, name))).isFile())
      throw new Error("Transfer requires regular files");
  }
  const manifest = JSON.parse(
    await readFile(resolve(packet, "manifest.json"), "utf8"),
  );
  if (
    manifest.repo !== repo ||
    manifest.base_commit !== expectedBase ||
    manifest.branch !== expectedBranch
  )
    throw new Error("Repository/base/branch mismatch");
  for (const name of ["continuation.md", "workspace.patch"])
    if (
      digest(await readFile(resolve(packet, name))) !== manifest.files?.[name]
    )
      throw new Error("Missing or changed patch/handoff bytes");
  const content = await readFile(resolve(packet, "continuation.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) throw new Error("Invalid continuation frontmatter");
  const info = parse(match[1]);
  for (const field of [
    "schema",
    "repo",
    "base_commit",
    "branch_or_worktree",
    "workspace_diff_digest",
    "objective",
    "constraints",
    "verified_state",
    "open_risks",
    "next_action",
    "next_verification",
    "knowledge_refs",
    "recheck_when",
  ])
    if (!(field in info)) throw new Error(`Continuation missing ${field}`);
  if (
    info.schema !== "continuation/1" ||
    info.repo !== repo ||
    info.base_commit !== expectedBase ||
    info.branch_or_worktree !== expectedBranch ||
    info.workspace_diff_digest !== manifest.files["workspace.patch"]
  )
    throw new Error("Continuation binding mismatch");
  await mkdir(destination, { recursive: false });
  for (const name of await readdir(initial))
    await cp(resolve(initial, name), resolve(destination, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  if (
    (await git(destination, ["rev-parse", "HEAD"])) !== expectedBase ||
    (await git(destination, ["branch", "--show-current"])) !== expectedBranch
  )
    throw new Error("Receiver initial checkout mismatch");
  const patchPath = resolve(packet, "workspace.patch");
  if ((await readFile(patchPath)).length) {
    await git(destination, ["apply", "--check", patchPath]);
    await git(destination, ["apply", patchPath]);
  }
  if ((await snapshot(destination)).sha256 !== manifest.workspace_sha256)
    throw new Error("Receiver worktree digest mismatch after patch");
  const staleEvidence = info.verified_state
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        typeof entry.evidence !== "string" ||
        !entry.evidence.includes(manifest.workspace_sha256),
    )
    .map(({ index }) => index);
  return {
    metadata: info,
    manifest,
    evidence_status: "recheck-required",
    stale_evidence: staleEvidence,
  };
}
