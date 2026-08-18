#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, stableJson } from "./core.mjs";

export const WORKSPACE_EDIT_SCHEMA_VERSION = "1.0";
export const WORKSPACE_EDIT_PHASES = Object.freeze(["onboarding", "repair"]);
// The formal Windows wrapper transports the token on one cmd.exe command line.
// 3072 bytes encode to 4096 base64url characters, leaving ample room for the
// fixed bwrap argv below cmd.exe's 8191-character limit.
export const MAX_WORKSPACE_EDIT_PATCH_BYTES = 3 * 1024;
export const MAX_WORKSPACE_EDIT_TARGETS = 128;

const GIT_APPLY_CHECK_ARGS = Object.freeze([
  "apply",
  "--check",
  "--whitespace=nowarn",
  "-",
]);
const GIT_APPLY_ARGS = Object.freeze(["apply", "--whitespace=nowarn", "-"]);
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MS = 60_000;
const PROTECTED_SEGMENTS = new Set([
  ".external-eval",
  ".git",
  "hidden",
  "node_modules",
  "oracle",
  "sealed",
  "subjects",
]);
const GENERATED_SEGMENTS = new Set([
  ".cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vite",
  ".webpack",
  "build",
  "coverage",
  "dist",
  "generated",
  "out",
  "target",
  "temp",
  "tmp",
]);
const PACKAGE_AND_LOCK_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INDEX_HEADER =
  /^index ([0-9a-f]{7,64})\.\.([0-9a-f]{7,64})(?: (100644|100755))?$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

export class WorkspaceEditError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "WorkspaceEditError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new WorkspaceEditError(code, message, options);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function missing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

function sameFilesystemPath(left, right) {
  const normalize = (value) => {
    const absolute = resolve(value);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  return normalize(left) === normalize(right);
}

function isWithin(parent, candidate) {
  const offset = relative(resolve(parent), resolve(candidate));
  return (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  );
}

function assertPhase(phase) {
  if (!WORKSPACE_EDIT_PHASES.includes(phase)) {
    fail("INVALID_PHASE", "phase must be onboarding or repair");
  }
}

function assertPortableSegment(segment, path) {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.length > 255 ||
    /[ .]$/.test(segment) ||
    /[<>:"|?*]/.test(segment) ||
    /[\u0000-\u001f\u007f]/.test(segment) ||
    WINDOWS_DEVICE_NAME.test(segment)
  ) {
    fail(
      "UNSAFE_PATH",
      `patch target is not a portable relative path: ${path}`,
    );
  }
}

export function assertWorkspaceEditPath(path, phase) {
  assertPhase(phase);
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 1024 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path)
  ) {
    fail(
      "UNSAFE_PATH",
      "patch target must be a safe POSIX-style relative path",
    );
  }

  const segments = path.split("/");
  for (const segment of segments) assertPortableSegment(segment, path);
  const folded = segments.map((segment) => segment.toLowerCase());
  const basename = folded.at(-1);
  if (
    folded.some((segment) => PROTECTED_SEGMENTS.has(segment)) ||
    folded.some((segment) => GENERATED_SEGMENTS.has(segment))
  ) {
    fail(
      "PROTECTED_PATH",
      `patch target is evaluator-managed or generated: ${path}`,
    );
  }
  if (PACKAGE_AND_LOCK_FILES.has(basename) || basename.endsWith(".lock")) {
    fail(
      "PROTECTED_PATH",
      `package manifests and lockfiles are immutable: ${path}`,
    );
  }
  if (
    phase === "onboarding" &&
    path !== "AGENTS.md" &&
    !path.startsWith(".agents/")
  ) {
    fail(
      "PHASE_PATH_VIOLATION",
      `onboarding may edit only AGENTS.md and .agents/**: ${path}`,
    );
  }
  return path;
}

function canonicalPatchBytes(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  if (input.byteLength === 0) fail("EMPTY_PATCH", "patch must not be empty");
  if (input.byteLength > MAX_WORKSPACE_EDIT_PATCH_BYTES) {
    fail(
      "PATCH_TOO_LARGE",
      `patch exceeds ${MAX_WORKSPACE_EDIT_PATCH_BYTES} bytes`,
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch (error) {
    fail("INVALID_PATCH_ENCODING", "patch must be valid UTF-8", {
      cause: error,
    });
  }
  if (text.startsWith("\uFEFF")) {
    fail("INVALID_PATCH_ENCODING", "patch must not contain a UTF-8 BOM");
  }
  if (text.includes("\0")) {
    fail("INVALID_PATCH_ENCODING", "patch must not contain NUL bytes");
  }
  if (!text.endsWith("\n")) {
    fail("INVALID_UNIFIED_DIFF", "patch must end with a newline");
  }
  const physicalLines = text.slice(0, -1).split("\n");
  if (
    physicalLines.length > 0 &&
    physicalLines.every((line) => line.endsWith("\r"))
  ) {
    text = `${physicalLines.map((line) => line.slice(0, -1)).join("\n")}\n`;
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength > MAX_WORKSPACE_EDIT_PATCH_BYTES) {
    fail(
      "PATCH_TOO_LARGE",
      `canonical patch exceeds ${MAX_WORKSPACE_EDIT_PATCH_BYTES} bytes`,
    );
  }
  return { bytes, text };
}

function diffHeaderPath(line) {
  if (!line.startsWith("diff --git a/")) {
    fail(
      "INVALID_UNIFIED_DIFF",
      "each patch section must start with diff --git",
    );
  }
  const tail = line.slice("diff --git a/".length);
  const candidates = [];
  let offset = -1;
  while ((offset = tail.indexOf(" b/", offset + 1)) !== -1) {
    const before = tail.slice(0, offset);
    const after = tail.slice(offset + 3);
    if (before === after) candidates.push(before);
  }
  if (candidates.length !== 1) {
    fail(
      "INVALID_UNIFIED_DIFF",
      "diff --git paths must be identical, unquoted, and unambiguous",
    );
  }
  return candidates[0];
}

function markerPath(line, marker) {
  const prefix = `${marker} `;
  if (!line.startsWith(prefix)) {
    fail("INVALID_UNIFIED_DIFF", `expected ${marker} file marker`);
  }
  const value = line.slice(prefix.length);
  if (value === "/dev/null") return value;
  const side = marker === "---" ? "a/" : "b/";
  if (!value.startsWith(side) || value.includes("\t")) {
    fail("INVALID_UNIFIED_DIFF", `${marker} must use an unquoted ${side} path`);
  }
  return value.slice(2);
}

function hunkCount(value) {
  return value === undefined ? 1 : Number.parseInt(value, 10);
}

function validateIndexHeader(index, change) {
  const match = INDEX_HEADER.exec(index);
  if (!match || match[1].length !== match[2].length) {
    fail(
      "INVALID_UNIFIED_DIFF",
      "patch section requires a canonical index header",
    );
  }
  const oldIsNull = /^0+$/.test(match[1]);
  const newIsNull = /^0+$/.test(match[2]);
  if (
    (change === "added" && (!oldIsNull || newIsNull)) ||
    (change === "removed" && (oldIsNull || !newIsNull)) ||
    (change === "modified" && (oldIsNull || newIsNull))
  ) {
    fail(
      "INVALID_UNIFIED_DIFF",
      "index hashes do not match the file transition",
    );
  }
}

export function parseWorkspaceEditPatch(value, phase) {
  assertPhase(phase);
  const canonical = canonicalPatchBytes(value);
  const lines = canonical.text.split("\n");
  lines.pop();
  const targets = [];
  const seen = new Set();
  const portableTargets = new Set();
  let cursor = 0;

  while (cursor < lines.length) {
    const path = diffHeaderPath(lines[cursor]);
    assertWorkspaceEditPath(path, phase);
    if (seen.has(path)) {
      fail("INVALID_UNIFIED_DIFF", `patch contains duplicate target: ${path}`);
    }
    const portableTarget = path.normalize("NFC").toLowerCase();
    if (portableTargets.has(portableTarget)) {
      fail(
        "INVALID_UNIFIED_DIFF",
        `patch contains a case or normalization collision: ${path}`,
      );
    }
    seen.add(path);
    portableTargets.add(portableTarget);
    if (seen.size > MAX_WORKSPACE_EDIT_TARGETS) {
      fail(
        "TOO_MANY_TARGETS",
        `patch exceeds ${MAX_WORKSPACE_EDIT_TARGETS} targets`,
      );
    }
    cursor += 1;

    let index = null;
    let newFileMode = null;
    let deletedFileMode = null;
    while (cursor < lines.length && !lines[cursor].startsWith("--- ")) {
      const line = lines[cursor];
      if (INDEX_HEADER.test(line) && index === null) {
        index = line;
      } else if (
        /^new file mode (100644|100755)$/.test(line) &&
        newFileMode === null
      ) {
        newFileMode = line.slice("new file mode ".length);
      } else if (
        /^deleted file mode (100644|100755)$/.test(line) &&
        deletedFileMode === null
      ) {
        deletedFileMode = line.slice("deleted file mode ".length);
      } else {
        fail("INVALID_UNIFIED_DIFF", `unsupported patch header: ${line}`);
      }
      cursor += 1;
    }
    if (index === null || cursor + 2 >= lines.length) {
      fail(
        "INVALID_UNIFIED_DIFF",
        "patch section is missing file or hunk headers",
      );
    }

    const oldPath = markerPath(lines[cursor], "---");
    const newPath = markerPath(lines[cursor + 1], "+++");
    cursor += 2;
    let change;
    if (oldPath === "/dev/null" && newPath === path) {
      change = "added";
    } else if (oldPath === path && newPath === "/dev/null") {
      change = "removed";
    } else if (oldPath === path && newPath === path) {
      change = "modified";
    } else {
      fail(
        "INVALID_UNIFIED_DIFF",
        "file markers do not match diff --git target",
      );
    }
    if (
      (change === "added" &&
        (newFileMode === null || deletedFileMode !== null)) ||
      (change === "removed" &&
        (deletedFileMode === null || newFileMode !== null)) ||
      (change === "modified" &&
        (newFileMode !== null || deletedFileMode !== null))
    ) {
      fail(
        "INVALID_UNIFIED_DIFF",
        "file mode header does not match transition",
      );
    }
    validateIndexHeader(index, change);

    let hunkSeen = false;
    let changedLineSeen = false;
    while (cursor < lines.length && !lines[cursor].startsWith("diff --git ")) {
      const header = HUNK_HEADER.exec(lines[cursor]);
      if (!header) {
        fail(
          "INVALID_UNIFIED_DIFF",
          `expected a unified hunk at line ${cursor + 1}`,
        );
      }
      hunkSeen = true;
      const oldStart = Number.parseInt(header[1], 10);
      const oldExpected = hunkCount(header[2]);
      const newStart = Number.parseInt(header[3], 10);
      const newExpected = hunkCount(header[4]);
      if (
        !Number.isSafeInteger(oldStart) ||
        !Number.isSafeInteger(oldExpected) ||
        !Number.isSafeInteger(newStart) ||
        !Number.isSafeInteger(newExpected) ||
        (oldExpected === 0 && oldStart !== 0) ||
        (newExpected === 0 && newStart !== 0)
      ) {
        fail("INVALID_UNIFIED_DIFF", "hunk range is invalid");
      }
      if (
        (change === "added" && (oldStart !== 0 || oldExpected !== 0)) ||
        (change === "removed" && (newStart !== 0 || newExpected !== 0))
      ) {
        fail("INVALID_UNIFIED_DIFF", "hunk range does not match transition");
      }
      cursor += 1;
      let oldActual = 0;
      let newActual = 0;
      let previousWasContent = false;
      while (
        cursor < lines.length &&
        !lines[cursor].startsWith("@@ ") &&
        !lines[cursor].startsWith("diff --git ")
      ) {
        const line = lines[cursor];
        if (line === "\\ No newline at end of file") {
          if (!previousWasContent) {
            fail("INVALID_UNIFIED_DIFF", "orphaned no-newline marker");
          }
          previousWasContent = false;
          cursor += 1;
          continue;
        }
        const prefix = line[0];
        if (prefix === " ") {
          oldActual += 1;
          newActual += 1;
        } else if (prefix === "-") {
          oldActual += 1;
          changedLineSeen = true;
        } else if (prefix === "+") {
          newActual += 1;
          changedLineSeen = true;
        } else {
          fail("INVALID_UNIFIED_DIFF", `invalid hunk line at ${cursor + 1}`);
        }
        previousWasContent = true;
        cursor += 1;
      }
      if (oldActual !== oldExpected || newActual !== newExpected) {
        fail(
          "INVALID_UNIFIED_DIFF",
          `hunk count mismatch: expected ${oldExpected}/${newExpected}, received ${oldActual}/${newActual}`,
        );
      }
    }
    if (!hunkSeen || !changedLineSeen) {
      fail(
        "INVALID_UNIFIED_DIFF",
        "each target requires a non-empty text hunk",
      );
    }
    targets.push({ change, path });
  }

  if (targets.length === 0) {
    fail("EMPTY_PATCH", "patch must contain at least one target");
  }
  targets.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return {
    bytes: canonical.bytes,
    patch_sha256: sha256(canonical.bytes),
    targets,
  };
}

async function assertRealDirectory(path, name) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    fail("UNSAFE_FILESYSTEM", `${name} does not exist`, { cause: error });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("UNSAFE_FILESYSTEM", `${name} must be a real directory`);
  }
  const canonical = await realpath(path);
  if (!sameFilesystemPath(canonical, path)) {
    fail(
      "UNSAFE_FILESYSTEM",
      `${name} must not traverse a symlink or reparse point`,
    );
  }
}

async function assertWorkspaceRoot(workspace) {
  await assertRealDirectory(workspace, "workspace");
  await assertRealDirectory(
    resolve(workspace, ".git"),
    "workspace .git directory",
  );
}

async function targetState(workspace, path) {
  const parts = path.split("/");
  let current = workspace;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    if (!isWithin(workspace, current)) {
      fail("UNSAFE_PATH", `target escapes workspace: ${path}`);
    }
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (missing(error)) return { path, sha256: null };
      fail("UNSAFE_FILESYSTEM", `cannot inspect target path: ${path}`, {
        cause: error,
      });
    }
    if (metadata.isSymbolicLink()) {
      fail(
        "UNSAFE_FILESYSTEM",
        `target traverses a symlink or reparse point: ${path}`,
      );
    }
    const canonical = await realpath(current);
    if (!sameFilesystemPath(canonical, current)) {
      fail(
        "UNSAFE_FILESYSTEM",
        `target traverses a symlink or reparse point: ${path}`,
      );
    }
    if (index < parts.length - 1) {
      if (!metadata.isDirectory()) {
        fail(
          "UNSAFE_FILESYSTEM",
          `target ancestor is not a directory: ${path}`,
        );
      }
    } else {
      if (!metadata.isFile()) {
        fail("UNSAFE_FILESYSTEM", `target is not a regular file: ${path}`);
      }
      return { path, sha256: sha256(await readFile(current)) };
    }
  }
  fail("UNSAFE_FILESYSTEM", `cannot resolve target: ${path}`);
}

function stateMap(states) {
  return new Map(states.map((state) => [state.path, state.sha256]));
}

function assertPreconditions(targets, states) {
  const byPath = stateMap(states);
  for (const target of targets) {
    const before = byPath.get(target.path);
    if (
      (target.change === "added" && before !== null) ||
      (target.change !== "added" && before === null)
    ) {
      fail(
        "PATCH_STATE_MISMATCH",
        `patch transition does not match current target state: ${target.path}`,
      );
    }
  }
}

function assertStatesEqual(before, after) {
  const current = stateMap(after);
  for (const item of before) {
    if (current.get(item.path) !== item.sha256) {
      fail(
        "WORKSPACE_RACE",
        `target changed during patch validation: ${item.path}`,
      );
    }
  }
}

function receiptTargets(targets, beforeStates, afterStates) {
  const before = stateMap(beforeStates);
  const after = stateMap(afterStates);
  return targets.map((target) => {
    const beforeSha256 = before.get(target.path);
    const afterSha256 = after.get(target.path);
    if (
      (target.change === "added" &&
        (beforeSha256 !== null || afterSha256 === null)) ||
      (target.change === "removed" &&
        (beforeSha256 === null || afterSha256 !== null)) ||
      (target.change === "modified" &&
        (beforeSha256 === null ||
          afterSha256 === null ||
          beforeSha256 === afterSha256))
    ) {
      fail(
        "POST_APPLY_MISMATCH",
        `applied transition does not match patch target: ${target.path}`,
      );
    }
    return {
      after_sha256: afterSha256,
      before_sha256: beforeSha256,
      change: target.change,
      path: target.path,
    };
  });
}

function cleanGitError(bytes) {
  return bytes.toString("utf8").replaceAll(/\s+/g, " ").trim().slice(0, 2000);
}

async function runGitApply(workspace, args, patch) {
  return new Promise((resolvePromise, rejectPromise) => {
    const gitEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)),
    );
    const child = spawn("git", args, {
      cwd: workspace,
      env: {
        ...gitEnvironment,
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_DIR: resolve(workspace, ".git"),
        GIT_LITERAL_PATHSPECS: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_WORK_TREE: workspace,
        LANG: "C",
        LC_ALL: "C",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const collect = (chunks) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill();
        finish(
          rejectPromise,
          new WorkspaceEditError(
            "GIT_OUTPUT_LIMIT",
            "git apply output exceeded limit",
          ),
        );
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) =>
      finish(
        rejectPromise,
        new WorkspaceEditError(
          "GIT_EXECUTION_FAILED",
          "cannot execute git apply",
          {
            cause: error,
          },
        ),
      ),
    );
    child.on("close", (code, signal) =>
      finish(resolvePromise, {
        code,
        signal,
        stderr: Buffer.concat(stderr),
        stdout: Buffer.concat(stdout),
      }),
    );
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        finish(
          rejectPromise,
          new WorkspaceEditError(
            "GIT_EXECUTION_FAILED",
            "cannot stream patch to git",
            {
              cause: error,
            },
          ),
        );
      }
    });
    child.stdin.end(patch);
    timer = setTimeout(() => {
      child.kill();
      finish(
        rejectPromise,
        new WorkspaceEditError("GIT_TIMEOUT", "git apply timed out"),
      );
    }, GIT_TIMEOUT_MS);
    timer.unref?.();
  });
}

async function prepareReceiptDirectory(workspace, receiptDir) {
  if (isWithin(workspace, receiptDir) || isWithin(receiptDir, workspace)) {
    fail(
      "UNSAFE_RECEIPT_DIR",
      "receipt directory must be outside the workspace tree",
    );
  }
  await mkdir(receiptDir, { recursive: true });
  await assertRealDirectory(receiptDir, "receipt directory");
  const probe = resolve(
    receiptDir,
    `.workspace-edit-probe-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  let handle;
  try {
    handle = await open(probe, "wx", 0o600);
    await handle.writeFile("ready\n", "utf8");
    await handle.sync();
  } catch (error) {
    fail("UNWRITABLE_RECEIPT_DIR", "receipt directory is not writable", {
      cause: error,
    });
  } finally {
    await handle?.close();
    await unlink(probe).catch(() => {});
  }
}

async function writeReceipt(receiptDir, receipt) {
  const bytes = Buffer.from(stableJson(receipt));
  const target = resolve(receiptDir, `${receipt.receipt_id}.json`);
  const temporary = resolve(
    receiptDir,
    `.${receipt.receipt_id}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      const existing = await readFile(target).catch(() => null);
      if (existing?.equals(bytes)) return target;
    }
    fail("RECEIPT_WRITE_FAILED", "cannot persist canonical edit receipt", {
      cause: error,
    });
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => {});
  }
  return target;
}

export async function applyWorkspaceEdit({
  workspace,
  phase,
  receiptDir,
  patch,
}) {
  assertPhase(phase);
  if (typeof workspace !== "string" || !isAbsolute(workspace)) {
    fail("INVALID_ARGUMENT", "workspace must be an absolute path");
  }
  if (typeof receiptDir !== "string" || !isAbsolute(receiptDir)) {
    fail("INVALID_ARGUMENT", "receiptDir must be an absolute path");
  }
  const workspaceRoot = resolve(workspace);
  const receiptRoot = resolve(receiptDir);
  await assertWorkspaceRoot(workspaceRoot);
  await prepareReceiptDirectory(workspaceRoot, receiptRoot);

  const parsed = parseWorkspaceEditPatch(patch, phase);
  const preCheck = await Promise.all(
    parsed.targets.map((target) => targetState(workspaceRoot, target.path)),
  );
  assertPreconditions(parsed.targets, preCheck);

  const check = await runGitApply(
    workspaceRoot,
    GIT_APPLY_CHECK_ARGS,
    parsed.bytes,
  );
  if (check.code !== 0) {
    fail(
      "PATCH_NOT_APPLICABLE",
      `git apply --check rejected patch${cleanGitError(check.stderr) ? `: ${cleanGitError(check.stderr)}` : ""}`,
    );
  }
  const preApply = await Promise.all(
    parsed.targets.map((target) => targetState(workspaceRoot, target.path)),
  );
  assertStatesEqual(preCheck, preApply);

  const applied = await runGitApply(
    workspaceRoot,
    GIT_APPLY_ARGS,
    parsed.bytes,
  );
  if (applied.code !== 0) {
    fail(
      "PATCH_APPLY_FAILED",
      `git apply rejected checked patch${cleanGitError(applied.stderr) ? `: ${cleanGitError(applied.stderr)}` : ""}`,
    );
  }
  const postApply = await Promise.all(
    parsed.targets.map((target) => targetState(workspaceRoot, target.path)),
  );
  const targets = receiptTargets(parsed.targets, preApply, postApply);
  const identity = {
    operation: "apply-unified-diff",
    patch_sha256: parsed.patch_sha256,
    phase,
    targets,
  };
  const receipt = {
    schema_version: WORKSPACE_EDIT_SCHEMA_VERSION,
    receipt_id: sha256(stableJson(identity)),
    status: "applied",
    phase,
    operation: identity.operation,
    patch_sha256: parsed.patch_sha256,
    targets,
  };
  await writeReceipt(receiptRoot, receipt);
  return receipt;
}

export function parseWorkspaceEditArguments(args) {
  const stdinMode = Array.isArray(args) && args.length === 6;
  const base64urlMode = Array.isArray(args) && args.length === 8;
  if (
    (!stdinMode && !base64urlMode) ||
    args[0] !== "--workspace" ||
    args[2] !== "--phase" ||
    args[4] !== "--receipt-dir" ||
    (base64urlMode && args[6] !== "--patch-base64url")
  ) {
    fail(
      "INVALID_ARGUMENT",
      "usage: workspace-edit --workspace <absolute> --phase <onboarding|repair> --receipt-dir <absolute> [--patch-base64url <canonical-token>]",
    );
  }
  const [, workspace, , phase, , receiptDir] = args;
  if (!isAbsolute(workspace) || !isAbsolute(receiptDir)) {
    fail(
      "INVALID_ARGUMENT",
      "workspace and receipt directory must be absolute",
    );
  }
  assertPhase(phase);
  return {
    patchBase64url: base64urlMode ? args[7] : null,
    phase,
    receiptDir,
    workspace,
  };
}

export function decodeWorkspaceEditPatchBase64url(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_WORKSPACE_EDIT_PATCH_BYTES * 4) / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  ) {
    fail(
      "INVALID_PATCH_BASE64URL",
      "patch-base64url must be one canonical unpadded base64url token",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_WORKSPACE_EDIT_PATCH_BYTES ||
    bytes.toString("base64url") !== value
  ) {
    fail(
      "INVALID_PATCH_BASE64URL",
      "patch-base64url is malformed, non-canonical, or too large",
    );
  }
  return bytes;
}

async function readPatchInput(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_WORKSPACE_EDIT_PATCH_BYTES) {
      fail(
        "PATCH_TOO_LARGE",
        `patch exceeds ${MAX_WORKSPACE_EDIT_PATCH_BYTES} bytes`,
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export async function workspaceEditMain(
  args = process.argv.slice(2),
  input = process.stdin,
) {
  const options = parseWorkspaceEditArguments(args);
  const patch =
    options.patchBase64url !== null
      ? decodeWorkspaceEditPatchBase64url(options.patchBase64url)
      : Buffer.isBuffer(input)
        ? input
        : await readPatchInput(input);
  const { patchBase64url: _, ...applyOptions } = options;
  const receipt = await applyWorkspaceEdit({ ...applyOptions, patch });
  return receipt;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  const modulePath = resolve(fileURLToPath(import.meta.url));
  const invocationPath = resolve(process.argv[1]);
  return sameFilesystemPath(modulePath, invocationPath);
}

if (isDirectExecution()) {
  workspaceEditMain()
    .then((receipt) => process.stdout.write(stableJson(receipt)))
    .catch((error) => {
      process.stderr.write(
        `workspace-edit: ${error.code ?? "FAILED"}: ${errorMessage(error)}\n`,
      );
      process.exitCode = 1;
    });
}
