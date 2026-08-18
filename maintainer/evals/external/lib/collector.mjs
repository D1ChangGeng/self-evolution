import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { exists, stableJson, writeJson } from "./core.mjs";

const exec = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const WORKSPACE_EDIT_RECEIPT_KEYS = Object.freeze([
  "operation",
  "patch_sha256",
  "phase",
  "receipt_id",
  "schema_version",
  "status",
  "targets",
]);
const WORKSPACE_EDIT_TARGET_KEYS = Object.freeze([
  "after_sha256",
  "before_sha256",
  "change",
  "path",
]);

function finiteInteger(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function tokenRecord(value) {
  if (!value || typeof value !== "object") return null;
  const input = finiteInteger(value.input ?? value.input_tokens);
  const output = finiteInteger(value.output ?? value.output_tokens);
  const reasoning =
    finiteInteger(value.reasoning ?? value.reasoning_tokens) ?? 0;
  const cacheRead =
    finiteInteger(value.cache?.read ?? value.cache_read_input_tokens) ?? 0;
  const cacheWrite =
    finiteInteger(value.cache?.write ?? value.cache_creation_input_tokens) ?? 0;
  if (input === null || output === null) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
  };
}

function toolPathCandidates(part) {
  const input = part?.state?.input;
  if (!input || typeof input !== "object") return [];
  return [
    input.filePath,
    input.file_path,
    input.path,
    input.filename,
    input.directory,
    input.workdir,
    input.cwd,
  ].filter((value) => typeof value === "string" && value.length > 0);
}

function toolCommand(part) {
  const input = part?.state?.input;
  if (!input || typeof input !== "object") return null;
  for (const key of ["command", "cmd", "script"]) {
    if (typeof input[key] === "string" && input[key].trim()) return input[key];
  }
  return null;
}

function toolAccess(tool) {
  const value = String(tool ?? "").toLowerCase();
  if (["write", "edit", "apply_patch", "multiedit", "patch"].includes(value)) {
    return "write";
  }
  if (["read", "grep", "glob", "list", "lsp"].includes(value)) return "read";
  if (["bash", "shell", "terminal", "run", "exec"].includes(value))
    return "execute";
  return "other";
}

export function parseOpenCodeJsonl(content) {
  const events = [];
  const parseErrors = [];
  for (const [index, line] of String(content).split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      parseErrors.push({
        line: index + 1,
        sha256: createHash("sha256").update(line).digest("hex"),
      });
    }
  }
  const responseUsage = [];
  const tools = [];
  const finalTexts = [];
  const errors = [];
  let sessionId = null;
  for (const event of events) {
    if (typeof event.sessionID === "string") sessionId = event.sessionID;
    if (event.type === "step_finish") {
      const usage = tokenRecord(event.part?.tokens);
      if (usage) {
        responseUsage.push({
          message_id: event.part?.messageID ?? null,
          part_id: event.part?.id ?? null,
          ...usage,
        });
      }
    } else if (event.type === "tool_use") {
      const part = event.part ?? {};
      tools.push({
        call_id: part.callID ?? null,
        tool: part.tool ?? null,
        status: part.state?.status ?? null,
        access: toolAccess(part.tool),
        paths: toolPathCandidates(part),
        command: toolCommand(part),
        started_at_ms: finiteInteger(part.state?.time?.start),
        finished_at_ms: finiteInteger(part.state?.time?.end),
        input_sha256: createHash("sha256")
          .update(stableJson(part.state?.input ?? null))
          .digest("hex"),
        output_sha256:
          typeof part.state?.output === "string"
            ? createHash("sha256").update(part.state.output).digest("hex")
            : null,
        output_bytes:
          typeof part.state?.output === "string"
            ? Buffer.byteLength(part.state.output)
            : null,
        error: typeof part.state?.error === "string" ? part.state.error : null,
      });
    } else if (event.type === "text" && typeof event.part?.text === "string") {
      finalTexts.push(event.part.text);
    } else if (event.type === "error") {
      errors.push(event.error ?? event);
    }
  }
  const usage = responseUsage.reduce(
    (total, item) => ({
      input_tokens: total.input_tokens + item.input_tokens,
      output_tokens: total.output_tokens + item.output_tokens,
      reasoning_tokens: total.reasoning_tokens + item.reasoning_tokens,
      cache_read_input_tokens:
        total.cache_read_input_tokens + item.cache_read_input_tokens,
      cache_creation_input_tokens:
        total.cache_creation_input_tokens + item.cache_creation_input_tokens,
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  );
  return {
    events,
    parse_errors: parseErrors,
    session_id: sessionId,
    response_usage: responseUsage,
    usage_status: responseUsage.length > 0 ? "measured" : "not-measured",
    usage: responseUsage.length > 0 ? usage : null,
    tools,
    tool_calls: tools.length,
    final: finalTexts.length > 0 ? finalTexts.at(-1) : null,
    errors,
  };
}

export function parseOpenCodeExport(value) {
  const messages = Array.isArray(value?.messages) ? value.messages : [];
  const tools = [];
  const usage = [];
  const texts = [];
  const errors = [];
  for (const message of messages) {
    if (message?.info?.role === "assistant" && message.info.error) {
      errors.push(message.info.error);
    }
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (part.type === "step-finish") {
        const record = tokenRecord(part.tokens);
        if (record)
          usage.push({
            message_id: part.messageID ?? null,
            part_id: part.id ?? null,
            ...record,
          });
      } else if (part.type === "tool") {
        tools.push({
          call_id: part.callID ?? null,
          tool: part.tool ?? null,
          status: part.state?.status ?? null,
          access: toolAccess(part.tool),
          paths: toolPathCandidates(part),
          command: toolCommand(part),
          started_at_ms: finiteInteger(part.state?.time?.start),
          finished_at_ms: finiteInteger(part.state?.time?.end),
          input_sha256: createHash("sha256")
            .update(stableJson(part.state?.input ?? null))
            .digest("hex"),
          output_sha256:
            typeof part.state?.output === "string"
              ? createHash("sha256").update(part.state.output).digest("hex")
              : null,
          output_bytes:
            typeof part.state?.output === "string"
              ? Buffer.byteLength(part.state.output)
              : null,
          error:
            typeof part.state?.error === "string" ? part.state.error : null,
        });
      } else if (part.type === "text" && typeof part.text === "string") {
        texts.push(part.text);
      }
    }
  }
  return {
    session_id: value?.info?.id ?? null,
    response_usage: usage,
    tools,
    tool_calls: tools.length,
    final: texts.length > 0 ? texts.at(-1) : null,
    errors,
  };
}

function normalizePath(root, value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const absolute = resolve(root, value);
  const offset = relative(resolve(root), absolute);
  return {
    raw_sha256: createHash("sha256").update(value).digest("hex"),
    path:
      offset === "" ||
      (!offset.startsWith("..") && !resolve(offset).startsWith(sep))
        ? offset.split(sep).join("/") || "."
        : null,
    outside_workspace:
      offset !== "" &&
      (offset.startsWith("..") || resolve(offset).startsWith(sep)),
  };
}

export function buildFilesystemTrace(parsed, workspaceDir) {
  return parsed.tools.flatMap((tool) => {
    if (tool.paths.length === 0) {
      return [
        {
          call_id: tool.call_id,
          tool: tool.tool,
          access: tool.access,
          path: null,
          outside_workspace: tool.access === "execute" ? null : false,
          command_sha256:
            typeof tool.command === "string"
              ? createHash("sha256").update(tool.command).digest("hex")
              : null,
        },
      ];
    }
    return tool.paths.map((path) => ({
      call_id: tool.call_id,
      tool: tool.tool,
      access: tool.access,
      ...normalizePath(workspaceDir, path),
      command_sha256:
        typeof tool.command === "string"
          ? createHash("sha256").update(tool.command).digest("hex")
          : null,
    }));
  });
}

function exactObjectKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    stableJson(Object.keys(value).sort()) === stableJson(expected)
  );
}

function assertReceiptRelativePath(value, name) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${name} is not a safe workspace-relative path`);
  }
  return value;
}

function assertWorkspaceEditTarget(value, name) {
  if (!exactObjectKeys(value, WORKSPACE_EDIT_TARGET_KEYS)) {
    throw new Error(`${name} must contain exactly the canonical target fields`);
  }
  const path = assertReceiptRelativePath(value.path, `${name}.path`);
  if (
    !["added", "modified", "removed"].includes(value.change) ||
    (value.before_sha256 !== null &&
      !SHA256_PATTERN.test(value.before_sha256)) ||
    (value.after_sha256 !== null && !SHA256_PATTERN.test(value.after_sha256)) ||
    (value.change === "added" &&
      (value.before_sha256 !== null ||
        !SHA256_PATTERN.test(value.after_sha256))) ||
    (value.change === "removed" &&
      (!SHA256_PATTERN.test(value.before_sha256) ||
        value.after_sha256 !== null)) ||
    (value.change === "modified" &&
      (!SHA256_PATTERN.test(value.before_sha256) ||
        !SHA256_PATTERN.test(value.after_sha256) ||
        value.before_sha256 === value.after_sha256))
  ) {
    throw new Error(`${name} has an invalid content transition`);
  }
  return { ...value, path };
}

export function assertWorkspaceEditReceipt(
  value,
  name = "workspace edit receipt",
) {
  if (!exactObjectKeys(value, WORKSPACE_EDIT_RECEIPT_KEYS)) {
    throw new Error(
      `${name} must contain exactly the canonical receipt fields`,
    );
  }
  if (
    value.schema_version !== "1.0" ||
    value.status !== "applied" ||
    value.operation !== "apply-unified-diff" ||
    !["onboarding", "repair"].includes(value.phase) ||
    !SHA256_PATTERN.test(value.receipt_id) ||
    !SHA256_PATTERN.test(value.patch_sha256) ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0
  ) {
    throw new Error(`${name} has an invalid canonical receipt header`);
  }
  const targets = value.targets.map((target, index) =>
    assertWorkspaceEditTarget(target, `${name}.targets[${index}]`),
  );
  const paths = targets.map((target) => target.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${name} contains duplicate target paths`);
  }
  if (
    stableJson(paths) !==
    stableJson(
      [...paths].sort((left, right) => left.localeCompare(right, "en")),
    )
  ) {
    throw new Error(`${name}.targets must be sorted by path`);
  }
  return { ...value, targets };
}

async function workspaceEditReceiptArtifact(value, name, artifactPath = null) {
  const receipt = assertWorkspaceEditReceipt(value, name);
  const bytes = Buffer.from(stableJson(receipt));
  if (artifactPath) {
    const diskBytes = await readFile(artifactPath);
    if (!diskBytes.equals(bytes)) {
      throw new Error(`${name} is not a canonical JSON artifact`);
    }
  }
  return {
    artifact_path: artifactPath,
    artifact_sha256: digest(bytes),
    receipt,
  };
}

export async function collectWorkspaceEditReceipts({
  receipts = [],
  receiptDir = null,
  phase = null,
} = {}) {
  const artifacts = [];
  for (const [index, item] of receipts.entries()) {
    if (typeof item === "string") {
      const value = JSON.parse(await readFile(item, "utf8"));
      artifacts.push(
        await workspaceEditReceiptArtifact(
          value,
          `workspace edit receipt ${index}`,
          resolve(item),
        ),
      );
    } else {
      artifacts.push(
        await workspaceEditReceiptArtifact(
          item,
          `workspace edit receipt ${index}`,
        ),
      );
    }
  }
  if (receiptDir && (await exists(receiptDir))) {
    const entries = (await readdir(receiptDir, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name, "en"),
    );
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        throw new Error(
          "workspace edit receipt directory contains a non-JSON artifact",
        );
      }
      const path = resolve(receiptDir, entry.name);
      const value = JSON.parse(await readFile(path, "utf8"));
      artifacts.push(
        await workspaceEditReceiptArtifact(
          value,
          `workspace edit receipt ${entry.name}`,
          path,
        ),
      );
    }
  }
  const unique = new Map();
  for (const artifact of artifacts) {
    if (phase && artifact.receipt.phase !== phase) {
      throw new Error(
        `workspace edit receipt ${artifact.receipt.receipt_id} belongs to ${artifact.receipt.phase}, not ${phase}`,
      );
    }
    const previous = unique.get(artifact.receipt.receipt_id);
    if (previous && previous.artifact_sha256 !== artifact.artifact_sha256) {
      throw new Error(
        `workspace edit receipt id ${artifact.receipt.receipt_id} has conflicting artifacts`,
      );
    }
    unique.set(artifact.receipt.receipt_id, artifact);
  }
  return [...unique.values()].sort((left, right) =>
    left.receipt.receipt_id.localeCompare(right.receipt.receipt_id, "en"),
  );
}

export function workspaceEditReceiptTrace(artifacts, command = null) {
  const commandSha256 =
    typeof command === "string" ? digest(Buffer.from(command)) : null;
  return artifacts.flatMap((artifact) =>
    artifact.receipt.targets.map((target) => ({
      call_id: `workspace-edit:${artifact.receipt.receipt_id}`,
      tool: "workspace-edit",
      access: "write",
      path: target.path,
      outside_workspace: false,
      command_sha256: commandSha256,
      receipt_id: artifact.receipt.receipt_id,
      receipt_sha256: artifact.artifact_sha256,
      patch_sha256: artifact.receipt.patch_sha256,
      change: target.change,
      before_sha256: target.before_sha256,
      after_sha256: target.after_sha256,
    })),
  );
}

function manifestFileMap(manifest) {
  return new Map(
    (manifest?.files ?? []).map((item) => [item.path, item.sha256]),
  );
}

export function reconcileWorkspaceEditReceipts(artifacts, before, after) {
  assertWorkspaceManifest(before, "gateway pre workspace manifest");
  assertWorkspaceManifest(after, "gateway post workspace manifest");
  const preFiles = manifestFileMap(before);
  const postFiles = manifestFileMap(after);
  const transitions = new Map();
  for (const artifact of artifacts) {
    for (const target of artifact.receipt.targets) {
      if (!transitions.has(target.path)) transitions.set(target.path, []);
      transitions.get(target.path).push({
        receipt_id: artifact.receipt.receipt_id,
        before_sha256: target.before_sha256,
        after_sha256: target.after_sha256,
      });
    }
  }
  const coveredPaths = [];
  for (const [path, edges] of transitions) {
    let current = preFiles.get(path) ?? null;
    const remaining = [...edges];
    while (remaining.length > 0) {
      const candidates = remaining.filter(
        (edge) => edge.before_sha256 === current,
      );
      if (candidates.length !== 1) {
        throw new Error(
          `workspace edit receipts do not form one content chain for ${path}`,
        );
      }
      const next = candidates[0];
      remaining.splice(remaining.indexOf(next), 1);
      current = next.after_sha256;
    }
    if (current !== (postFiles.get(path) ?? null)) {
      throw new Error(
        `workspace edit receipt chain does not bind the final bytes of ${path}`,
      );
    }
    coveredPaths.push(path);
  }
  coveredPaths.sort((left, right) => left.localeCompare(right, "en"));
  const workspaceDiff = diffWorkspaceManifests(before, after);
  return {
    covered_paths: coveredPaths,
    unreceipted_changes: workspaceDiff.changes
      .filter((item) => !transitions.has(item.path))
      .map((item) => item.path),
  };
}

const FORBIDDEN_NETWORK_COMMAND =
  /(?:^|[;&|\s])(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|bitsadmin|certutil\s+-urlcache|ssh|scp|sftp|rsync|nc|netcat|telnet|ftp|gh|git(?:\s+-c\s+\S+)*\s+(?:clone|fetch|pull|push|ls-remote|remote|submodule)|npm\s+(?:ci|install|add|update|view|info|search|audit|exec|publish|login)|npx|pnpm\s+(?:add|install|update)|yarn\s+(?:add|install|upgrade)|bun\s+install|deno\s+run|pip\s+(?:install|download)|python\s+-m\s+pip\s+install|uv\s+pip\s+install|cargo\s+install|go\s+(?:get|install)|gem\s+install|composer\s+install|docker\s+pull|kubectl|node(?:\.exe)?\s+(?:-e|--eval)\b|python(?:3|\.exe)?\s+(?:-c|-m\s+http\.server)\b)(?:\s|$)/i;

function normalizedCommand(value) {
  return String(value).trim().replaceAll(/\s+/g, " ").replaceAll("\\", "/");
}

function exactAllowedCommand(command, allowedCommands) {
  const normalized = normalizedCommand(command);
  return (allowedCommands ?? []).some(
    (allowed) =>
      typeof allowed === "string" &&
      !allowed.includes("*") &&
      normalizedCommand(allowed) === normalized,
  );
}

export function hasForbiddenNetworkCommand(parsed, allowedCommands = []) {
  return parsed.tools.some(
    (tool) =>
      tool.access === "execute" &&
      typeof tool.command === "string" &&
      FORBIDDEN_NETWORK_COMMAND.test(tool.command) &&
      !exactAllowedCommand(tool.command, allowedCommands),
  );
}

function unquoteShellToken(value) {
  return value.replace(/^["']|["']$/g, "");
}

function shellTokens(command) {
  return (String(command).match(/"[^"]*"|'[^']*'|[^\s;&|<>]+/g) ?? []).map(
    unquoteShellToken,
  );
}

function forbiddenPathSegment(value) {
  return /(?:^|[\\/])(?:oracle|hidden|sealed|subjects)(?:[\\/]|$)/i.test(
    String(value),
  );
}

function shellPathCandidates(command) {
  const candidates = [];
  for (const token of shellTokens(command)) {
    if (
      token === ".." ||
      token.startsWith("../") ||
      token.startsWith("..\\") ||
      token.includes("/../") ||
      token.includes("\\..\\") ||
      /^[A-Za-z]:[\\/]/.test(token) ||
      token.startsWith("\\\\") ||
      token.startsWith("/")
    ) {
      candidates.push(token);
    }
  }
  return candidates;
}

export function hasForbiddenPathCommand(parsed, workspaceDir) {
  const root = resolve(workspaceDir);
  return (parsed.tools ?? []).some((tool) => {
    if (tool.access !== "execute" || typeof tool.command !== "string")
      return false;
    if (shellTokens(tool.command).some(forbiddenPathSegment)) return true;
    return shellPathCandidates(tool.command).some((candidate) => {
      const absolute = resolve(root, candidate);
      const offset = relative(root, absolute);
      return offset === ".." || offset.startsWith(`..${sep}`);
    });
  });
}

async function gitText(workspaceDir, args) {
  return (await gitOutput(workspaceDir, args)).toString("utf8");
}

async function gitOutput(workspaceDir, args, { allowedExitCodes = [0] } = {}) {
  try {
    const { stdout } = await exec("git", args, {
      cwd: workspaceDir,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      encoding: "buffer",
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
  } catch (error) {
    const exitCode = Number(error.code);
    if (allowedExitCodes.includes(exitCode)) {
      return Buffer.isBuffer(error.stdout)
        ? error.stdout
        : Buffer.from(error.stdout ?? "");
    }
    throw new Error(
      `git ${args.join(" ")} failed: ${Buffer.from(error.stderr ?? error.message ?? "unknown error").toString("utf8")}`,
    );
  }
}

function nullSeparatedPaths(bytes) {
  return bytes
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
}

function joinPatchFragments(fragments) {
  const output = [];
  for (const fragment of fragments) {
    if (!fragment || fragment.byteLength === 0) continue;
    output.push(fragment);
    if (fragment.at(-1) !== 0x0a) output.push(Buffer.from("\n"));
  }
  return Buffer.concat(output);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export const WORKSPACE_MANIFEST_EXCLUSIONS = Object.freeze([
  Object.freeze({
    path: ".git",
    match: "any-path-segment",
    reason: "repository metadata is evaluator-owned noise",
  }),
  Object.freeze({
    path: "node_modules",
    match: "any-path-segment",
    reason: "installed dependencies are frozen separately by the lockfile",
  }),
  Object.freeze({
    path: ".external-eval",
    match: "any-path-segment",
    reason: "neutral evaluator validation material is not agent output",
  }),
]);

const WORKSPACE_MANIFEST_EXCLUSION_NAMES = new Set(
  WORKSPACE_MANIFEST_EXCLUSIONS.map((item) => item.path),
);
function workspacePathExcluded(path) {
  return path
    .split("/")
    .some((part) => WORKSPACE_MANIFEST_EXCLUSION_NAMES.has(part));
}

function workspaceManifestDigest(files) {
  return digest(
    stableJson({
      schema_version: "1.0",
      algorithm: "sha256",
      exclusions: WORKSPACE_MANIFEST_EXCLUSIONS,
      files,
    }),
  );
}

function assertWorkspaceManifest(value, name = "workspace manifest") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  if (value.schema_version !== "1.0" || value.algorithm !== "sha256") {
    throw new Error(`${name} has an unsupported schema or algorithm`);
  }
  if (
    stableJson(value.exclusions) !== stableJson(WORKSPACE_MANIFEST_EXCLUSIONS)
  ) {
    throw new Error(`${name} has an unexpected exclusion contract`);
  }
  if (!Array.isArray(value.files)) {
    throw new Error(`${name}.files must be an array`);
  }
  let previousPath = null;
  let totalBytes = 0;
  for (const item of value.files) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.path !== "string" ||
      item.path.length === 0 ||
      item.path.includes("\\") ||
      item.path.startsWith("/") ||
      /^[A-Za-z]:/.test(item.path) ||
      item.path.split("/").some((part) => part === "" || part === "..") ||
      workspacePathExcluded(item.path) ||
      !Number.isInteger(item.bytes) ||
      item.bytes < 0 ||
      !SHA256_PATTERN.test(item.sha256)
    ) {
      throw new Error(`${name} contains an invalid file record`);
    }
    if (
      previousPath !== null &&
      previousPath.localeCompare(item.path, "en") >= 0
    ) {
      throw new Error(`${name}.files must be uniquely sorted by path`);
    }
    previousPath = item.path;
    totalBytes += item.bytes;
  }
  if (
    value.file_count !== value.files.length ||
    value.total_bytes !== totalBytes ||
    value.manifest_sha256 !== workspaceManifestDigest(value.files)
  ) {
    throw new Error(
      `${name} summary or digest does not match its file records`,
    );
  }
  return value;
}

export async function collectWorkspaceManifest(workspaceDir) {
  const root = resolve(workspaceDir);
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = resolve(current, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (workspacePathExcluded(path)) continue;
      const metadata = await lstat(absolute);
      if (metadata.isDirectory()) {
        await walk(absolute);
      } else if (metadata.isSymbolicLink()) {
        throw new Error(
          `workspace manifest cannot attest symbolic link bytes: ${path}`,
        );
      } else if (metadata.isFile()) {
        const bytes = await readFile(absolute);
        files.push({
          path,
          bytes: bytes.byteLength,
          sha256: digest(bytes),
        });
      } else {
        throw new Error(
          `workspace manifest cannot attest non-file entry: ${path}`,
        );
      }
    }
  }
  await walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const manifest = {
    schema_version: "1.0",
    algorithm: "sha256",
    exclusions: WORKSPACE_MANIFEST_EXCLUSIONS,
    file_count: files.length,
    total_bytes: files.reduce((total, item) => total + item.bytes, 0),
    files,
    manifest_sha256: workspaceManifestDigest(files),
  };
  return assertWorkspaceManifest(manifest);
}

export async function writeWorkspaceManifest(path, workspaceDir) {
  const manifest = await collectWorkspaceManifest(workspaceDir);
  const bytes = Buffer.from(stableJson(manifest));
  await writeFile(path, bytes);
  return {
    manifest,
    artifact_sha256: digest(bytes),
  };
}

async function readWorkspaceManifest(path) {
  const bytes = await readFile(path);
  const manifest = assertWorkspaceManifest(
    JSON.parse(bytes.toString("utf8")),
    path,
  );
  if (!bytes.equals(Buffer.from(stableJson(manifest)))) {
    throw new Error(`${path} is not a canonical workspace manifest artifact`);
  }
  return { manifest, artifact_sha256: digest(bytes) };
}

export function diffWorkspaceManifests(before, after) {
  assertWorkspaceManifest(before, "pre workspace manifest");
  assertWorkspaceManifest(after, "post workspace manifest");
  const previous = new Map(before.files.map((item) => [item.path, item]));
  const current = new Map(after.files.map((item) => [item.path, item]));
  const paths = [...new Set([...previous.keys(), ...current.keys()])].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  const changes = [];
  for (const path of paths) {
    const old = previous.get(path);
    const item = current.get(path);
    if (!old) {
      changes.push({ change: "added", path, after: item });
    } else if (!item) {
      changes.push({ change: "removed", path, before: old });
    } else if (old.bytes !== item.bytes || old.sha256 !== item.sha256) {
      changes.push({ change: "modified", path, before: old, after: item });
    }
  }
  const bindingInput = {
    schema_version: "1.0",
    pre_manifest_sha256: before.manifest_sha256,
    post_manifest_sha256: after.manifest_sha256,
    changes,
  };
  return {
    ...bindingInput,
    change_count: changes.length,
    binding_sha256: digest(stableJson(bindingInput)),
  };
}

export async function collectWorkspacePatch(workspaceDir) {
  const [statusBytes, trackedPathBytes, untrackedPathBytes, trackedPatch] =
    await Promise.all([
      gitOutput(workspaceDir, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
      gitOutput(workspaceDir, ["diff", "--name-only", "-z", "HEAD", "--"]),
      gitOutput(workspaceDir, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
      gitOutput(workspaceDir, [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "HEAD",
        "--",
      ]),
    ]);
  const trackedPaths = nullSeparatedPaths(trackedPathBytes);
  const untrackedPaths = nullSeparatedPaths(untrackedPathBytes);
  const untrackedPatches = [];
  for (const path of untrackedPaths) {
    const patch = await gitOutput(
      workspaceDir,
      [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-index",
        "--",
        "/dev/null",
        path,
      ],
      { allowedExitCodes: [0, 1] },
    );
    if (patch.byteLength === 0) {
      throw new Error(
        `untracked file ${path} did not produce a complete patch`,
      );
    }
    untrackedPatches.push(patch);
  }
  const patch = joinPatchFragments([trackedPatch, ...untrackedPatches]);
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  const changedPathsBytes = Buffer.from(
    changedPaths.length > 0 ? `${changedPaths.join("\n")}\n` : "",
  );
  const patchSha256 = digest(patch);
  const changedPathsSha256 = digest(changedPathsBytes);
  const bindingSha256 = digest(
    stableJson({
      changed_paths_sha256: changedPathsSha256,
      patch_sha256: patchSha256,
    }),
  );
  return {
    status: statusBytes.toString("utf8"),
    patch,
    patch_text: patch.toString("utf8"),
    changed_paths: changedPaths,
    changed_paths_bytes: changedPathsBytes,
    patch_sha256: patchSha256,
    changed_paths_sha256: changedPathsSha256,
    binding_sha256: bindingSha256,
    tracked_paths: trackedPaths,
    untracked_paths: untrackedPaths,
  };
}

export async function collectKnowledgeSnapshot(
  workspaceDir,
  { includeContent = false } = {},
) {
  const roots = ["AGENTS.md", ".agents", ".opencode"];
  const files = [];
  async function walk(absolute, prefix) {
    if (!(await exists(absolute))) return;
    const metadata = await stat(absolute);
    if (metadata.isFile()) {
      const bytes = await readFile(absolute);
      const item = {
        path: prefix.split(sep).join("/"),
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      if (includeContent) item.content = bytes.toString("utf8");
      files.push(item);
      return;
    }
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      await walk(resolve(absolute, entry.name), `${prefix}/${entry.name}`);
    }
  }
  for (const root of roots) await walk(resolve(workspaceDir, root), root);
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

async function selectedContextFromEvents(parsed, workspaceDir) {
  const candidates = [];
  for (const tool of parsed.tools ?? []) {
    if (
      !["read", "grep", "glob", "list", "lsp"].includes(
        String(tool.tool).toLowerCase(),
      )
    ) {
      continue;
    }
    for (const rawPath of tool.paths ?? []) {
      const normalized = normalizePath(workspaceDir, rawPath);
      if (!normalized || normalized.outside_workspace || !normalized.path)
        continue;
      candidates.push({
        call_id: tool.call_id,
        tool: tool.tool,
        path: normalized.path,
        measurement:
          Number.isInteger(tool.output_bytes) && tool.output_sha256
            ? "tool-output"
            : "not-measured",
        bytes:
          Number.isInteger(tool.output_bytes) && tool.output_sha256
            ? tool.output_bytes
            : null,
        sha256: tool.output_sha256 ?? null,
      });
    }
  }
  const unique = new Map();
  for (const item of candidates)
    unique.set(`${item.call_id ?? ""}:${item.path}`, item);
  return [...unique.values()].sort((left, right) =>
    `${left.path}:${left.call_id ?? ""}`.localeCompare(
      `${right.path}:${right.call_id ?? ""}`,
      "en",
    ),
  );
}

function snapshotDiff(before, after) {
  const previous = new Map((before ?? []).map((item) => [item.path, item]));
  const current = new Map((after ?? []).map((item) => [item.path, item]));
  const diff = [];
  for (const item of after ?? []) {
    const old = previous.get(item.path);
    if (!old || old.sha256 !== item.sha256)
      diff.push({ change: old ? "modified" : "added", ...item });
  }
  for (const item of before ?? []) {
    if (!current.has(item.path)) diff.push({ change: "removed", ...item });
  }
  return diff.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

const ONBOARDING_ALLOWED = [/^AGENTS\.md$/, /^\.agents\//];

function changedPaths(status) {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) =>
      line.slice(3).trim().split(" -> ").at(-1).replaceAll("\\", "/"),
    );
}

export function onboardingHasDisallowedChanges(status) {
  return changedPaths(status).some(
    (path) => !ONBOARDING_ALLOWED.some((pattern) => pattern.test(path)),
  );
}

export function onboardingManifestHasDisallowedChanges(workspaceDiff) {
  return (workspaceDiff?.changes ?? []).some(
    (item) =>
      typeof item?.path !== "string" ||
      !ONBOARDING_ALLOWED.some((pattern) => pattern.test(item.path)),
  );
}

export async function collectRunEvidence({
  campaign,
  unit,
  phase,
  workspaceDir,
  outputDir,
  verification,
  gatewayReceipts = [],
  gatewayReceiptDir = null,
  gatewayCommand = null,
}) {
  await mkdir(outputDir, { recursive: true });
  const resultPath = resolve(outputDir, "result.json");
  const result = (await exists(resultPath))
    ? JSON.parse(await readFile(resultPath, "utf8"))
    : {};
  const rawPath = resolve(outputDir, "opencode.jsonl");
  const parsed = parseOpenCodeJsonl(
    (await exists(rawPath)) ? await readFile(rawPath, "utf8") : "",
  );
  const exportPath = resolve(outputDir, "session.export.json");
  const exported = (await exists(exportPath))
    ? parseOpenCodeExport(JSON.parse(await readFile(exportPath, "utf8")))
    : null;
  const workspacePrePath = resolve(outputDir, "workspace.pre.json");
  if (!(await exists(workspacePrePath))) {
    throw new Error(
      `${phase} workspace pre-manifest is missing; final bytes cannot be attested`,
    );
  }
  const workspacePre = await readWorkspaceManifest(workspacePrePath);
  const workspacePostPath = resolve(outputDir, "workspace.post.json");
  const workspacePost = await writeWorkspaceManifest(
    workspacePostPath,
    workspaceDir,
  );
  const workspaceDiff = diffWorkspaceManifests(
    workspacePre.manifest,
    workspacePost.manifest,
  );
  const workspaceDiffPath = resolve(outputDir, "workspace-diff.json");
  const workspaceDiffBytes = Buffer.from(stableJson(workspaceDiff));
  await writeFile(workspaceDiffPath, workspaceDiffBytes);
  const workspaceDiffArtifactSha256 = digest(workspaceDiffBytes);
  const manifestRecord = (path, value) => ({
    path,
    artifact_sha256: value.artifact_sha256,
    manifest_sha256: value.manifest.manifest_sha256,
    file_count: value.manifest.file_count,
    total_bytes: value.manifest.total_bytes,
  });
  const workspaceManifest = {
    schema_version: "1.0",
    algorithm: "sha256",
    exclusions: WORKSPACE_MANIFEST_EXCLUSIONS,
    pre: manifestRecord("workspace.pre.json", workspacePre),
    post: manifestRecord("workspace.post.json", workspacePost),
    diff: {
      path: "workspace-diff.json",
      artifact_sha256: workspaceDiffArtifactSha256,
      binding_sha256: workspaceDiff.binding_sha256,
      change_count: workspaceDiff.change_count,
      changes: workspaceDiff.changes,
    },
  };
  workspaceManifest.final_state_binding_sha256 = digest(
    stableJson({
      schema_version: workspaceManifest.schema_version,
      campaign_id: campaign.campaign_id,
      task_id: unit.task_id,
      attempt: unit.attempt,
      blind_label: unit.blind_label,
      phase,
      pre_artifact_sha256: workspaceManifest.pre.artifact_sha256,
      pre_manifest_sha256: workspaceManifest.pre.manifest_sha256,
      post_artifact_sha256: workspaceManifest.post.artifact_sha256,
      post_manifest_sha256: workspaceManifest.post.manifest_sha256,
      diff_artifact_sha256: workspaceManifest.diff.artifact_sha256,
      diff_binding_sha256: workspaceManifest.diff.binding_sha256,
    }),
  );
  const workspacePatch = await collectWorkspacePatch(workspaceDir);
  const statusText = workspacePatch.status;
  await writeFile(
    resolve(outputDir, "workspace-status.txt"),
    statusText,
    "utf8",
  );
  await writeFile(resolve(outputDir, "workspace.patch"), workspacePatch.patch);
  await writeFile(
    resolve(outputDir, "workspace-changed-paths.txt"),
    workspacePatch.changed_paths_bytes,
  );
  const workspacePatchEvidence = {
    patch_sha256: workspacePatch.patch_sha256,
    changed_paths: workspacePatch.changed_paths,
    changed_paths_sha256: workspacePatch.changed_paths_sha256,
    binding_sha256: workspacePatch.binding_sha256,
    tracked_paths: workspacePatch.tracked_paths,
    untracked_paths: workspacePatch.untracked_paths,
  };
  await writeJson(
    resolve(outputDir, "workspace-patch.json"),
    workspacePatchEvidence,
  );
  const mergedTools = [
    ...(parsed.tools ?? []),
    ...(exported?.tools ?? []),
  ].filter(
    (tool, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.call_id === tool.call_id &&
          candidate.input_sha256 === tool.input_sha256,
      ) === index,
  );
  const parsedForPolicy = { ...parsed, tools: mergedTools };
  const gatewayArtifacts = await collectWorkspaceEditReceipts({
    receipts: gatewayReceipts,
    receiptDir: gatewayReceiptDir,
    phase,
  });
  const gatewayTrace = workspaceEditReceiptTrace(
    gatewayArtifacts,
    gatewayCommand,
  );
  const gatewayReconciliation = reconcileWorkspaceEditReceipts(
    gatewayArtifacts,
    workspacePre.manifest,
    workspacePost.manifest,
  );
  const filesystemTrace = [
    ...buildFilesystemTrace(parsedForPolicy, workspaceDir),
    ...gatewayTrace,
  ];
  const knowledge = await collectKnowledgeSnapshot(workspaceDir, {
    includeContent: true,
  });
  const selectedContext = await selectedContextFromEvents(
    parsedForPolicy,
    workspaceDir,
  );
  const preSnapshotPath = resolve(outputDir, "knowledge.pre.json");
  const preKnowledge = (await exists(preSnapshotPath))
    ? JSON.parse(await readFile(preSnapshotPath, "utf8"))
    : (result.knowledge_pre_snapshot ?? []);
  const knowledgeDiff = snapshotDiff(preKnowledge, knowledge);
  const capture = knowledgeDiff.filter((item) =>
    /^\.agents\/knowledge\/(?:observations|inbox)\//.test(item.path),
  );
  const usageRecords = exported?.response_usage?.length
    ? exported.response_usage
    : parsed.response_usage;
  const usage = usageRecords.reduce(
    (total, item) => ({
      input_tokens: total.input_tokens + item.input_tokens,
      output_tokens: total.output_tokens + item.output_tokens,
      reasoning_tokens: total.reasoning_tokens + item.reasoning_tokens,
      cache_read_input_tokens:
        total.cache_read_input_tokens + item.cache_read_input_tokens,
      cache_creation_input_tokens:
        total.cache_creation_input_tokens + item.cache_creation_input_tokens,
    }),
    {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  );
  const evidence = {
    schema_version: "1.0",
    campaign_id: campaign.campaign_id,
    task_id: unit.task_id,
    attempt: unit.attempt,
    blind_label: unit.blind_label,
    phase,
    execution: {
      status: result.status ?? "unavailable",
      exit_code: result.exit_code ?? null,
      started_at: result.started_at ?? null,
      finished_at: result.finished_at ?? null,
      duration_ms: finiteInteger(result.duration_ms),
      timed_out: result.timed_out === true,
      tool_budget_exceeded: result.tool_budget_exceeded === true,
    },
    session_id:
      exported?.session_id ?? parsed.session_id ?? result.session_id ?? null,
    usage: {
      status: usageRecords.length > 0 ? "measured" : "not-measured",
      value: usageRecords.length > 0 ? usage : null,
      responses: usageRecords,
    },
    tool_calls: exported?.tool_calls ?? parsed.tool_calls,
    final: exported?.final ?? parsed.final ?? result.final ?? null,
    provider_errors: [...parsed.errors, ...(exported?.errors ?? [])],
    parse_errors: parsed.parse_errors,
    filesystem_trace: filesystemTrace,
    workspace_edit: {
      schema_version: "1.0",
      receipt_count: gatewayArtifacts.length,
      receipts: gatewayArtifacts.map((artifact) => ({
        path: (() => {
          if (!artifact.artifact_path) return null;
          const root = resolve(outputDir);
          const candidate = resolve(artifact.artifact_path);
          const offset = relative(root, candidate);
          return offset === "" ||
            (!offset.startsWith("..") && !resolve(offset).startsWith(sep))
            ? offset.split(sep).join("/")
            : null;
        })(),
        artifact_sha256: artifact.artifact_sha256,
        receipt: artifact.receipt,
      })),
      gateway_command_sha256:
        typeof gatewayCommand === "string"
          ? digest(Buffer.from(gatewayCommand))
          : null,
      ...gatewayReconciliation,
    },
    path_escape_detected:
      filesystemTrace.some((item) => item.outside_workspace === true) ||
      hasForbiddenPathCommand(parsedForPolicy, workspaceDir),
    network_violation_detected: hasForbiddenNetworkCommand(
      parsedForPolicy,
      result.allowed_commands,
    ),
    child_session_detected:
      result.child_session_detected === true ||
      mergedTools.some((tool) =>
        ["task", "subagent", "agent"].includes(
          String(tool.tool ?? "").toLowerCase(),
        ),
      ),
    allowed_commands: Array.isArray(result.allowed_commands)
      ? result.allowed_commands
      : [],
    assurance: {
      network_enforcement:
        "wsl-user-network-namespace+deny-first-command-allowlist",
      filesystem_trace_kind: "opencode-tool-event-derived",
      child_sessions: "denied",
      ...(result.assurance ?? {}),
      workspace_state: "pre-post-byte-manifest",
      workspace_event_trace: "opencode-tool-event-derived",
      filesystem_audit: "not-syscall-audit",
      workspace_limitations: [
        "pre/post manifests cannot distinguish no write from write-then-revert when final bytes match",
        "filesystem trace is OpenCode tool-event-derived; pathless shell writes may lack target paths and are not a syscall audit",
        "workspace-edit gateway receipts are structured command evidence; they do not constitute a syscall audit",
      ],
    },
    randomness: result.randomness ?? {
      seed_support: "not-supported",
      seed: "not-measured",
      variant: null,
    },
    transport: result.transport ?? null,
    skill_load: result.skill_load ?? null,
    effective_config: result.effective_config ?? null,
    subject: result.subject ?? null,
    toolchain_shims: result.toolchain_shims ?? null,
    confinement: result.confinement ?? null,
    credentials: result.credentials ?? null,
    instructions: result.instructions ?? null,
    shell_wrapper: result.shell_wrapper ?? null,
    session_chain: result.session_chain ?? {
      status: phase === "repair" ? "missing" : "not-applicable",
    },
    source_or_test_changed:
      phase === "onboarding" &&
      (onboardingHasDisallowedChanges(statusText) ||
        onboardingManifestHasDisallowedChanges(workspaceDiff)),
    selected_context: selectedContext,
    capture,
    knowledge_pre_snapshot: preKnowledge,
    knowledge_post_snapshot: knowledge,
    knowledge_diff: knowledgeDiff,
    knowledge_snapshot: knowledge,
    workspace_patch: workspacePatchEvidence,
    workspace_manifest: workspaceManifest,
    workspace_tree_sha256: workspacePost.manifest.manifest_sha256,
    verification: verification ?? null,
  };
  await writeJson(resolve(outputDir, "filesystem-trace.json"), filesystemTrace);
  await writeJson(resolve(outputDir, "selected-context.json"), selectedContext);
  await writeJson(resolve(outputDir, "capture-manifest.json"), capture);
  await writeJson(resolve(outputDir, "knowledge-snapshot.json"), knowledge);
  await writeJson(resolve(outputDir, "knowledge-post.json"), knowledge);
  await writeJson(resolve(outputDir, "knowledge-diff.json"), knowledgeDiff);
  await writeJson(resolve(outputDir, "evidence.json"), evidence);
  return evidence;
}
