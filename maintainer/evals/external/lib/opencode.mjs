import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, parse, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFilesystemTrace,
  collectKnowledgeSnapshot,
  collectRunEvidence,
  hasForbiddenNetworkCommand,
  parseOpenCodeExport,
  parseOpenCodeJsonl,
  writeWorkspaceManifest,
} from "./collector.mjs";
import { createBlindBundle, runBlindReview } from "./blind.mjs";
import { fileSha256, hashTree, stableJson, writeJson } from "./core.mjs";
import {
  applyCoordinatorAclLease,
  CODEX_SANDBOX_PROFILE,
  CONFINEMENT_CONTRACT,
  prepareDedicatedCodexHome,
  runCodexSandboxed,
  verifyWindowsConfinement,
  WINDOWS_CONFINEMENT,
} from "./confinement.mjs";

export { collectRunEvidence, createBlindBundle, runBlindReview };

const PINNED_WSL_TOOLCHAIN = Object.freeze({
  distro: "Ubuntu",
  root: "/home/d26fo/.local/share/self-evolution-toolchains/node-v22.13.1",
  node: "22.13.1",
  npm: "10.9.2",
});
export const NETWORK_ENFORCEMENT =
  "windows-restricted-token+wsl-bwrap-user-net+deny-first-command-allowlist";
export const NETWORK_NAMESPACE = "wsl-bwrap-unshare-user-net";
export const NETWORK_CANARIES = "node+python+shell-wrapper+interop";
export const TOOLCHAIN_SHIM_ENFORCEMENT =
  "opencode-config-shell-to-wsl-bwrap-unshare-user-net";
export const FILESYSTEM_ENFORCEMENT =
  "windows-restricted-token+reversible-forbidden-acl+wsl-bwrap-bind-map";
export const WORKSPACE_RUNTIME_ROOT = "/workspace";
export const SUBJECT_RUNTIME_ROOT = "/subject/self-evolution";
export const WORKSPACE_EDIT_RUNTIME_COMMAND = "/harness/workspace-edit";
const WORKSPACE_EDIT_RUNTIME_ROOT = "/harness";
const WORKSPACE_EDIT_RUNTIME_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "workspace-edit.mjs",
);
const WORKSPACE_EDIT_CORE_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "core.mjs",
);

export function isolatedRuntimeParent({ campaignRoot = null, workspaceDir }) {
  const anchor = campaignRoot ?? workspaceDir;
  if (!anchor) throw new Error("isolated runtime requires a filesystem anchor");
  return dirname(resolve(anchor));
}
export const RUNTIME_INSTRUCTIONS_SOURCE = [
  "# Isolated external evaluation runtime",
  "",
  `Shell commands see the project at ${WORKSPACE_RUNTIME_ROOT}.`,
  `The loaded self-evolution skill is mounted read-only at ${SUBJECT_RUNTIME_ROOT}.`,
  "OpenCode may display a Windows absolute base directory for that skill. Do not pass",
  `that Windows path to shell commands; resolve bundled references under ${SUBJECT_RUNTIME_ROOT}.`,
  "Use only the two runtime roots above for absolute shell paths. Do not access host or",
  "coordinator paths, and do not use network commands.",
  "",
].join("\n");
export const EXTERNAL_ISOLATION_CONTRACT = Object.freeze({
  network_enforcement: NETWORK_ENFORCEMENT,
  network_namespace: NETWORK_NAMESPACE,
  network_canaries: NETWORK_CANARIES,
  toolchain_shim_enforcement: TOOLCHAIN_SHIM_ENFORCEMENT,
  filesystem_enforcement: FILESYSTEM_ENFORCEMENT,
  windows_confinement: WINDOWS_CONFINEMENT,
  codex_sandbox_profile: CODEX_SANDBOX_PROFILE,
  credential_transport: CONFINEMENT_CONTRACT.credential_transport,
});
export const WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256 = sha256(
  JSON.stringify({
    "core.mjs": sha256(readFileSync(WORKSPACE_EDIT_CORE_SOURCE)),
    "workspace-edit.mjs": sha256(readFileSync(WORKSPACE_EDIT_RUNTIME_SOURCE)),
  }),
);
const PROVIDER_SECRET_ENV =
  /(?:^|_)(?:API_?KEY|AUTH_?TOKEN|ACCESS_?TOKEN|SECRET|PASSWORD|BEARER)(?:_|$)/i;
const READ_ONLY_COMMAND_PATTERNS = Object.freeze([
  "git status*",
  "git diff*",
  "git ls-files*",
  "git grep*",
  "git log*",
  "git show*",
  "git rev-parse*",
  "rg *",
  "grep *",
  "find *",
  "ls*",
  "dir*",
  "type *",
  "Get-Content *",
]);
const KNOWLEDGE_COMMAND_PATTERNS = Object.freeze([
  "node *self-evolution*references/bin/kb.mjs *",
  "sh *self-evolution*references/scripts/*",
  "bash *self-evolution*references/scripts/*",
]);
const WORKSPACE_EDIT_COMMAND_PATTERN = `${WORKSPACE_EDIT_RUNTIME_COMMAND} *`;
const ALLOWED_ENV = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "TERM",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);
const ISOLATION_FLAGS = Object.freeze({
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
});
const NETWORK_CANARY_HOST = "1.1.1.1";
const NETWORK_CANARY_PORT = 443;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha1(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function workspaceEditSmokePatch() {
  const path = ".agents/.external-gateway-smoke";
  const content = Buffer.from("gateway smoke\n");
  return {
    path,
    content,
    patch: [
      `diff --git a/${path} b/${path}`,
      "new file mode 100644",
      `index ${"0".repeat(40)}..${gitBlobSha1(content)}`,
      "--- /dev/null",
      `+++ b/${path}`,
      "@@ -0,0 +1 @@",
      "+gateway smoke",
      "",
    ].join("\n"),
  };
}

function providerId(model) {
  const index = String(model).indexOf("/");
  if (index <= 0)
    throw new Error(`model ${model} must use provider/model syntax`);
  return String(model).slice(0, index);
}

function executable() {
  if (process.env.OPENCODE_EXECUTABLE) return process.env.OPENCODE_EXECUTABLE;
  if (process.platform !== "win32") return "opencode";
  const pathEntries = String(process.env.PATH ?? "").split(";");
  for (const entry of pathEntries) {
    if (!entry) continue;
    const candidate = resolve(
      entry,
      "node_modules/opencode-ai/bin/opencode.exe",
    );
    if (existsSync(candidate)) return candidate;
    const direct = resolve(entry, "opencode.exe");
    if (existsSync(direct)) return direct;
    const commandShim = resolve(entry, "opencode.cmd");
    if (existsSync(commandShim)) {
      const shim = readFileSync(commandShim, "utf8");
      const match = /["']?%dp0%[\\/]([^"'\r\n]*opencode\.exe)/i.exec(shim);
      if (match) {
        const resolved = resolve(entry, match[1]);
        if (existsSync(resolved)) return resolved;
      }
    }
  }
  throw new Error(
    "cannot resolve opencode.exe; set OPENCODE_EXECUTABLE to the real binary",
  );
}

function globalPaths() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error("cannot resolve the current user profile");
  return {
    config: resolve(home, ".config/opencode/opencode.json"),
    auth: resolve(home, ".local/share/opencode/auth.json"),
  };
}

function codexSourceHome() {
  const home = process.env.CODEX_HOME;
  if (home && existsSync(resolve(home, ".sandbox/setup_marker.json"))) {
    return resolve(home);
  }
  const profile = process.env.USERPROFILE || process.env.HOME;
  if (!profile) throw new Error("cannot resolve Codex sandbox source home");
  return resolve(profile, ".codex");
}

function assertNoSecretEnvironment(env) {
  for (const key of Object.keys(env)) {
    if (
      key === "OPENCODE_CONFIG_CONTENT" ||
      key === "OPENCODE_AUTH_CONTENT" ||
      PROVIDER_SECRET_ENV.test(key)
    ) {
      throw new Error(
        `isolated OpenCode environment contains secret variable ${key}`,
      );
    }
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sourceCredentials(model) {
  const id = providerId(model);
  const paths = globalPaths();
  const globalConfig = JSON.parse(await readFile(paths.config, "utf8"));
  const provider = globalConfig.provider?.[id];
  if (!provider || typeof provider !== "object") {
    throw new Error(`OpenCode provider ${id} is not configured`);
  }
  const modelId = String(model).slice(id.length + 1);
  if (!provider.models?.[modelId]) {
    throw new Error(`OpenCode provider ${id} does not define model ${modelId}`);
  }
  const auth = (await exists(paths.auth))
    ? JSON.parse(await readFile(paths.auth, "utf8"))
    : {};
  return {
    providerId: id,
    provider,
    auth: auth[id] ? { [id]: auth[id] } : {},
    source: {
      provider_keys: Object.keys(provider).sort(),
      provider_options_keys: Object.keys(provider.options ?? {}).sort(),
      auth_present: Boolean(auth[id]),
      auth_type: auth[id]?.type ?? null,
    },
  };
}

function isolatedBaseEnvironment(root) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || !ALLOWED_ENV.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  env.HOME = root;
  env.USERPROFILE = root;
  env.XDG_CONFIG_HOME = resolve(root, "config");
  env.XDG_DATA_HOME = resolve(root, "data");
  env.XDG_CACHE_HOME = resolve(root, "cache");
  env.XDG_STATE_HOME = resolve(root, "state");
  env.OPENCODE_CONFIG_DIR = resolve(root, "opencode-config");
  Object.assign(env, ISOLATION_FLAGS);
  delete env.OPENCODE_CONFIG_CONTENT;
  delete env.OPENCODE_AUTH_CONTENT;
  for (const key of Object.keys(env)) {
    if (PROVIDER_SECRET_ENV.test(key)) delete env[key];
  }
  assertNoSecretEnvironment(env);
  return env;
}

async function launchIsolated(
  isolated,
  file,
  args,
  { cwd, timeoutMs, stdin, onStdoutLine } = {},
) {
  const launch = isolated.confinement.launches.length + 1;
  const receiptDir = resolve(
    isolated.confinement.receiptRoot,
    `launch-${String(launch).padStart(2, "0")}`,
  );
  const lease = isolated.campaignRoot
    ? await applyCoordinatorAclLease({
        campaignRoot: isolated.campaignRoot,
        receiptDir,
      })
    : null;
  let restoration = null;
  try {
    if (lease && !isolated.confinement.windowsCanary) {
      isolated.confinement.windowsCanary = await verifyWindowsConfinement({
        codexHome: isolated.codexHome.root,
        workspaceDir: cwd,
        campaignRoot: isolated.campaignRoot,
        env: isolated.env,
      });
    }
    return await runCodexSandboxed({
      codexHome: isolated.codexHome.root,
      workspaceDir: cwd,
      file,
      args,
      env: isolated.env,
      timeoutMs,
      stdin,
      onStdoutLine,
    });
  } finally {
    if (lease) restoration = await lease.restore();
    isolated.confinement.launches.push({
      launch,
      status: lease ? "restored" : "not-applicable",
      manifest_sha256: lease?.manifest_sha256 ?? null,
      script_sha256: lease?.script_sha256 ?? null,
      targets: lease?.targets ?? [],
      restore_receipt_sha256: restoration?.receipt_sha256 ?? null,
    });
  }
}

function normalizeShellCommand(command) {
  return String(command).trim().replaceAll(/\s+/g, " ");
}

function escapePermissionPattern(command) {
  return normalizeShellCommand(command).replaceAll("\\", "/");
}

export function phaseAllowedCommands(task, phase) {
  if (!task || typeof task !== "object") {
    throw new Error("runPhase requires the frozen task contract");
  }
  const validation = task.validation ?? {};
  const taskCommands =
    phase === "repair"
      ? [...(validation.focused ?? []), ...(validation.full ?? [])]
      : [];
  const commands = [
    ...READ_ONLY_COMMAND_PATTERNS,
    ...KNOWLEDGE_COMMAND_PATTERNS,
    WORKSPACE_EDIT_COMMAND_PATTERN,
    ...taskCommands.map(escapePermissionPattern),
  ];
  return [...new Set(commands)];
}

function permissionConfig(
  skillDir,
  { readOnly = false, allowedCommands = [] } = {},
) {
  if (readOnly) {
    return {
      "*": "deny",
      read: "deny",
      glob: "deny",
      grep: "deny",
      edit: "deny",
      write: "deny",
      apply_patch: "deny",
      bash: "deny",
      task: "deny",
      question: "deny",
      todowrite: "deny",
      webfetch: "deny",
      websearch: "deny",
      lsp: "deny",
      external_directory: "deny",
      skill: "deny",
      doom_loop: "deny",
    };
  }
  const external = { "*": "deny" };
  if (skillDir) external[resolve(skillDir)] = "allow";
  const bash = { "*": "deny" };
  for (const pattern of allowedCommands) bash[pattern] = "allow";
  return {
    "*": "deny",
    read: "deny",
    glob: "deny",
    grep: "deny",
    edit: "deny",
    write: "deny",
    apply_patch: "deny",
    skill: skillDir ? "allow" : "deny",
    task: "deny",
    question: "deny",
    plan_enter: "deny",
    plan_exit: "deny",
    webfetch: "deny",
    websearch: "deny",
    doom_loop: "deny",
    bash,
    external_directory: external,
  };
}

async function captureProcess(
  file,
  args,
  { cwd, env, timeoutMs, stdin, onStdoutLine },
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let stdoutRemainder = "";
    let policyTermination = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    if (stdin !== undefined) child.stdin.end(stdin);
    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      stdout.push(bytes);
      if (typeof onStdoutLine !== "function" || policyTermination) return;
      stdoutRemainder += bytes.toString("utf8");
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        const reason = onStdoutLine(line);
        if (!reason) continue;
        policyTermination = reason;
        child.kill("SIGKILL");
        break;
      }
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (
        stdoutRemainder.trim() &&
        typeof onStdoutLine === "function" &&
        !policyTermination
      ) {
        policyTermination = onStdoutLine(stdoutRemainder);
      }
      resolvePromise({
        exitCode: code ?? 1,
        signal,
        timedOut,
        policyTermination,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function captureWindowsCommandShim(path, args, { cwd, env, timeoutMs }) {
  if (process.platform !== "win32") {
    return captureProcess(path, args, { cwd, env, timeoutMs });
  }
  return captureProcess(
    process.env.COMSPEC || "cmd.exe",
    ["/d", "/s", "/c", "call", path, ...args],
    { cwd, env, timeoutMs },
  );
}

function parsedExecution(stdout, exported = null) {
  const stream = parseOpenCodeJsonl(stdout);
  const archive = exported ? parseOpenCodeExport(exported) : null;
  const tools = [...(stream.tools ?? []), ...(archive?.tools ?? [])].filter(
    (tool, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.call_id === tool.call_id &&
          candidate.input_sha256 === tool.input_sha256,
      ) === index,
  );
  return {
    stream,
    archive,
    policy: { ...stream, tools },
    final: archive?.final ?? stream.final,
    errors: [...stream.errors, ...(archive?.errors ?? [])],
    usage: archive?.response_usage?.length
      ? archive.response_usage
      : stream.response_usage,
    toolCalls: tools.length,
  };
}

const FORBIDDEN_PATH_SEGMENT = new Set([
  "oracle",
  "hidden",
  "sealed",
  "subjects",
]);

function unquoteShellToken(value) {
  return String(value).replace(/^["']|["']$/g, "");
}

function shellTokens(command) {
  return (String(command).match(/"[^"]*"|'[^']*'|[^\s;&|<>]+/g) ?? []).map(
    unquoteShellToken,
  );
}

function shellPathCandidates(command) {
  return shellTokens(command).filter(
    (token) =>
      token === ".." ||
      token.startsWith("../") ||
      token.startsWith("..\\") ||
      token.includes("/../") ||
      token.includes("\\..\\") ||
      token.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(token) ||
      token.startsWith("\\\\"),
  );
}

function forbiddenPathSegment(value) {
  return String(value)
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => FORBIDDEN_PATH_SEGMENT.has(segment.toLowerCase()));
}

function allowedContainerPath(candidate) {
  if (!candidate.startsWith("/")) return false;
  const normalized = posix.normalize(candidate);
  if (normalized !== candidate.replace(/\/$/, "") && candidate !== "/") {
    return false;
  }
  return (
    normalized === WORKSPACE_RUNTIME_ROOT ||
    normalized.startsWith(`${WORKSPACE_RUNTIME_ROOT}/`) ||
    normalized === SUBJECT_RUNTIME_ROOT ||
    normalized.startsWith(`${SUBJECT_RUNTIME_ROOT}/`)
  );
}

export function hasForbiddenRuntimePathCommand(parsed, workspaceDir) {
  const workspaceRoot = resolve(workspaceDir);
  return (parsed.tools ?? []).some((tool) => {
    if (tool.access !== "execute" || typeof tool.command !== "string") {
      return false;
    }
    if (workspaceEditInvocation(tool.command)) return false;
    if (shellTokens(tool.command).some(forbiddenPathSegment)) return true;
    return shellPathCandidates(tool.command).some((candidate) => {
      if (/^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("\\\\")) {
        return true;
      }
      if (candidate.startsWith("/")) return !allowedContainerPath(candidate);
      const absolute = resolve(workspaceRoot, candidate);
      const offset = relative(workspaceRoot, absolute);
      return (
        offset === ".." || offset.startsWith("../") || offset.startsWith("..\\")
      );
    });
  });
}

function runtimeFilesystemTrace(parsed, workspaceDir) {
  return buildFilesystemTrace(parsed, workspaceDir).map((item) => {
    if (item.access !== "execute" || item.outside_workspace !== true)
      return item;
    const tool = (parsed.tools ?? []).find(
      (candidate) => candidate.call_id === item.call_id,
    );
    const containerPath = (tool?.paths ?? []).find(
      (candidate) =>
        candidate === WORKSPACE_RUNTIME_ROOT ||
        candidate.startsWith(`${WORKSPACE_RUNTIME_ROOT}/`) ||
        candidate === SUBJECT_RUNTIME_ROOT ||
        candidate.startsWith(`${SUBJECT_RUNTIME_ROOT}/`),
    );
    return containerPath
      ? { ...item, outside_workspace: false, path: containerPath }
      : item;
  });
}

function hasMalformedWorkspaceEditCommand(parsed) {
  return (parsed.tools ?? []).some(
    (tool) =>
      tool.access === "execute" &&
      typeof tool.command === "string" &&
      normalizeShellCommand(tool.command).startsWith(
        WORKSPACE_EDIT_RUNTIME_COMMAND,
      ) &&
      !workspaceEditInvocation(tool.command),
  );
}

export function policyViolations(parsed, workspaceDir, allowedCommands = []) {
  const trace = runtimeFilesystemTrace(parsed.policy, workspaceDir);
  return {
    trace,
    pathEscape:
      trace.some((item) => item.outside_workspace === true) ||
      hasForbiddenRuntimePathCommand(parsed.policy, workspaceDir) ||
      hasMalformedWorkspaceEditCommand(parsed.policy),
    network: hasForbiddenNetworkCommand(parsed.policy, allowedCommands),
  };
}

export function livePolicyViolation(line, workspaceDir, allowedCommands = []) {
  if (!String(line).trim()) return null;
  const parsed = parseOpenCodeJsonl(line);
  if (parsed.parse_errors.length > 0) return "malformed-jsonl";
  if (
    parsed.tools.some((tool) =>
      ["task", "subagent", "agent"].includes(
        String(tool.tool ?? "").toLowerCase(),
      ),
    )
  )
    return "child-session";
  if (hasForbiddenNetworkCommand(parsed, allowedCommands))
    return "forbidden-network-command";
  if (hasMalformedWorkspaceEditCommand(parsed)) return "path-escape";
  if (hasForbiddenRuntimePathCommand(parsed, workspaceDir))
    return "path-escape";
  const trace = runtimeFilesystemTrace(parsed, workspaceDir);
  if (trace.some((item) => item.outside_workspace === true))
    return "path-escape";
  return null;
}

function smokeSucceeded(execution, parsed) {
  return (
    execution.exitCode === 0 &&
    !execution.timedOut &&
    parsed.stream.parse_errors.length === 0 &&
    parsed.errors.length === 0 &&
    typeof parsed.final === "string" &&
    parsed.final.trim().length > 0 &&
    parsed.usage.length > 0 &&
    parsed.usage.every(
      (item) =>
        Number.isInteger(item.input_tokens) &&
        item.input_tokens >= 0 &&
        Number.isInteger(item.output_tokens) &&
        item.output_tokens > 0,
    )
  );
}

export function validateResolvedConfig(config, expected) {
  const providers = Object.keys(config.provider ?? {});
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  const mcp = Object.keys(config.mcp ?? {});
  const paths = config.skills?.paths ?? [];
  const instructions = config.instructions ?? [];
  if (providers.length !== 1 || providers[0] !== expected.providerId) {
    throw new Error(
      "isolated OpenCode config did not resolve to exactly the target provider",
    );
  }
  if (plugins.length !== 0)
    throw new Error("isolated OpenCode config loaded plugins");
  if (mcp.length !== 0)
    throw new Error("isolated OpenCode config loaded MCP servers");
  const expectedPaths = expected.skillDir ? [resolve(expected.skillDir)] : [];
  if (stableJson(paths) !== stableJson(expectedPaths)) {
    throw new Error("isolated OpenCode config loaded unexpected skill paths");
  }
  if (resolve(config.shell ?? "") !== resolve(expected.shellPath ?? "")) {
    throw new Error("isolated OpenCode config did not bind the shell wrapper");
  }
  const expectedInstructions = (
    expected.instructionsPaths ??
    (expected.instructionsPath ? [expected.instructionsPath] : [])
  ).map((path) => resolve(path));
  if (stableJson(instructions) !== stableJson(expectedInstructions)) {
    throw new Error("isolated OpenCode config loaded unexpected instructions");
  }
  if (
    config.permission?.webfetch !== "deny" ||
    config.permission?.websearch !== "deny" ||
    config.permission?.task !== "deny" ||
    config.permission?.read !== "deny" ||
    config.permission?.glob !== "deny" ||
    config.permission?.grep !== "deny" ||
    config.permission?.edit !== "deny" ||
    config.permission?.write !== "deny" ||
    config.permission?.apply_patch !== "deny"
  ) {
    throw new Error(
      "isolated OpenCode config did not deny native filesystem, network, or task tools",
    );
  }
  if (expected.readOnly) {
    if (
      config.permission?.bash !== "deny" ||
      config.permission?.edit !== "deny"
    ) {
      throw new Error("read-only OpenCode config allowed bash or edit");
    }
  } else {
    if (config.permission?.bash?.["*"] !== "deny") {
      throw new Error("isolated OpenCode config bash policy is not deny-first");
    }
    for (const pattern of expected.allowedCommands ?? []) {
      if (config.permission?.bash?.[pattern] !== "allow") {
        throw new Error(`isolated OpenCode config did not allow ${pattern}`);
      }
    }
  }
}

function windowsPathForBatch(path) {
  return `"${resolve(path).replaceAll("%", "%%")}"`;
}

function shellLinuxPath(path) {
  const absolute = resolve(path);
  if (process.platform !== "win32") return absolute.replaceAll("\\", "/");
  const root = parse(absolute).root;
  const drive = root[0].toLowerCase();
  const tail = absolute.slice(root.length).replaceAll("\\", "/");
  return `/mnt/${drive}/${tail}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function bwrapBindPath(path) {
  if (/^[A-Za-z0-9_./:-]+$/.test(String(path))) return String(path);
  return `"${String(path).replaceAll('"', '\\"')}"`;
}

function bwrapSystemMounts(toolchain) {
  return [
    "--ro-bind /usr /usr",
    "--tmpfs /usr/local",
    "--dir /usr/local/bin",
    "--dir /usr/local/sbin",
    "--symlink usr/bin /bin",
    "--symlink usr/lib /lib",
    "--symlink usr/lib64 /lib64",
    "--symlink usr/sbin /sbin",
    "--ro-bind /etc /etc",
    "--dev /dev",
    "--proc /proc",
    "--tmpfs /tmp",
    "--dir /run",
    `--ro-bind ${bwrapBindPath(toolchain.root)} /toolchain`,
    "--dir /home",
  ];
}

function wrapperPolicy({ workspaceDir, subjectDir, toolchain }) {
  const workspaceHost = resolve(workspaceDir);
  const workspace = shellLinuxPath(workspaceDir);
  const subject = subjectDir ? shellLinuxPath(subjectDir) : null;
  const path =
    "/toolchain/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  return { workspace, workspaceHost, subject, path };
}

function subjectMounts(policy) {
  return policy.subject
    ? [
        "--dir /subject",
        `--ro-bind ${bwrapBindPath(policy.subject)} ${SUBJECT_RUNTIME_ROOT}`,
      ]
    : ["--dir /subject"];
}

function gitMetadataMount(policy) {
  const metadataPath = resolve(policy.workspaceHost, ".git");
  if (!existsSync(metadataPath)) return [];
  const metadata = lstatSync(metadataPath);
  if (!metadata.isDirectory()) {
    throw new Error(
      "external evaluation requires .git to be a real directory; gitfiles are unsupported",
    );
  }
  return [
    `--ro-bind ${bwrapBindPath(`${policy.workspace}/.git`)} /workspace/.git`,
  ];
}

export function toolchainShimSource(
  tool,
  toolchain = PINNED_WSL_TOOLCHAIN,
  options = {},
) {
  const { workspaceDir = process.cwd(), subjectDir = null } = options;
  const policy = wrapperPolicy({ workspaceDir, subjectDir, toolchain });
  const executablePath = {
    node: "/toolchain/bin/node",
    npm: "/toolchain/bin/npm",
    npx: "/toolchain/bin/npx",
    sh: "/usr/bin/sh",
    bash: "/usr/bin/bash",
    python: "/usr/bin/python3",
    python3: "/usr/bin/python3",
  }[tool];
  if (!executablePath) throw new Error(`unsupported toolchain shim ${tool}`);
  const command = [
    "wsl.exe",
    `--distribution ${toolchain.distro}`,
    `--cd ${windowsPathForBatch(workspaceDir)}`,
    "--exec /usr/bin/bwrap",
    "--unshare-user --unshare-pid --unshare-net --unshare-uts --unshare-ipc",
    "--die-with-parent --new-session",
    ...bwrapSystemMounts(toolchain),
    `--bind ${bwrapBindPath(policy.workspace)} /workspace`,
    ...subjectMounts(policy),
    ...gitMetadataMount(policy),
    "--chdir /workspace --clearenv",
    `--setenv PATH ${policy.path}`,
    "--setenv HOME /workspace --setenv WSL_INTEROP /dev/null --setenv TMPDIR /tmp",
    `-- ${executablePath} %*`,
  ].join(" ");
  return ["@echo off", "setlocal", command, "exit /b %ERRORLEVEL%", ""].join(
    "\r\n",
  );
}

export function shellWrapperSource(
  {
    workspaceDir,
    subjectDir = null,
    receiptPath = null,
    workspaceEdit = null,
    workspaceEditSource = null,
    workspaceEditCoreSource = null,
    workspaceEditReceiptDir = null,
  },
  toolchain = PINNED_WSL_TOOLCHAIN,
) {
  const policy = wrapperPolicy({ workspaceDir, subjectDir, toolchain });
  const receipt = receiptPath
    ? `>${windowsPathForBatch(receiptPath)} echo %*`
    : "rem no receipt requested";
  const harnessMounts = workspaceEdit
    ? [
        `--ro-bind ${bwrapBindPath(shellLinuxPath(workspaceEditSource))} ${WORKSPACE_EDIT_RUNTIME_ROOT}/workspace-edit.mjs`,
        `--ro-bind ${bwrapBindPath(shellLinuxPath(workspaceEditCoreSource))} ${WORKSPACE_EDIT_RUNTIME_ROOT}/core.mjs`,
        `--bind ${bwrapBindPath(shellLinuxPath(workspaceEditReceiptDir))} ${WORKSPACE_EDIT_RUNTIME_ROOT}/receipts`,
      ]
    : [];
  const sandbox = [
    "wsl.exe",
    `--distribution ${toolchain.distro}`,
    `--cd ${windowsPathForBatch(workspaceDir)}`,
    "--exec /usr/bin/bwrap",
    "--unshare-user --unshare-pid --unshare-net --unshare-uts --unshare-ipc",
    "--die-with-parent --new-session",
    ...bwrapSystemMounts(toolchain),
    `--bind ${bwrapBindPath(policy.workspace)} /workspace`,
    ...subjectMounts(policy),
    ...gitMetadataMount(policy),
    ...(workspaceEdit
      ? [`--dir ${WORKSPACE_EDIT_RUNTIME_ROOT}`, ...harnessMounts]
      : []),
    "--chdir /workspace --clearenv",
    `--setenv PATH ${policy.path}`,
    "--setenv HOME /workspace --setenv WSL_INTEROP /dev/null --setenv TMPDIR /tmp",
    "--setenv GIT_OPTIONAL_LOCKS 0",
  ];
  const regularCommand = [...sandbox, "-- /usr/bin/bash %*"].join(" ");
  const gatewayCommand = workspaceEdit
    ? [
        ...sandbox,
        `-- /toolchain/bin/node ${WORKSPACE_EDIT_RUNTIME_ROOT}/workspace-edit.mjs`,
        `--workspace ${WORKSPACE_RUNTIME_ROOT}`,
        `--phase ${workspaceEdit.phase}`,
        `--receipt-dir ${WORKSPACE_EDIT_RUNTIME_ROOT}/receipts`,
        "--patch-base64url %2",
      ].join(" ")
    : null;
  const lines = [
    "@echo off",
    "setlocal EnableExtensions EnableDelayedExpansion",
    receipt,
  ];
  if (gatewayCommand) {
    lines.push(
      'if /I "%~1"=="-c" (',
      '  set "external_command=%~2"',
      `  for /f "tokens=1,2,*" %%A in ("%external_command%") do if /I "%%A"=="${WORKSPACE_EDIT_RUNTIME_COMMAND}" (`,
      '    if "%%B"=="" exit /b 64',
      '    if not "%%C"=="" exit /b 64',
      `    ${gatewayCommand.replace("%2", "%%B")}`,
      '    set "external_exit=!ERRORLEVEL!"',
      "    exit /b !external_exit!",
      "  )",
      ")",
      `if /I "%~1"=="${WORKSPACE_EDIT_RUNTIME_COMMAND}" (`,
      '  if "%~2"=="" exit /b 64',
      '  if not "%~3"=="" exit /b 64',
      `  ${gatewayCommand}`,
      '  set "external_exit=!ERRORLEVEL!"',
      "  exit /b !external_exit!",
      ")",
    );
  }
  lines.push(regularCommand, "exit /b %ERRORLEVEL%", "");
  return lines.join("\r\n");
}

export function workspaceEditInvocation(command) {
  const normalized = normalizeShellCommand(command);
  const match = /^\/harness\/workspace-edit ([A-Za-z0-9_-]+)$/.exec(normalized);
  if (!match || /[;&|<>`$()]/.test(normalized)) return null;
  return { patch_base64url: match[1] };
}

export function validateToolchainShimSource(
  source,
  tool,
  toolchain = PINNED_WSL_TOOLCHAIN,
) {
  for (const expected of [
    "wsl.exe",
    `--distribution ${toolchain.distro}`,
    "/usr/bin/bwrap",
    "--unshare-user --unshare-pid --unshare-net",
    "--symlink usr/bin /bin",
    "--symlink usr/lib /lib",
    "--symlink usr/lib64 /lib64",
    "--symlink usr/sbin /sbin",
    `--ro-bind ${toolchain.root} /toolchain`,
    "--bind",
    "/workspace",
    "WSL_INTEROP /dev/null",
    "PATH /toolchain/bin:",
  ]) {
    if (!source.includes(expected)) {
      throw new Error(`toolchain shim for ${tool} is missing ${expected}`);
    }
  }
  const bindPattern =
    /(?:^|\s)--(?:ro-)?bind\s+("(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s+("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g;
  for (const match of source.matchAll(bindPattern)) {
    const bindPaths = match.slice(1).map((value) => {
      const quote = value[0];
      return (quote === '"' || quote === "'") && value.at(-1) === quote
        ? value.slice(1, -1)
        : value;
    });
    if (bindPaths.includes("/mnt/c")) {
      throw new Error(`toolchain shim for ${tool} exposes /mnt/c`);
    }
  }
}

const NODE_NETWORK_CANARY = [
  'const net = require("node:net");',
  `const socket = net.connect({host: "${NETWORK_CANARY_HOST}", port: ${NETWORK_CANARY_PORT}, timeout: 1500});`,
  'socket.on("connect", () => process.exit(91));',
  'socket.on("timeout", () => process.exit(0));',
  'socket.on("error", () => process.exit(0));',
].join("");
const PYTHON_NETWORK_CANARY = [
  "import socket,sys",
  "socket.setdefaulttimeout(1.5)",
  "s=socket.socket()",
  "try:",
  ` s.connect((\"${NETWORK_CANARY_HOST}\",${NETWORK_CANARY_PORT}));sys.exit(91)`,
  "except OSError:",
  " sys.exit(0)",
].join("\n");
const SHELL_NETWORK_CANARY = [
  'node -e "$1" || status=$?',
  'test "${status:-0}" -eq 0 || exit "${status}"',
].join("; ");
const INTEROP_CANARY = [
  "test ! -e /mnt/c",
  "test ! -e /home/d26fo",
  "test ! -x /mnt/c/Windows/System32/cmd.exe",
].join(" && ");

async function verifyNetworkNamespaceShims(shims, workspaceDir, env) {
  const canaries = [
    { name: "node", tool: "node", args: ["-e", NODE_NETWORK_CANARY] },
    {
      name: "python",
      tool: "python",
      args: ["-c", PYTHON_NETWORK_CANARY],
    },
    {
      name: "shell-wrapper",
      tool: "sh",
      args: ["-c", SHELL_NETWORK_CANARY, "network-canary", NODE_NETWORK_CANARY],
    },
    {
      name: "interop",
      tool: "sh",
      args: ["-c", INTEROP_CANARY],
    },
  ];
  const results = [];
  for (const canary of canaries) {
    const execution = await captureWindowsCommandShim(
      shims.files[canary.tool].path,
      canary.args,
      { cwd: workspaceDir, env, timeoutMs: 10_000 },
    );
    if (
      execution.exitCode !== 0 ||
      execution.timedOut ||
      execution.stdout.includes("NETWORK_REACHABLE")
    ) {
      const diagnostic = [
        `exit=${execution.exitCode}`,
        `timed_out=${execution.timedOut}`,
        `stdout=${JSON.stringify(execution.stdout.trim())}`,
        `stderr=${JSON.stringify(execution.stderr.trim())}`,
      ].join("; ");
      throw new Error(
        `${canary.name} network namespace canary failed closed; ${diagnostic}`,
      );
    }
    results.push({
      name: canary.name,
      status: "passed",
      exit_code: execution.exitCode,
      stdout_sha256: sha256(execution.stdout),
      stderr_sha256: sha256(execution.stderr),
      stderr_excerpt: execution.stderr.trim().slice(0, 1000),
    });
  }
  return {
    status: "passed",
    host: NETWORK_CANARY_HOST,
    port: NETWORK_CANARY_PORT,
    results,
  };
}

export async function probeFrozenSubjectRuntime({
  workspaceDir = process.cwd(),
  subjectDir,
  version,
  toolchain = PINNED_WSL_TOOLCHAIN,
} = {}) {
  if (!subjectDir) throw new Error("subjectDir is required");
  const root = await mkdtemp(resolve(tmpdir(), "external-subject-probe-"));
  try {
    const shims = await installToolchainShims(root, toolchain, {
      workspaceDir,
      subjectDir,
    });
    const env = isolatedBaseEnvironment(root);
    const specification =
      version === "v1"
        ? {
            tool: "sh",
            args: [
              `${SUBJECT_RUNTIME_ROOT}/references/scripts/scan-project.sh`,
              "--help",
            ],
            expected: /Usage: sh scan-project\.sh/,
          }
        : version === "v2"
          ? {
              tool: "node",
              args: [`${SUBJECT_RUNTIME_ROOT}/references/bin/kb.mjs`, "--help"],
              expected: /Usage: kb <command>/,
            }
          : null;
    if (!specification) throw new Error("version must be v1 or v2");
    const execution = await captureWindowsCommandShim(
      shims.files[specification.tool].path,
      specification.args,
      { cwd: workspaceDir, env, timeoutMs: 30_000 },
    );
    const writeProbe = await captureWindowsCommandShim(
      shims.files.sh.path,
      ["-c", `printf blocked > ${SUBJECT_RUNTIME_ROOT}/.external-write-probe`],
      { cwd: workspaceDir, env, timeoutMs: 10_000 },
    );
    const output = `${execution.stdout}\n${execution.stderr}`;
    return {
      status:
        execution.exitCode === 0 &&
        specification.expected.test(output) &&
        writeProbe.exitCode !== 0
          ? "passed"
          : "blocked",
      version,
      subject_sha256: (await snapshotSubject(subjectDir)).sha256,
      entrypoint_exit_code: execution.exitCode,
      entrypoint_stdout_sha256: sha256(execution.stdout),
      entrypoint_stderr_sha256: sha256(execution.stderr),
      entrypoint_output_matched: specification.expected.test(output),
      subject_write_exit_code: writeProbe.exitCode,
      subject_write_blocked: writeProbe.exitCode !== 0,
      subject_write_stdout_sha256: sha256(writeProbe.stdout),
      subject_write_stderr_sha256: sha256(writeProbe.stderr),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function installToolchainShims(
  root,
  toolchain = PINNED_WSL_TOOLCHAIN,
  { workspaceDir = process.cwd(), subjectDir = null } = {},
) {
  const shimDir = resolve(root, "toolchain-shims");
  await mkdir(shimDir, { recursive: true });
  const files = {};
  for (const tool of [
    "node",
    "npm",
    "npx",
    "sh",
    "bash",
    "python",
    "python3",
  ]) {
    const source = toolchainShimSource(tool, toolchain, {
      workspaceDir,
      subjectDir,
    });
    validateToolchainShimSource(source, tool, toolchain);
    const path = resolve(shimDir, `${tool}.cmd`);
    await writeFile(path, source, { encoding: "utf8", mode: 0o700 });
    files[tool] = { path, sha256: sha256(source) };
  }
  return {
    directory: shimDir,
    enforcement: TOOLCHAIN_SHIM_ENFORCEMENT,
    toolchain,
    files,
    sha256: sha256(
      stableJson(
        Object.fromEntries(
          Object.entries(files).map(([key, value]) => [key, value.sha256]),
        ),
      ),
    ),
  };
}

export async function probeAgentShellNetworkIsolation({
  workspaceDir = process.cwd(),
  toolchain = PINNED_WSL_TOOLCHAIN,
} = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "external-network-probe-"));
  try {
    const shims = await installToolchainShims(root, toolchain, {
      workspaceDir,
    });
    const env = isolatedBaseEnvironment(root, shims.directory);
    return await verifyNetworkNamespaceShims(shims, workspaceDir, env);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function isolatedEnvironment({
  model,
  skillDir,
  workspaceDir,
  outputDir,
  maxToolCalls,
  readOnly = false,
  allowedCommands = [],
  subjectSource = null,
  workspaceEdit = null,
  toolchain = PINNED_WSL_TOOLCHAIN,
  campaignRoot = null,
}) {
  const secrets = await sourceCredentials(model);
  const root = await mkdtemp(
    resolve(
      isolatedRuntimeParent({ campaignRoot, workspaceDir }),
      ".external-opencode-",
    ),
  );
  let completed = false;
  try {
    const subjectPath = subjectSource
      ? await copySubjectReadOnly(subjectSource, root)
      : skillDir;
    const subject = subjectPath ? await snapshotSubject(subjectPath) : null;
    const shims = await installToolchainShims(root, toolchain, {
      workspaceDir,
      subjectDir: subjectPath,
    });
    const env = isolatedBaseEnvironment(root, shims.directory);
    const receiptPath = resolve(root, "shell-wrapper.args.txt");
    const workspaceEditReceiptDir = workspaceEdit
      ? resolve(root, "workspace-edit-receipts")
      : null;
    const workspaceEditRuntimeDir = workspaceEdit
      ? resolve(root, "workspace-edit-runtime")
      : null;
    if (workspaceEditReceiptDir) {
      await mkdir(workspaceEditReceiptDir, { recursive: true });
    }
    if (workspaceEditRuntimeDir) {
      await mkdir(workspaceEditRuntimeDir, { recursive: true });
      const runtimeFiles = [
        [WORKSPACE_EDIT_RUNTIME_SOURCE, "workspace-edit.mjs"],
        [WORKSPACE_EDIT_CORE_SOURCE, "core.mjs"],
      ];
      for (const [source, name] of runtimeFiles) {
        const target = resolve(workspaceEditRuntimeDir, name);
        await cp(source, target, { preserveTimestamps: true });
        await chmod(target, 0o444);
      }
      const frozenRuntimeSha256 = sha256(
        JSON.stringify({
          "core.mjs": await fileSha256(
            resolve(workspaceEditRuntimeDir, "core.mjs"),
          ),
          "workspace-edit.mjs": await fileSha256(
            resolve(workspaceEditRuntimeDir, "workspace-edit.mjs"),
          ),
        }),
      );
      if (frozenRuntimeSha256 !== WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256) {
        throw new Error("workspace-edit runtime changed while freezing");
      }
    }
    const shellWrapperPath = resolve(root, "shell-wrapper.cmd");
    const shellWrapper = shellWrapperSource(
      {
        workspaceDir,
        subjectDir: subjectPath,
        receiptPath,
        workspaceEdit,
        workspaceEditSource: workspaceEditRuntimeDir
          ? resolve(workspaceEditRuntimeDir, "workspace-edit.mjs")
          : null,
        workspaceEditCoreSource: workspaceEditRuntimeDir
          ? resolve(workspaceEditRuntimeDir, "core.mjs")
          : null,
        workspaceEditReceiptDir,
      },
      toolchain,
    );
    await writeFile(shellWrapperPath, shellWrapper, {
      encoding: "utf8",
      mode: 0o700,
    });
    const runtimeInstructionsPath = resolve(root, "runtime-instructions.md");
    await writeFile(runtimeInstructionsPath, RUNTIME_INSTRUCTIONS_SOURCE, {
      encoding: "utf8",
      mode: 0o400,
    });
    await chmod(runtimeInstructionsPath, 0o400);
    const runtimeInstructionsSha256 = await fileSha256(runtimeInstructionsPath);
    const instructionsPath = resolve(workspaceDir, "AGENTS.md");
    const instructionsBefore = (await exists(instructionsPath))
      ? await fileSha256(instructionsPath)
      : null;
    const codexHome = await prepareDedicatedCodexHome({
      workspaceDir,
      runtimeRoot: root,
    });
    const confinement = {
      receiptRoot: resolve(root, "confinement-receipts"),
      launches: [],
      windowsCanary: null,
    };
    const credentials = {
      transport: CONFINEMENT_CONTRACT.credential_transport,
      content_env_absent: true,
      config_path_sha256: null,
      auth_path_sha256: null,
    };
    const networkCanaries = await verifyNetworkNamespaceShims(
      shims,
      workspaceDir,
      env,
    );
    const agentName = `external-${randomBytes(4).toString("hex")}`;
    const permissions = permissionConfig(subjectPath, {
      readOnly,
      allowedCommands,
    });
    const config = {
      $schema: "https://opencode.ai/config.json",
      autoupdate: false,
      provider: { [secrets.providerId]: secrets.provider },
      plugin: [],
      mcp: {},
      shell: resolve(shellWrapperPath),
      instructions: [
        runtimeInstructionsPath,
        ...((await exists(instructionsPath))
          ? [resolve(instructionsPath)]
          : []),
      ],
      skills: { paths: subjectPath ? [resolve(subjectPath)] : [], urls: [] },
      permission: permissions,
      agent: {
        [agentName]: {
          description: "Isolated external campaign agent",
          mode: "primary",
          steps: maxToolCalls,
          permission: permissions,
        },
      },
    };
    const configContent = stableJson(config);
    const effectiveConfigSha256 = sha256(configContent);
    await mkdir(resolve(root, "opencode-config"), { recursive: true });
    await mkdir(resolve(root, "data/opencode"), { recursive: true });
    await writeFile(
      resolve(root, "opencode-config/opencode.json"),
      configContent,
      { encoding: "utf8", mode: 0o600 },
    );
    if (Object.keys(secrets.auth).length > 0) {
      await writeFile(
        resolve(root, "data/opencode/auth.json"),
        stableJson(secrets.auth),
        { encoding: "utf8", mode: 0o600 },
      );
    }
    credentials.config_path_sha256 = await fileSha256(
      resolve(root, "opencode-config/opencode.json"),
    );
    credentials.auth_path_sha256 = (await exists(
      resolve(root, "data/opencode/auth.json"),
    ))
      ? await fileSha256(resolve(root, "data/opencode/auth.json"))
      : null;
    env.OPENCODE_CONFIG = resolve(root, "opencode-config/opencode.json");
    assertNoSecretEnvironment(env);
    validateResolvedConfig(config, {
      providerId: secrets.providerId,
      skillDir: subjectPath,
      readOnly,
      allowedCommands,
      shellPath: shellWrapperPath,
      instructionsPaths: [
        runtimeInstructionsPath,
        ...(instructionsBefore ? [instructionsPath] : []),
      ],
    });
    const runner = { env, codexHome, campaignRoot, confinement };
    const resolvedConfigProcess = await launchIsolated(
      runner,
      executable(),
      ["debug", "config", "--pure"],
      { cwd: workspaceDir, timeoutMs: 60_000 },
    );
    if (resolvedConfigProcess.exitCode !== 0) {
      throw new Error(
        `OpenCode effective-config probe failed: ${resolvedConfigProcess.stderr.trim()}`,
      );
    }
    const resolvedConfig = JSON.parse(resolvedConfigProcess.stdout);
    validateResolvedConfig(resolvedConfig, {
      providerId: secrets.providerId,
      skillDir: subjectPath,
      readOnly,
      allowedCommands,
      shellPath: shellWrapperPath,
      instructionsPaths: [
        runtimeInstructionsPath,
        ...(instructionsBefore ? [instructionsPath] : []),
      ],
    });
    const skillProcess = await launchIsolated(
      runner,
      executable(),
      ["debug", "skill", "--pure"],
      { cwd: workspaceDir, timeoutMs: 60_000 },
    );
    if (skillProcess.exitCode !== 0) {
      throw new Error(
        `OpenCode skill discovery probe failed: ${skillProcess.stderr.trim()}`,
      );
    }
    const discoveredSkills = JSON.parse(skillProcess.stdout);
    const selfEvolutionSkills = discoveredSkills.filter(
      (item) => item?.name === "self-evolution",
    );
    const loadedSkillPath = subjectPath
      ? (selfEvolutionSkills
          .map((item) => item.location)
          .find(
            (location) =>
              typeof location === "string" &&
              resolve(location) === resolve(subjectPath, "SKILL.md"),
          ) ?? null)
      : null;
    if (subjectPath && !loadedSkillPath) {
      throw new Error("OpenCode did not discover the frozen arm skill");
    }
    const skillLoad = {
      status: subjectPath ? "passed" : "not-applicable",
      loaded_skill_path: loadedSkillPath,
      subject_sha256: subject?.sha256 ?? null,
      loaded_skill_path_matches_subject: subjectPath
        ? resolve(loadedSkillPath) === resolve(subjectPath, "SKILL.md")
        : null,
      discovered_self_evolution_count: selfEvolutionSkills.length,
      probe_sha256: sha256(skillProcess.stdout),
    };
    const effectiveConfig = {
      sha256: effectiveConfigSha256,
      resolved_probe_sha256: sha256(resolvedConfigProcess.stdout),
      disk_and_environment_identical: true,
    };
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      await writeJson(resolve(outputDir, "isolation.json"), {
        schema_version: "1.0",
        provider_id: secrets.providerId,
        model,
        provider_keys: secrets.source.provider_keys,
        provider_options_keys: secrets.source.provider_options_keys,
        auth_present: secrets.source.auth_present,
        auth_type: secrets.source.auth_type,
        config_summary: {
          provider_ids: Object.keys(config.provider ?? {}),
          plugin_count: config.plugin.length,
          mcp_count: Object.keys(config.mcp).length,
          skill_paths: config.skills.paths,
          read_only: readOnly,
          allowed_bash_patterns: allowedCommands,
        },
        subject,
        skill_load: skillLoad,
        effective_config: effectiveConfig,
        randomness: {
          seed_support: "not-supported",
          seed: "not-measured",
          variant: null,
        },
        assurance: {
          network_enforcement: NETWORK_ENFORCEMENT,
          network_namespace: NETWORK_NAMESPACE,
          network_canaries: NETWORK_CANARIES,
          filesystem_trace_kind: "opencode-tool-event-derived",
          filesystem_audit: "not-syscall-audit",
          child_sessions: "denied",
          filesystem_enforcement: FILESYSTEM_ENFORCEMENT,
          windows_confinement: WINDOWS_CONFINEMENT,
        },
        network_namespace_canaries: networkCanaries,
        toolchain_shims: {
          enforcement: shims.enforcement,
          toolchain: shims.toolchain,
          sha256: shims.sha256,
          files: Object.fromEntries(
            Object.entries(shims.files).map(([name, item]) => [
              name,
              { sha256: item.sha256 },
            ]),
          ),
        },
        environment: {
          ...ISOLATION_FLAGS,
          HOME: "<isolated>",
          USERPROFILE: "<isolated>",
          XDG_CONFIG_HOME: "<isolated>",
          XDG_DATA_HOME: "<isolated>",
          XDG_CACHE_HOME: "<isolated>",
          XDG_STATE_HOME: "<isolated>",
        },
        credentials,
        instructions: {
          path: "AGENTS.md",
          status: instructionsBefore
            ? "present"
            : "not-present-before-onboarding",
          sha256: instructionsBefore,
          runtime_path: "runtime-instructions.md",
          runtime_status: "present-read-only",
          runtime_sha256: runtimeInstructionsSha256,
        },
        shell_wrapper: {
          enforcement: TOOLCHAIN_SHIM_ENFORCEMENT,
          path_sha256: sha256(shellWrapper),
          receipt_path: "shell-wrapper.args.txt",
          receipt_sha256: (await exists(receiptPath))
            ? await fileSha256(receiptPath)
            : null,
          workspace_edit_runtime_sha256: workspaceEdit
            ? WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256
            : null,
        },
        restricted_token: {
          status: process.platform === "win32" ? "enforced" : "not-applicable",
          profile: CODEX_SANDBOX_PROFILE,
          setup_version: codexHome.setup_version,
          config_sha256: codexHome.config_sha256,
        },
        confinement: {
          acl_launches: confinement.launches,
          windows_canary: confinement.windowsCanary,
        },
      });
    }
    const value = {
      env,
      agentName,
      root,
      providerId: secrets.providerId,
      subjectPath,
      subject,
      skillLoad,
      effectiveConfig,
      shims,
      networkCanaries,
      codexHome,
      credentials,
      instructions: {
        path: "AGENTS.md",
        status: instructionsBefore
          ? "present"
          : "not-present-before-onboarding",
        sha256: instructionsBefore,
        runtime_path: "runtime-instructions.md",
        runtime_status: "present-read-only",
        runtime_sha256: runtimeInstructionsSha256,
      },
      shellWrapper: {
        path: shellWrapperPath,
        sha256: sha256(shellWrapper),
        receiptPath,
      },
      workspaceEdit: workspaceEdit
        ? {
            receiptDir: workspaceEditReceiptDir,
            outputReceiptDir: workspaceEdit.receipt_dir,
            command: workspaceEdit.command,
            runtimeSha256: WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256,
          }
        : null,
      campaignRoot,
      confinement,
      async cleanup() {
        await rm(root, { recursive: true, force: true });
      },
    };
    completed = true;
    return value;
  } finally {
    if (!completed) await rm(root, { recursive: true, force: true });
  }
}

globalThis.__SELF_EVOLUTION_EXTERNAL_ENVIRONMENT__ = isolatedEnvironment;

export async function prepareExecutionEnvironment({
  config,
  skillDir,
  workspaceDir,
  campaignRoot = null,
  outputDir = null,
}) {
  const version = await captureProcess(executable(), ["--version"], {
    cwd: workspaceDir,
    env: process.env,
    timeoutMs: 30_000,
  });
  const actual = version.stdout.trim();
  if (version.exitCode !== 0 || actual !== config.opencode_version) {
    throw new Error(
      `OpenCode ${config.opencode_version} required; found ${actual || "unavailable"}`,
    );
  }
  const probe = await isolatedEnvironment({
    model: config.execution_model,
    skillDir: null,
    subjectSource: skillDir,
    workspaceEdit: {
      command: WORKSPACE_EDIT_RUNTIME_COMMAND,
      phase: "onboarding",
      receipt_dir: resolve(
        outputDir ?? workspaceDir,
        "environment-workspace-edit-receipts",
      ),
    },
    workspaceDir,
    outputDir: null,
    maxToolCalls: 1,
    campaignRoot,
  });
  let executionCanaries;
  let toolchainShimEnforcement;
  let executionConfinement;
  let executionCredentials;
  let executionInstructions;
  let executionShellWrapper;
  let executionWorkspaceEditRuntimeSha256;
  let executionRestrictedToken;
  let workspaceEditGateway;
  try {
    executionCanaries = probe.networkCanaries;
    toolchainShimEnforcement = probe.shims.enforcement;
    executionConfinement = probe.confinement;
    executionCredentials = probe.credentials;
    executionInstructions = probe.instructions;
    executionShellWrapper = probe.shellWrapper;
    executionWorkspaceEditRuntimeSha256 = probe.workspaceEdit?.runtimeSha256;
    executionRestrictedToken = {
      status: process.platform === "win32" ? "enforced" : "not-applicable",
      profile: CODEX_SANDBOX_PROFILE,
      setup_version: probe.codexHome.setup_version,
      config_sha256: probe.codexHome.config_sha256,
    };
    workspaceEditGateway = await verifyWorkspaceEditGateway(
      probe,
      workspaceDir,
    );
  } finally {
    await probe.cleanup();
  }
  const reviewerProbe = await isolatedEnvironment({
    model: config.review_model,
    skillDir: null,
    workspaceDir,
    outputDir: null,
    maxToolCalls: 1,
    readOnly: true,
    campaignRoot,
  });
  let reviewCanaries;
  let reviewConfinement;
  let reviewCredentials;
  let reviewRestrictedToken;
  try {
    reviewCanaries = reviewerProbe.networkCanaries;
    reviewConfinement = reviewerProbe.confinement;
    reviewCredentials = reviewerProbe.credentials;
    reviewRestrictedToken = {
      status: process.platform === "win32" ? "enforced" : "not-applicable",
      profile: CODEX_SANDBOX_PROFILE,
      setup_version: reviewerProbe.codexHome.setup_version,
      config_sha256: reviewerProbe.codexHome.config_sha256,
    };
  } finally {
    await reviewerProbe.cleanup();
  }
  const value = {
    opencode_version: actual,
    execution_model: config.execution_model,
    review_model: config.review_model,
    isolation_flags: ISOLATION_FLAGS,
    randomness: {
      seed_support: "not-supported",
      seed: "not-measured",
      variant: null,
    },
    assurance: {
      network_enforcement: NETWORK_ENFORCEMENT,
      network_namespace: NETWORK_NAMESPACE,
      network_canaries: NETWORK_CANARIES,
      filesystem_trace_kind: "opencode-tool-event-derived",
      filesystem_audit: "not-syscall-audit",
      child_sessions: "denied",
      filesystem_enforcement: FILESYSTEM_ENFORCEMENT,
      windows_confinement: WINDOWS_CONFINEMENT,
      codex_sandbox_profile: CODEX_SANDBOX_PROFILE,
      toolchain_shim_enforcement: TOOLCHAIN_SHIM_ENFORCEMENT,
    },
    network_namespace_canaries: {
      execution: executionCanaries,
      review: reviewCanaries,
    },
    toolchain_shim_enforcement: toolchainShimEnforcement,
    toolchain: PINNED_WSL_TOOLCHAIN,
    confinement: {
      execution: {
        restricted_token: executionRestrictedToken,
        coordinator_acl: executionConfinement.launches,
        windows_canary: executionConfinement.windowsCanary,
      },
      review: {
        restricted_token: reviewRestrictedToken,
        coordinator_acl: reviewConfinement.launches,
        windows_canary: reviewConfinement.windowsCanary,
      },
    },
    credentials: {
      execution: executionCredentials,
      review: reviewCredentials,
    },
    instructions: {
      path: "AGENTS.md",
      status: executionInstructions.status,
      sha256: executionInstructions.sha256,
      runtime_path: "runtime-instructions.md",
      runtime_status: executionInstructions.runtime_status,
      runtime_sha256: executionInstructions.runtime_sha256,
    },
    shell_wrapper: {
      enforcement: TOOLCHAIN_SHIM_ENFORCEMENT,
      path_sha256: executionShellWrapper.sha256,
      receipt_status: (await exists(executionShellWrapper.receiptPath))
        ? "present"
        : "not-exercised-by-config-probe",
      receipt_sha256: (await exists(executionShellWrapper.receiptPath))
        ? await fileSha256(executionShellWrapper.receiptPath)
        : null,
      workspace_edit_runtime_sha256:
        executionWorkspaceEditRuntimeSha256 ?? null,
    },
    workspace_edit_gateway: workspaceEditGateway,
  };
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await writeJson(resolve(outputDir, "environment.json"), value);
  }
  return value;
}

export async function smokeModels({
  config,
  skillDir,
  workspaceDir,
  outputDir,
  campaignRoot = null,
}) {
  await mkdir(outputDir, { recursive: true });
  const specifications = [
    {
      role: "execution",
      model: config.execution_model,
      skillDir,
      readOnly: false,
    },
    {
      role: "review",
      model: config.review_model,
      skillDir: null,
      readOnly: true,
    },
  ];
  const results = [];
  for (const specification of specifications) {
    const roleRoot = resolve(outputDir, specification.role);
    await mkdir(roleRoot, { recursive: true });
    const isolated = await isolatedEnvironment({
      model: specification.model,
      skillDir: null,
      subjectSource: specification.skillDir,
      workspaceDir,
      outputDir: roleRoot,
      maxToolCalls: 1,
      readOnly: specification.readOnly,
      campaignRoot,
    });
    try {
      const execution = await launchIsolated(
        isolated,
        executable(),
        [
          "run",
          "Reply with exactly SMOKE_OK and do not call any tool.",
          "--model",
          specification.model,
          "--format",
          "json",
          "--pure",
          "--agent",
          isolated.agentName,
          "--dir",
          workspaceDir,
        ],
        {
          cwd: workspaceDir,
          timeoutMs: config.smoke?.timeout_ms ?? 120_000,
        },
      );
      await writeFile(
        resolve(roleRoot, "opencode.jsonl"),
        execution.stdout,
        "utf8",
      );
      await writeFile(
        resolve(roleRoot, "stderr.txt"),
        execution.stderr,
        "utf8",
      );
      const parsed = parsedExecution(execution.stdout);
      const succeeded =
        smokeSucceeded(execution, parsed) &&
        parsed.toolCalls === 0 &&
        parsed.final.trim() === "SMOKE_OK";
      const result = {
        role: specification.role,
        model: specification.model,
        status: succeeded ? "passed" : "blocked",
        exit_code: execution.exitCode,
        timed_out: execution.timedOut,
        response_usage: parsed.usage,
        response_count: parsed.usage.length,
        tool_calls: parsed.toolCalls,
        provider_error_count: parsed.errors.length,
        final_sha256:
          typeof parsed.final === "string" ? sha256(parsed.final) : null,
      };
      await writeJson(resolve(roleRoot, "smoke.json"), result);
      results.push(result);
    } finally {
      await isolated.cleanup();
    }
  }
  const v2Root = dirname(dirname(skillDir));
  const skillSpecifications = [
    {
      version: "v1",
      path: resolve(v2Root, "v1/self-evolution"),
      command: [
        "sh",
        `${SUBJECT_RUNTIME_ROOT}/references/scripts/scan-project.sh`,
        "--help",
      ],
      expected: /Usage: sh scan-project\.sh/,
    },
    {
      version: "v2",
      path: skillDir,
      command: [
        "node",
        `${SUBJECT_RUNTIME_ROOT}/references/bin/kb.mjs`,
        "--help",
      ],
      expected: /Usage: kb <command>/,
    },
  ];
  const skillLoadProbes = [];
  for (const specification of skillSpecifications) {
    const isolated = await isolatedEnvironment({
      model: config.execution_model,
      skillDir: null,
      subjectSource: specification.path,
      workspaceDir,
      outputDir: null,
      maxToolCalls: 1,
      campaignRoot,
    });
    try {
      const entrypointExecution = await captureWindowsCommandShim(
        isolated.shims.files[specification.command[0]].path,
        specification.command.slice(1),
        { cwd: workspaceDir, env: isolated.env, timeoutMs: 30_000 },
      );
      const writeProbe = await captureWindowsCommandShim(
        isolated.shims.files.sh.path,
        [
          "-c",
          `printf blocked > ${SUBJECT_RUNTIME_ROOT}/.external-write-probe`,
        ],
        { cwd: workspaceDir, env: isolated.env, timeoutMs: 10_000 },
      );
      const entrypointPassed =
        entrypointExecution.exitCode === 0 &&
        specification.expected.test(
          `${entrypointExecution.stdout}\n${entrypointExecution.stderr}`,
        );
      const subjectWriteBlocked = writeProbe.exitCode !== 0;
      skillLoadProbes.push({
        version: specification.version,
        status:
          isolated.skillLoad.status === "passed" &&
          entrypointPassed &&
          subjectWriteBlocked
            ? "passed"
            : "blocked",
        loaded_skill_path: isolated.skillLoad.loaded_skill_path,
        subject_sha256: isolated.subject?.sha256 ?? null,
        effective_config_sha256: isolated.effectiveConfig.sha256,
        effective_config_probe_sha256:
          isolated.effectiveConfig.resolved_probe_sha256,
        probe_sha256: isolated.skillLoad.probe_sha256,
        runtime_path: SUBJECT_RUNTIME_ROOT,
        runtime_status: entrypointPassed ? "readable" : "entrypoint-failed",
        runtime_sha256: isolated.subject?.sha256 ?? null,
        entrypoint: specification.command.join(" "),
        entrypoint_status: entrypointPassed ? "passed" : "failed",
        entrypoint_stdout_sha256: sha256(entrypointExecution.stdout),
        entrypoint_stderr_sha256: sha256(entrypointExecution.stderr),
        subject_write_status: subjectWriteBlocked ? "blocked" : "writable",
        subject_write_stdout_sha256: sha256(writeProbe.stdout),
        subject_write_stderr_sha256: sha256(writeProbe.stderr),
      });
    } finally {
      await isolated.cleanup();
    }
  }
  const summary = {
    schema_version: "1.0",
    status:
      results.every((result) => result.status === "passed") &&
      skillLoadProbes.every((probe) => probe.status === "passed")
        ? "passed"
        : "blocked",
    results,
    skill_load_probes: skillLoadProbes,
    randomness: {
      seed_support: "not-supported",
      seed: "not-measured",
      variant: null,
    },
  };
  await writeJson(resolve(outputDir, "smoke.json"), summary);
  if (summary.status !== "passed") {
    throw new Error(
      "execution/review model smoke, per-response usage, or arm skill-load probe failed",
    );
  }
  return summary;
}

function sessionExportJson(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error("OpenCode export did not return JSON");
  return JSON.parse(stdout.slice(start));
}

async function snapshotSubject(skillDir) {
  const value = await hashTree(skillDir, { exclude: [/^\.git(?:\/|$)/] });
  return { root: resolve(skillDir), sha256: value.sha256 };
}

async function copySubjectReadOnly(skillDir, isolatedRoot) {
  if (!skillDir) return null;
  const target = resolve(isolatedRoot, "subject/self-evolution");
  await mkdir(dirname(target), { recursive: true });
  await cp(skillDir, target, { recursive: true, preserveTimestamps: true });
  const makeReadOnly = async (path) => {
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      const { readdir } = await import("node:fs/promises");
      for (const entry of await readdir(path)) {
        await makeReadOnly(resolve(path, entry));
      }
      return;
    }
    const { chmod } = await import("node:fs/promises");
    await chmod(path, 0o444);
  };
  await makeReadOnly(target);
  return target;
}

async function copyWorkspaceEditReceipts(workspaceEdit) {
  if (!workspaceEdit?.receiptDir || !workspaceEdit.outputReceiptDir) return;
  if (!(await exists(workspaceEdit.receiptDir))) return;
  await mkdir(workspaceEdit.outputReceiptDir, { recursive: true });
  for (const entry of await readdir(workspaceEdit.receiptDir, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
    const source = resolve(workspaceEdit.receiptDir, entry.name);
    const target = resolve(workspaceEdit.outputReceiptDir, entry.name);
    if (await exists(target)) {
      if ((await fileSha256(source)) !== (await fileSha256(target))) {
        throw new Error(`workspace-edit receipt conflict: ${entry.name}`);
      }
      continue;
    }
    await cp(source, target, { force: false, errorOnExist: true });
  }
}

async function verifyWorkspaceEditGateway(isolated, workspaceDir) {
  if (!isolated.workspaceEdit) {
    throw new Error("workspace-edit gateway probe requires a bound runtime");
  }
  const smoke = workspaceEditSmokePatch();
  const target = resolve(workspaceDir, smoke.path);
  const parent = dirname(target);
  const parentExisted = await exists(parent);
  await mkdir(parent, { recursive: true });
  if (await exists(target)) {
    throw new Error(
      `workspace-edit gateway probe target already exists: ${smoke.path}`,
    );
  }
  const token = Buffer.from(smoke.patch).toString("base64url");
  const execution = await launchIsolated(
    isolated,
    isolated.shellWrapper.path,
    [WORKSPACE_EDIT_RUNTIME_COMMAND, token],
    { cwd: workspaceDir, timeoutMs: 30_000 },
  );
  try {
    if (execution.exitCode !== 0 || execution.timedOut) {
      throw new Error(
        `workspace-edit gateway probe failed: ${execution.stderr.trim()}`,
      );
    }
    if (!(await exists(target))) {
      throw new Error(
        `workspace-edit gateway probe did not modify the workspace (exit ${execution.exitCode}, timed_out=${execution.timedOut === true}); stdout=${JSON.stringify(execution.stdout.trim())}; stderr=${JSON.stringify(execution.stderr.trim())}`,
      );
    }
    const receiptFiles = (
      await readdir(isolated.workspaceEdit.receiptDir, {
        withFileTypes: true,
      })
    ).filter(
      (entry) => entry.isFile() && /^[0-9a-f]{64}\.json$/.test(entry.name),
    );
    if (receiptFiles.length !== 1) {
      throw new Error(
        "workspace-edit gateway probe did not produce one receipt",
      );
    }
    return {
      status: "passed",
      runtime_sha256: isolated.workspaceEdit.runtimeSha256,
      command_sha256: sha256(WORKSPACE_EDIT_RUNTIME_COMMAND),
      patch_sha256: sha256(Buffer.from(smoke.patch)),
      receipt_sha256: await fileSha256(
        resolve(isolated.workspaceEdit.receiptDir, receiptFiles[0].name),
      ),
      stdout_sha256: sha256(execution.stdout),
      stderr_sha256: sha256(execution.stderr),
    };
  } finally {
    await rm(target, { force: true });
    if (!parentExisted) await rmdir(parent).catch(() => {});
    await rm(isolated.workspaceEdit.receiptDir, {
      recursive: true,
      force: true,
    });
    await mkdir(isolated.workspaceEdit.receiptDir, { recursive: true });
  }
}

export async function runPhase({
  campaign,
  unit,
  task,
  phase,
  workspaceDir,
  skillDir,
  outputDir,
  prompt,
  workspaceEdit = null,
  campaignRoot = null,
  expectedWorkspacePreManifestSha256 = null,
}) {
  await mkdir(outputDir, { recursive: true });
  const workspacePre = await writeWorkspaceManifest(
    resolve(outputDir, "workspace.pre.json"),
    workspaceDir,
  );
  if (
    expectedWorkspacePreManifestSha256 &&
    workspacePre.manifest.manifest_sha256 !== expectedWorkspacePreManifestSha256
  ) {
    throw new Error(
      "repair workspace pre-manifest does not match onboarding post-manifest",
    );
  }
  const policy = campaign[phase] ?? {};
  const maxToolCalls =
    policy.max_tool_calls ?? (phase === "onboarding" ? 90 : 60);
  const timeoutMs = policy.timeout_ms ?? 45 * 60 * 1000;
  const subjectBefore = await snapshotSubject(skillDir);
  const allowedCommands = phaseAllowedCommands(task, phase);
  let isolated;
  try {
    isolated = await isolatedEnvironment({
      model: campaign.execution_model,
      skillDir: null,
      subjectSource: skillDir,
      workspaceEdit,
      workspaceDir,
      outputDir,
      maxToolCalls,
      allowedCommands,
      toolchain: campaign.toolchain ?? PINNED_WSL_TOOLCHAIN,
      campaignRoot,
    });
  } catch (error) {
    await rm(resolve(outputDir, "workspace.pre.json"), { force: true });
    throw error;
  }
  const subjectCopy = isolated.subjectPath;
  const subjectCopyBefore = await snapshotSubject(subjectCopy);
  const shellWrapperCanary = isolated.networkCanaries?.results?.find(
    (item) => item.name === "shell-wrapper",
  );
  if (shellWrapperCanary?.status !== "passed") {
    throw new Error("shell-wrapper network canary did not pass");
  }
  if (
    isolated.workspaceEdit?.runtimeSha256 !==
    campaign.workspace_edit_runtime_sha256
  ) {
    throw new Error("workspace-edit runtime binding mismatch");
  }
  const preKnowledge = await collectKnowledgeSnapshot(workspaceDir, {
    includeContent: true,
  });
  await writeJson(resolve(outputDir, "knowledge.pre.json"), preKnowledge);
  await writeFile(resolve(outputDir, "prompt.txt"), prompt, "utf8");
  const startedAt = new Date();
  let execution;
  try {
    execution = await launchIsolated(
      isolated,
      executable(),
      [
        "run",
        prompt,
        "--model",
        campaign.execution_model,
        "--format",
        "json",
        "--pure",
        "--agent",
        isolated.agentName,
        "--dir",
        workspaceDir,
      ],
      {
        cwd: workspaceDir,
        timeoutMs,
        onStdoutLine: (line) =>
          livePolicyViolation(line, workspaceDir, allowedCommands),
      },
    );
    const finishedAt = new Date();
    await copyWorkspaceEditReceipts(isolated.workspaceEdit);
    await writeFile(
      resolve(outputDir, "opencode.jsonl"),
      execution.stdout,
      "utf8",
    );
    await writeFile(resolve(outputDir, "stderr.txt"), execution.stderr, "utf8");
    const parsed = parseOpenCodeJsonl(execution.stdout);
    let exported = null;
    if (parsed.session_id) {
      const exportedProcess = await launchIsolated(
        isolated,
        executable(),
        ["export", parsed.session_id, "--pure"],
        { cwd: workspaceDir, timeoutMs: 60_000 },
      );
      if (exportedProcess.exitCode === 0) {
        exported = sessionExportJson(exportedProcess.stdout);
        await writeJson(resolve(outputDir, "session.export.json"), exported);
      }
    }
    const combined = parsedExecution(execution.stdout, exported);
    const final = combined.final;
    const errors = combined.errors;
    const toolCalls = combined.toolCalls;
    const violations = policyViolations(
      combined,
      workspaceDir,
      allowedCommands,
    );
    if (execution.policyTermination === "path-escape")
      violations.pathEscape = true;
    if (execution.policyTermination === "forbidden-network-command")
      violations.network = true;
    const malformedJsonl =
      execution.policyTermination === "malformed-jsonl" ||
      combined.stream.parse_errors.length > 0;
    const childSessionDetected =
      execution.policyTermination === "child-session" ||
      combined.policy.tools.some((tool) =>
        ["task", "subagent", "agent"].includes(
          String(tool.tool ?? "").toLowerCase(),
        ),
      );
    const subjectAfter = await snapshotSubject(skillDir);
    const subjectCopyAfter = await snapshotSubject(subjectCopy);
    const subjectUnchanged =
      subjectBefore.sha256 === subjectAfter.sha256 &&
      subjectCopyBefore.sha256 === subjectCopyAfter.sha256;
    const providerSucceeded =
      errors.length === 0 &&
      typeof final === "string" &&
      final.trim().length > 0 &&
      combined.usage.length > 0;
    const transport = {
      policy: "pre-response-and-pre-tool-only",
      response_count: combined.usage.length,
      tool_calls: toolCalls,
      model_started: combined.usage.length > 0 || toolCalls > 0,
      runner_retry_attempted: false,
      retry_eligible: combined.usage.length === 0 && toolCalls === 0,
    };
    const result = {
      schema_version: "1.0",
      campaign_id: campaign.campaign_id,
      task_id: unit.task_id,
      attempt: unit.attempt,
      blind_label: unit.blind_label,
      phase,
      model: campaign.execution_model,
      status:
        execution.timedOut ||
        toolCalls > maxToolCalls ||
        !providerSucceeded ||
        violations.pathEscape ||
        violations.network ||
        malformedJsonl ||
        childSessionDetected ||
        !subjectUnchanged ||
        execution.exitCode !== 0
          ? "failed"
          : "completed",
      exit_code:
        execution.timedOut ||
        toolCalls > maxToolCalls ||
        !providerSucceeded ||
        violations.pathEscape ||
        violations.network ||
        malformedJsonl ||
        childSessionDetected ||
        !subjectUnchanged
          ? 1
          : execution.exitCode,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      timed_out: execution.timedOut,
      tool_budget: maxToolCalls,
      tool_calls: toolCalls,
      tool_budget_exceeded: toolCalls > maxToolCalls,
      allowed_commands: allowedCommands,
      session_id: combined.archive?.session_id ?? parsed.session_id,
      usage_status: combined.usage.length > 0 ? "measured" : "not-measured",
      usage: combined.usage,
      final,
      provider_error_count: errors.length,
      path_escape_detected: violations.pathEscape,
      network_violation_detected: violations.network,
      parse_errors: combined.stream.parse_errors,
      child_session_detected: childSessionDetected,
      termination_reason: violations.pathEscape
        ? "path-escape"
        : violations.network
          ? "forbidden-network-command"
          : malformedJsonl
            ? "malformed-jsonl"
            : childSessionDetected
              ? "child-session"
              : !subjectUnchanged
                ? "subject-mutated"
                : null,
      subject: {
        original_before_sha256: subjectBefore.sha256,
        original_after_sha256: subjectAfter.sha256,
        copy_before_sha256: subjectCopyBefore.sha256,
        copy_after_sha256: subjectCopyAfter.sha256,
        unchanged: subjectUnchanged,
      },
      skill_load: isolated.skillLoad,
      effective_config: isolated.effectiveConfig,
      randomness: {
        seed_support: "not-supported",
        seed: "not-measured",
        variant: null,
      },
      transport,
      assurance: {
        network_enforcement: NETWORK_ENFORCEMENT,
        network_namespace: NETWORK_NAMESPACE,
        network_canaries: NETWORK_CANARIES,
        filesystem_trace_kind: "opencode-tool-event-derived",
        workspace_state: "pre-post-byte-manifest",
        workspace_event_trace: "opencode-tool-event-derived",
        filesystem_audit: "not-syscall-audit",
        child_sessions: "denied",
        filesystem_enforcement: FILESYSTEM_ENFORCEMENT,
        windows_confinement: WINDOWS_CONFINEMENT,
        toolchain_shim_enforcement: TOOLCHAIN_SHIM_ENFORCEMENT,
      },
      toolchain_shims: {
        enforcement: isolated.shims.enforcement,
        toolchain: isolated.shims.toolchain,
        sha256: isolated.shims.sha256,
      },
      knowledge_pre_snapshot: "knowledge.pre.json",
      workspace_pre_manifest: {
        path: "workspace.pre.json",
        artifact_sha256: workspacePre.artifact_sha256,
        manifest_sha256: workspacePre.manifest.manifest_sha256,
        file_count: workspacePre.manifest.file_count,
        total_bytes: workspacePre.manifest.total_bytes,
      },
      session_chain: expectedWorkspacePreManifestSha256
        ? {
            status:
              workspacePre.manifest.manifest_sha256 ===
              expectedWorkspacePreManifestSha256
                ? "matched"
                : "mismatch",
            expected_pre_manifest_sha256: expectedWorkspacePreManifestSha256,
            actual_pre_manifest_sha256: workspacePre.manifest.manifest_sha256,
          }
        : { status: "not-applicable" },
      stdout_sha256: sha256(execution.stdout),
      stderr_sha256: sha256(execution.stderr),
      isolation: "isolation.json",
      credentials: isolated.credentials,
      instructions: isolated.instructions,
      shell_wrapper: {
        enforcement: TOOLCHAIN_SHIM_ENFORCEMENT,
        canary_status: shellWrapperCanary.status,
        path_sha256: isolated.shellWrapper.sha256,
        receipt_sha256: (await exists(isolated.shellWrapper.receiptPath))
          ? await fileSha256(isolated.shellWrapper.receiptPath)
          : null,
        workspace_edit_runtime_sha256:
          isolated.workspaceEdit?.runtimeSha256 ?? null,
      },
      confinement: {
        restricted_token: {
          status: process.platform === "win32" ? "enforced" : "not-applicable",
          profile: CODEX_SANDBOX_PROFILE,
          setup_version: isolated.codexHome.setup_version,
          config_sha256: isolated.codexHome.config_sha256,
        },
        coordinator_acl: isolated.confinement.launches,
        windows_canary: isolated.confinement.windowsCanary,
      },
    };
    await writeJson(resolve(outputDir, "result.json"), result);
    return result;
  } finally {
    let copyError = null;
    try {
      await copyWorkspaceEditReceipts(isolated.workspaceEdit);
    } catch (error) {
      copyError = error;
      await writeJson(resolve(outputDir, "receipt-copy-failure.json"), {
        schema_version: "1.0",
        reason: "workspace-edit-receipt-copy-failed",
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    }
    await isolated.cleanup();
    if (copyError) throw copyError;
  }
}
