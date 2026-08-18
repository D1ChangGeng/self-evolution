import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  delimiter as pathDelimiter,
  dirname,
  extname,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { tmpdir } from "node:os";

import { fileSha256, stableJson, writeJson } from "./core.mjs";

export const CODEX_SANDBOX_PROFILE = "external-opencode";
export const CODEX_SETUP_VERSION = 5;
export const WINDOWS_CONFINEMENT =
  "codex-windows-restricted-token+reversible-coordinator-acl";
export const EXECUTION_ROOT_ENV = "SELF_EVOLUTION_EXTERNAL_EXECUTION_ROOT";
export const CONFINEMENT_CONTRACT = Object.freeze({
  restricted_token: "codex-windows-restricted-token",
  coordinator_acl: "reversible-deny-codex-sandbox-users",
  windows_canaries: "workspace-write+sealed-absolute+dotnet+junction",
  credential_transport: "isolated-disk-only",
});

const DEFAULT_EXECUTION_ROOT = resolve("D:/Chatgpt/self-evolution-execution");
const FORBIDDEN_CAMPAIGN_DIRECTORIES = Object.freeze([
  "contracts",
  "prepared",
  "sealed",
  "subjects",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function childPath(parent, child) {
  const parentPath = resolve(parent);
  const childValue = resolve(child);
  if (
    parse(parentPath).root.toLowerCase() !==
    parse(childValue).root.toLowerCase()
  ) {
    return false;
  }
  const value = relative(parentPath, childValue);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

function assertSeparated(path, campaignRoot, name) {
  if (childPath(campaignRoot, path) || childPath(path, campaignRoot)) {
    throw new Error(
      `${name} must not share an ancestor with the campaign tree`,
    );
  }
}

function tomlQuote(value) {
  return JSON.stringify(String(value));
}

function launchableFile(path, platform) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.F_OK | fsConstants.X_OK);
  } catch {
    return false;
  }
  if (platform !== "win32") return true;
  return extname(path).toLowerCase() === ".exe";
}

function pathEntries(env, platform) {
  return String(env.PATH ?? "")
    .split(platform === "win32" ? ";" : pathDelimiter)
    .filter(Boolean);
}

function resolveOnPath(
  name,
  { env = process.env, platform = process.platform } = {},
) {
  const pathEntriesValue = pathEntries(env, platform);
  const candidates = platform === "win32" ? [`${name}.exe`] : [name];
  for (const entry of pathEntriesValue) {
    if (!entry) continue;
    for (const candidate of candidates) {
      const absolute = resolve(entry, candidate);
      if (launchableFile(absolute, platform)) return absolute;
    }
  }
  return null;
}

function resolveCodexVendorBinary(entry, { platform, arch }) {
  if (platform !== "win32") return null;
  const windowsTarget = {
    x64: {
      packageName: "codex-win32-x64",
      triple: "x86_64-pc-windows-msvc",
    },
    arm64: {
      packageName: "codex-win32-arm64",
      triple: "aarch64-pc-windows-msvc",
    },
  }[arch];
  if (!windowsTarget) return null;
  const optionalRoot = resolve(
    entry,
    "node_modules/@openai/codex/node_modules/@openai",
  );
  let packages;
  try {
    packages = readdirSync(optionalRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const packageEntry of packages) {
    if (
      !packageEntry.isDirectory() ||
      packageEntry.name !== windowsTarget.packageName
    )
      continue;
    const targetRoot = resolve(
      optionalRoot,
      packageEntry.name,
      "vendor",
      windowsTarget.triple,
    );
    for (const relativeBinary of ["bin/codex.exe", "codex/codex.exe"]) {
      const binary = resolve(targetRoot, relativeBinary);
      if (launchableFile(binary, platform)) return binary;
    }
  }
  return null;
}

export function codexExecutable(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const arch = options.arch ?? process.arch;
  const configured = env.CODEX_EXECUTABLE;
  if (configured) {
    const candidate = resolve(configured);
    if (launchableFile(candidate, platform)) return candidate;
    throw new Error(
      `CODEX_EXECUTABLE does not name a launchable ${platform === "win32" ? "Windows .exe" : "file"}: ${candidate}`,
    );
  }
  for (const entry of pathEntries(env, platform)) {
    const direct = resolveOnPath("codex", { env: { PATH: entry }, platform });
    if (direct) return direct;
    const vendor = resolveCodexVendorBinary(entry, { platform, arch });
    if (vendor) return vendor;
  }
  throw new Error(
    `cannot resolve a launchable Codex executable; set CODEX_EXECUTABLE to a valid ${platform === "win32" ? ".exe" : "binary"} path`,
  );
}

export function codexLaunch(options = {}) {
  const executable = codexExecutable(options);
  return {
    file: executable,
    shell: false,
    kind: "native-executable",
  };
}

export function codexSourceHome() {
  const configured = process.env.CODEX_HOME;
  if (
    configured &&
    existsSync(resolve(configured, ".sandbox/setup_marker.json"))
  ) {
    return resolve(configured);
  }
  const profile = process.env.USERPROFILE || process.env.HOME;
  if (!profile) throw new Error("cannot resolve Codex sandbox source home");
  return resolve(profile, ".codex");
}

export function executionCampaignRoot(campaignId, options = {}) {
  const root = resolve(
    options.executionRoot ??
      process.env[EXECUTION_ROOT_ENV] ??
      DEFAULT_EXECUTION_ROOT,
  );
  const target = resolve(root, campaignId);
  if (options.campaignRoot) {
    assertSeparated(target, options.campaignRoot, "execution campaign root");
  }
  return target;
}

export function unitWorkspacePath({
  campaignId,
  taskId,
  unit,
  campaignRoot,
  executionRoot,
}) {
  const root = executionCampaignRoot(campaignId, {
    campaignRoot,
    executionRoot,
  });
  return resolve(root, "units", taskId, String(unit.attempt), unit.blind_label);
}

export function smokeWorkspacePath({
  campaignId,
  campaignRoot,
  executionRoot,
}) {
  const root = executionCampaignRoot(campaignId, {
    campaignRoot,
    executionRoot,
  });
  return resolve(root, "smoke", "workspace");
}

export function reviewWorkspacePath({
  campaignId,
  taskId,
  attempt,
  campaignRoot,
  executionRoot,
}) {
  const root = executionCampaignRoot(campaignId, {
    campaignRoot,
    executionRoot,
  });
  return resolve(root, "reviews", taskId, String(attempt));
}

export async function materializeExternalWorkspace(
  source,
  target,
  options = {},
) {
  const campaignRoot = options.campaignRoot
    ? resolve(options.campaignRoot)
    : null;
  if (campaignRoot) assertSeparated(target, campaignRoot, "external workspace");
  const sourceMetadata = await lstat(source);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
    throw new Error("external workspace source must be a real directory");
  }
  if (await exists(target)) {
    throw new Error(
      `${target} already exists; refusing to overwrite workspace`,
    );
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  return resolve(target);
}

export function forbiddenCoordinatorTargets(campaignRoot) {
  return FORBIDDEN_CAMPAIGN_DIRECTORIES.map((name) =>
    resolve(campaignRoot, name),
  );
}

function codexProfileSource({ workspaceDir, readableDirs }) {
  const workspace = resolve(workspaceDir);
  const lines = [
    `default_permissions = ${tomlQuote(CODEX_SANDBOX_PROFILE)}`,
    "",
    "[windows]",
    'sandbox = "elevated"',
    "sandbox_private_desktop = false",
    "",
    `[permissions.${CODEX_SANDBOX_PROFILE}]`,
    'description = "External OpenCode campaign confinement"',
    "",
    `[permissions.${CODEX_SANDBOX_PROFILE}.workspace_roots]`,
    `${tomlQuote(workspace)} = true`,
    "",
    `[permissions.${CODEX_SANDBOX_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    `${tomlQuote(workspace)} = "write"`,
  ];
  for (const path of readableDirs) {
    lines.push(`${tomlQuote(resolve(path))} = "read"`);
  }
  lines.push(
    "",
    `[permissions.${CODEX_SANDBOX_PROFILE}.network]`,
    "enabled = true",
    "",
    "[shell_environment_policy]",
    'inherit = "all"',
    "ignore_default_excludes = false",
    `include_only = ${stableJson([
      "PATH",
      "PATHEXT",
      "SYSTEMROOT",
      "WINDIR",
      "COMSPEC",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
      "XDG_*",
      "OPENCODE_*",
      "SELF_EVOLUTION_*",
      "LANG",
      "LC_ALL",
      "TERM",
      "NUMBER_OF_PROCESSORS",
      "PROCESSOR_*",
      "NODE_OPTIONS",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
    ])}`,
    "",
  );
  return lines.join("\r\n");
}

export async function prepareDedicatedCodexHome({
  workspaceDir,
  runtimeRoot,
  readableDirs = [],
}) {
  const sourceHome = codexSourceHome();
  const markerSource = resolve(sourceHome, ".sandbox/setup_marker.json");
  const usersSource = resolve(
    sourceHome,
    ".sandbox-secrets/sandbox_users.json",
  );
  const marker = JSON.parse(await readFile(markerSource, "utf8"));
  if (marker.version !== CODEX_SETUP_VERSION) {
    throw new Error(
      `Codex sandbox setup marker version ${CODEX_SETUP_VERSION} required`,
    );
  }
  const codexHome = resolve(runtimeRoot, "codex-home");
  const markerTarget = resolve(codexHome, ".sandbox/setup_marker.json");
  const usersTarget = resolve(codexHome, ".sandbox-secrets/sandbox_users.json");
  await mkdir(dirname(markerTarget), { recursive: true });
  await mkdir(dirname(usersTarget), { recursive: true });
  await cp(markerSource, markerTarget, { preserveTimestamps: true });
  await cp(usersSource, usersTarget, { preserveTimestamps: true });
  const configSource = codexProfileSource({ workspaceDir, readableDirs });
  const configPath = resolve(codexHome, "config.toml");
  await writeFile(configPath, configSource, "utf8");
  if (process.platform === "win32") {
    const grantPath = String(resolve(runtimeRoot)).replaceAll("'", "''");
    const grant = await runPowerShell(
      `$ErrorActionPreference = 'Stop'\n$path = '${grantPath}'\n$section = [System.Security.AccessControl.AccessControlSections]::Access\n$acl = [System.IO.Directory]::GetAccessControl($path, $section)\nforeach ($name in @('CodexSandboxUsers','CodexSandboxOffline','CodexSandboxOnline')) {\n  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($name,'Modify','ContainerInherit,ObjectInherit','None','Allow')\n  [void]$acl.AddAccessRule($rule)\n}\n[System.IO.Directory]::SetAccessControl($path, $acl)`,
      { timeoutMs: 30_000 },
    );
    if (grant.exitCode !== 0) {
      throw new Error(
        `cannot grant dedicated Codex runtime ACL: ${grant.stderr.trim()}`,
      );
    }
  }
  return {
    root: codexHome,
    profile: CODEX_SANDBOX_PROFILE,
    config_path: configPath,
    config_sha256: sha256(configSource),
    setup_version: marker.version,
    marker_sha256: await fileSha256(markerTarget),
    users_sha256: await fileSha256(usersTarget),
  };
}

function powershellExecutable() {
  const direct = resolveOnPath("powershell");
  return direct ?? "powershell.exe";
}

async function captureProcess(
  file,
  args,
  { cwd, env, timeoutMs = 60_000, stdin, onStdoutLine, shell = false } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      windowsHide: true,
      shell,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let policyTermination = null;
    let remainder = "";
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    if (stdin !== undefined) child.stdin.end(stdin);
    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      stdout.push(bytes);
      if (typeof onStdoutLine !== "function" || policyTermination) return;
      remainder += bytes.toString("utf8");
      const lines = remainder.split(/\r?\n/);
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        const reason = onStdoutLine(line);
        if (!reason) continue;
        policyTermination = reason;
        child.kill("SIGKILL");
        break;
      }
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (
        remainder.trim() &&
        typeof onStdoutLine === "function" &&
        !policyTermination
      ) {
        policyTermination = onStdoutLine(remainder);
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

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script, options = {}) {
  return captureProcess(
    powershellExecutable(),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShell(script),
    ],
    {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      timeoutMs: options.timeoutMs ?? 60_000,
    },
  );
}

function aclPathLiteral(path) {
  return String(resolve(path)).replaceAll("'", "''");
}

async function currentSddl(path) {
  const literal = aclPathLiteral(path);
  const result = await runPowerShell(
    `$ErrorActionPreference = 'Stop'\n$path = '${literal}'\n$section = [System.Security.AccessControl.AccessControlSections]::Access\n$acl = [System.IO.Directory]::GetAccessControl($path, $section)\n$acl.GetSecurityDescriptorSddlForm($section)`,
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(`cannot read ACL for ${path}: ${result.stderr.trim()}`);
  }
  return result.stdout.replaceAll("\r\n", "\n").trim();
}

async function restoreSddl(path, sddl) {
  const literal = aclPathLiteral(path);
  const sddlLiteral = String(sddl).replaceAll("'", "''");
  const result = await runPowerShell(
    `$ErrorActionPreference = 'Stop'\n$path = '${literal}'\n$sddl = '${sddlLiteral}'\n$section = [System.Security.AccessControl.AccessControlSections]::Access\n$acl = [System.IO.Directory]::GetAccessControl($path, $section)\n$acl.SetSecurityDescriptorSddlForm($sddl, $section)\n[System.IO.Directory]::SetAccessControl($path, $acl)`,
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `cannot restore ACL for ${path}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

async function restoreCoordinatorAclTargets({
  targets,
  restoreAcl = restoreSddl,
  readAcl = currentSddl,
}) {
  const results = [];
  const errors = [];
  for (const target of [...targets].reverse()) {
    try {
      await restoreAcl(target.path, target.sddl_before);
    } catch (error) {
      results.push({ path: target.path, restored: false });
      errors.push(`${target.path}: ${error.message}`);
      continue;
    }

    let actual;
    try {
      actual = await readAcl(target.path);
    } catch (error) {
      results.push({ path: target.path, restored: false });
      errors.push(`${target.path}: ${error.message}`);
      continue;
    }
    const matches = actual === target.sddl_before;
    results.push({ path: target.path, restored: matches });
    if (!matches) errors.push(`${target.path}: ACL mismatch`);
  }
  return { results, errors };
}

export async function applyCoordinatorAclLease({
  campaignRoot,
  receiptDir,
  group = "CodexSandboxUsers",
  runtime,
}) {
  const platform = runtime?.platform ?? process.platform;
  const capture = runtime?.captureProcess ?? captureProcess;
  const readAcl = runtime?.currentSddl ?? currentSddl;
  const restoreAcl = runtime?.restoreSddl ?? restoreSddl;
  const writeReceipt = runtime?.writeJson ?? writeJson;
  if (platform !== "win32") {
    return {
      status: "not-applicable",
      targets: [],
      async restore() {},
    };
  }
  const targets = [];
  for (const path of forbiddenCoordinatorTargets(campaignRoot)) {
    if (!(await exists(path))) {
      throw new Error(`coordinator ACL target is missing: ${path}`);
    }
    targets.push({ path, sddl_before: await readAcl(path) });
  }
  await mkdir(receiptDir, { recursive: true });
  const manifest = {
    schema_version: "1.0",
    group,
    targets,
  };
  const manifestPath = resolve(receiptDir, "acl-lease.json");
  await writeReceipt(manifestPath, manifest);
  const manifestSha256 = await fileSha256(manifestPath);
  const applied = [];
  try {
    for (const target of targets) {
      applied.push({ ...target, sddl_after: null });
      const execution = await capture(
        "icacls.exe",
        [target.path, "/deny", `${group}:(OI)(CI)(RX)`],
        { cwd: receiptDir, env: process.env, timeoutMs: 30_000 },
      );
      if (execution.exitCode !== 0) {
        throw new Error(
          `ACL deny failed for ${target.path}: ${execution.stderr.trim() || execution.stdout.trim()}`,
        );
      }
      applied.at(-1).sddl_after = await readAcl(target.path);
    }
    const appliedReceipt = {
      schema_version: "1.0",
      status: "applied",
      manifest_sha256: manifestSha256,
      targets: applied.map(({ path, sddl_after }) => ({ path, sddl_after })),
    };
    await writeReceipt(resolve(receiptDir, "acl-applied.json"), appliedReceipt);
  } catch (error) {
    const rollback = await restoreCoordinatorAclTargets({
      targets: applied,
      restoreAcl,
      readAcl,
    });
    if (rollback.errors.length > 0) {
      throw new AggregateError(
        [error],
        `coordinator ACL application failed and rollback failed: ${rollback.errors.join("; ")}`,
      );
    }
    throw error;
  }
  let restored = false;
  return {
    status: "applied",
    manifest_path: manifestPath,
    manifest_sha256: manifestSha256,
    script_sha256: null,
    group,
    targets: applied.map((item) => ({
      path: item.path,
      before_sha256: sha256(
        targets.find((target) => resolve(target.path) === resolve(item.path))
          ?.sddl_before ?? "",
      ),
      after_sha256: sha256(item.sddl_after),
    })),
    async restore() {
      if (restored) return { status: "already-restored" };
      const { results, errors } = await restoreCoordinatorAclTargets({
        targets,
        restoreAcl,
        readAcl,
      });
      if (errors.length > 0)
        throw new Error(`coordinator ACL restore failed: ${errors.join("; ")}`);
      const value = {
        schema_version: "1.0",
        status: "restored",
        manifest_sha256: manifestSha256,
        targets: results,
      };
      const receiptPath = resolve(receiptDir, "acl-restored.json");
      await writeReceipt(receiptPath, value);
      const receiptSha256 = await fileSha256(receiptPath);
      restored = true;
      return {
        ...value,
        receipt_path: receiptPath,
        receipt_sha256: receiptSha256,
      };
    },
  };
}

export async function runCodexSandboxed({
  codexHome,
  workspaceDir,
  file,
  args = [],
  env,
  timeoutMs,
  stdin,
  onStdoutLine,
}) {
  if (process.platform !== "win32") {
    return captureProcess(file, args, {
      cwd: workspaceDir,
      env,
      timeoutMs,
      stdin,
      onStdoutLine,
    });
  }
  const childEnv = { ...env, CODEX_HOME: resolve(codexHome) };
  const launch = codexLaunch();
  return captureProcess(
    launch.file,
    [
      "sandbox",
      "-P",
      CODEX_SANDBOX_PROFILE,
      "-C",
      resolve(workspaceDir),
      file,
      ...args,
    ],
    {
      cwd: workspaceDir,
      env: childEnv,
      timeoutMs,
      stdin,
      onStdoutLine,
      shell: launch.shell,
    },
  );
}

function restrictedWslOutput(execution) {
  return `${execution?.stdout ?? ""}\n${execution?.stderr ?? ""}`
    .replaceAll("\0", "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function restrictedWslEnvironment(source = process.env) {
  return Object.fromEntries(
    [
      "PATH",
      "PATHEXT",
      "SYSTEMROOT",
      "WINDIR",
      "COMSPEC",
      "NUMBER_OF_PROCESSORS",
      "PROCESSOR_ARCHITECTURE",
      "PROCESSOR_IDENTIFIER",
      "PROCESSOR_LEVEL",
      "PROCESSOR_REVISION",
    ]
      .filter((name) => source[name] !== undefined)
      .map((name) => [name, source[name]]),
  );
}

function prewarmPowerShellScript({ distro, usersPath, wslPath, timeoutMs }) {
  const distroLiteral = String(distro).replaceAll("'", "''");
  const usersLiteral = String(resolve(usersPath)).replaceAll("'", "''");
  const wslLiteral = String(resolve(wslPath)).replaceAll("'", "''");
  return String.raw`
$ErrorActionPreference = 'Stop'
$usersPath = '${usersLiteral}'
$wslPath = '${wslLiteral}'
$distro = '${distroLiteral}'
$timeoutMs = ${timeoutMs}
$users = Get-Content -Raw -LiteralPath $usersPath | ConvertFrom-Json
if ($users.version -ne ${CODEX_SETUP_VERSION}) {
  throw "Codex sandbox credential version ${CODEX_SETUP_VERSION} required"
}
$online = $users.online
if (-not $online -or -not $online.username -or -not $online.password) {
  throw 'Codex sandbox online credential is missing'
}
$expectedUsername = 'CodexSandboxOnline'
if ([string]$online.username -ne $expectedUsername) {
  throw 'Codex sandbox online identity mismatch'
}
$protected = [Convert]::FromBase64String([string]$online.password)
[Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a') | Out-Null
$clear = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$secure = New-Object System.Security.SecureString
try {
  foreach ($byte in $clear) {
    $secure.AppendChar([char]$byte)
  }
  $secure.MakeReadOnly()
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $wslPath
  $start.Arguments = '--distribution ' + $distro + ' --exec /bin/true'
  $start.UseShellExecute = $false
  $start.UserName = [string]$online.username
  $start.Domain = '.'
  $start.Password = $secure
  $start.LoadUserProfile = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.CreateNoWindow = $true
  $start.WorkingDirectory = [Environment]::GetFolderPath('Windows')
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) {
    throw 'profile-loaded WSL prewarm did not start'
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $finished = $process.WaitForExit($timeoutMs)
  if (-not $finished) {
    try { $process.Kill() } catch {}
    $exitedAfterKill = $process.WaitForExit(5000)
  } else {
    $exitedAfterKill = $true
  }
  if ($exitedAfterKill) {
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
  $exitCode = [int64]$process.ExitCode
  } else {
    $stdout = ''
    $stderr = ''
    $exitCode = $null
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $stdoutHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($stdout))).Replace('-', '').ToLowerInvariant()
    $sha.Initialize()
    $stderrHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($stderr))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  [pscustomobject]@{
    schema_version = '1.0'
    status = if ($finished -and $exitCode -eq 0) { 'passed' } else { 'failed' }
    timed_out = -not $finished
    exit_code = $exitCode
    username = [string]$online.username
    stdout_sha256 = $stdoutHash
    stderr_sha256 = $stderrHash
  } | ConvertTo-Json -Compress
} finally {
  if ($process) { $process.Dispose() }
  if ($protected) { [Array]::Clear($protected, 0, $protected.Length) }
  if ($clear) { [Array]::Clear($clear, 0, $clear.Length) }
  if ($secure) { $secure.Dispose() }
}
`.trim();
}

export async function prewarmRestrictedWsl({ distro, runtime = {} } = {}) {
  if (!distro) throw new Error("restricted WSL prewarm requires a distro");
  if (!/^[A-Za-z0-9._-]+$/.test(distro)) {
    throw new Error("restricted WSL prewarm distro is invalid");
  }
  const platform = runtime.platform ?? process.platform;
  if (platform !== "win32") {
    return { status: "not-applicable", distro };
  }
  const sourceHome = resolve(
    runtime.sourceHome ?? (runtime.codexSourceHome ?? codexSourceHome)(),
  );
  const markerPath = resolve(sourceHome, ".sandbox/setup_marker.json");
  const usersPath = resolve(sourceHome, ".sandbox-secrets/sandbox_users.json");
  const read = runtime.readFile ?? readFile;
  let marker;
  try {
    marker = JSON.parse(await read(markerPath, "utf8"));
  } catch {
    throw new Error("Codex sandbox setup marker is invalid");
  }
  if (marker.version !== CODEX_SETUP_VERSION) {
    throw new Error(
      `Codex sandbox setup marker version ${CODEX_SETUP_VERSION} required`,
    );
  }
  if (marker.online_username !== "CodexSandboxOnline") {
    throw new Error("Codex sandbox online identity mismatch");
  }
  let users;
  try {
    users = JSON.parse(await read(usersPath, "utf8"));
  } catch {
    throw new Error("Codex sandbox credential file is invalid");
  }
  if (users.version !== CODEX_SETUP_VERSION) {
    throw new Error(
      `Codex sandbox credential version ${CODEX_SETUP_VERSION} required`,
    );
  }
  if (
    users.online?.username !== marker.online_username ||
    typeof users.online?.password !== "string" ||
    users.online.password.length === 0
  ) {
    throw new Error("Codex sandbox online credential is invalid");
  }
  const protectedBytes = Buffer.from(users.online.password, "base64");
  if (
    protectedBytes.length < 20 ||
    !protectedBytes
      .subarray(0, 20)
      .equals(Buffer.from("01000000d08c9ddf0115d1118c7a00c04fc297eb", "hex"))
  ) {
    protectedBytes.fill(0);
    throw new Error("Codex sandbox online credential is invalid");
  }
  protectedBytes.fill(0);
  const wslPath =
    runtime.wslPath ??
    resolveOnPath("wsl", {
      env: runtime.env ?? process.env,
      platform,
    });
  if (!wslPath) throw new Error("cannot resolve a launchable wsl.exe");
  const executePowerShell = runtime.runPowerShell ?? runPowerShell;
  const timeoutMs = runtime.timeoutMs ?? 30_000;
  const script = prewarmPowerShellScript({
    distro,
    usersPath,
    wslPath,
    timeoutMs,
  });
  const execution = await executePowerShell(script, {
    cwd: runtime.cwd ?? process.cwd(),
    env: restrictedWslEnvironment(runtime.env ?? process.env),
    timeoutMs: timeoutMs + 10_000,
  });
  if (execution.exitCode !== 0) {
    throw new Error(
      `profile-loaded WSL prewarm failed: PowerShell exited ${execution.exitCode ?? "without a code"}`,
    );
  }
  let result;
  try {
    result = JSON.parse(String(execution.stdout ?? "").trim());
  } catch {
    throw new Error("profile-loaded WSL prewarm returned invalid evidence");
  }
  if (
    result?.schema_version !== "1.0" ||
    result?.status !== "passed" ||
    result?.timed_out !== false ||
    result?.exit_code !== 0 ||
    result?.username !== marker.online_username ||
    !/^[0-9a-f]{64}$/.test(result?.stdout_sha256 ?? "") ||
    !/^[0-9a-f]{64}$/.test(result?.stderr_sha256 ?? "")
  ) {
    const reason = result?.timed_out
      ? "timed out"
      : `wsl.exe exited ${result?.exit_code ?? "without a code"}`;
    throw new Error(`profile-loaded WSL prewarm failed: ${reason}`);
  }
  return {
    status: "passed",
    distro,
    identity: marker.online_username,
    profile: "loaded-user-profile",
    probe: "wsl-bin-true",
    stdout_sha256: result.stdout_sha256,
    stderr_sha256: result.stderr_sha256,
  };
}

export function classifyRestrictedWslProbe(execution) {
  if (execution?.timedOut) return "timed-out";
  if (execution?.exitCode === 0) return "available";
  const output = restrictedWslOutput(execution);
  if (
    /WSL_E_DISTRO_NOT_FOUND/i.test(output) ||
    /不存在具有所提供名称的分发/.test(output) ||
    /(?:no|there is no) distribution (?:exists )?with the supplied name/i.test(
      output,
    )
  ) {
    return "distro-not-found";
  }
  if (
    /没有已安装的分发/.test(output) ||
    /(?:has|have|with) no installed distributions/i.test(output) ||
    /no distributions are installed/i.test(output)
  ) {
    return "no-distributions";
  }
  return "unavailable";
}

export async function verifyRestrictedWslAvailability({
  distro,
  scratchRoot,
  runtime = {},
} = {}) {
  if (!distro) throw new Error("restricted WSL preflight requires a distro");
  const platform = runtime.platform ?? process.platform;
  if (platform !== "win32") {
    return { status: "not-applicable", distro };
  }
  const scratch = resolve(
    scratchRoot ??
      runtime.tmpdir ??
      process.env[EXECUTION_ROOT_ENV] ??
      DEFAULT_EXECUTION_ROOT,
  );
  await (runtime.mkdir ?? mkdir)(scratch, { recursive: true });
  const root = await (runtime.mkdtemp ?? mkdtemp)(
    resolve(scratch, "external-restricted-wsl-"),
  );
  const workspaceDir = resolve(root, "workspace");
  try {
    await (runtime.mkdir ?? mkdir)(workspaceDir, { recursive: true });
    const codexHome = await (
      runtime.prepareDedicatedCodexHome ?? prepareDedicatedCodexHome
    )({
      workspaceDir,
      runtimeRoot: root,
    });
    const execution = await (runtime.runCodexSandboxed ?? runCodexSandboxed)({
      codexHome: codexHome.root,
      workspaceDir,
      file: "wsl.exe",
      args: ["--distribution", distro, "--exec", "/usr/bin/id"],
      env: restrictedWslEnvironment(runtime.env ?? process.env),
      timeoutMs: 30_000,
    });
    const classification = classifyRestrictedWslProbe(execution);
    if (classification !== "available") {
      const reason = {
        "distro-not-found": `${distro} is not registered for the active Codex sandbox identity (WSL_E_DISTRO_NOT_FOUND)`,
        "no-distributions":
          "no WSL distributions are registered for the active Codex sandbox identity",
        "timed-out": "the restricted WSL launch timed out",
        unavailable: `wsl.exe exited ${execution.exitCode ?? "without a code"}`,
      }[classification];
      const diagnostic = restrictedWslOutput(execution);
      throw new Error(
        `Codex restricted-profile WSL preflight failed (${classification}): ${reason}${diagnostic ? `; output=${JSON.stringify(diagnostic.slice(0, 400))}` : ""}`,
      );
    }
    return {
      status: "passed",
      profile: CODEX_SANDBOX_PROFILE,
      distro,
      probe: "wsl-distro-id",
      stdout_sha256: sha256(execution.stdout ?? ""),
      stderr_sha256: sha256(execution.stderr ?? ""),
    };
  } finally {
    await (runtime.rm ?? rm)(root, { recursive: true, force: true });
  }
}

export function windowsConfinementCanaryCommand({
  workspaceDir,
  forbiddenFile,
  junctionFile,
  expectedSecret,
}) {
  const escapedWorkspace = String(resolve(workspaceDir)).replaceAll("'", "''");
  const escapedForbidden = String(resolve(forbiddenFile)).replaceAll("'", "''");
  const escapedJunction = String(resolve(junctionFile)).replaceAll("'", "''");
  const escapedSecret = String(expectedSecret).replaceAll("'", "''");
  return String.raw`
$ErrorActionPreference = 'Stop'
$workspace = '${escapedWorkspace}'
$forbidden = '${escapedForbidden}'
$junction = '${escapedJunction}'
$secret = '${escapedSecret}'
$probe = Join-Path $workspace '.external-confinement-canary.txt'
[System.IO.File]::WriteAllText($probe, 'WRITE_OK', (New-Object System.Text.UTF8Encoding($false)))
if ((Get-Content -Raw -LiteralPath $probe).Trim() -ne 'WRITE_OK') { exit 71 }
try { Get-Content -Raw -LiteralPath $forbidden | Out-Null; exit 72 } catch [System.UnauthorizedAccessException] {}
try { [System.IO.File]::ReadAllBytes($forbidden) | Out-Null; exit 73 } catch [System.UnauthorizedAccessException] {}
try { Get-Content -Raw -LiteralPath $junction | Out-Null; exit 74 } catch [System.UnauthorizedAccessException] {}
'WINDOWS_CONFINEMENT_OK'
`;
}

export async function verifyWindowsConfinement({
  codexHome,
  workspaceDir,
  campaignRoot,
  env,
}) {
  const forbiddenPath = resolve(campaignRoot, "sealed");
  const forbiddenFile = resolve(
    forbiddenPath,
    ".external-confinement-secret.txt",
  );
  const junctionPath = resolve(workspaceDir, ".external-forbidden-junction");
  const junctionFile = resolve(
    junctionPath,
    ".external-confinement-secret.txt",
  );
  const expectedSecret = `SEALED_${sha256(`${Date.now()}-${workspaceDir}`)}`;
  await writeFile(forbiddenFile, expectedSecret, "utf8");
  const create = await captureProcess(
    process.env.COMSPEC || "cmd.exe",
    ["/d", "/s", "/c", "mklink", "/J", junctionPath, forbiddenPath],
    { cwd: workspaceDir, env: process.env, timeoutMs: 30_000 },
  );
  if (create.exitCode !== 0 && !(await exists(junctionPath))) {
    throw new Error(
      `cannot create confinement junction canary: ${create.stderr}`,
    );
  }
  try {
    const execution = await runCodexSandboxed({
      codexHome,
      workspaceDir,
      file: powershellExecutable(),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(
          windowsConfinementCanaryCommand({
            workspaceDir,
            forbiddenFile,
            junctionFile,
            expectedSecret,
          }),
        ),
      ],
      env,
      timeoutMs: 60_000,
    });
    if (
      execution.exitCode !== 0 ||
      execution.timedOut ||
      !execution.stdout.includes("WINDOWS_CONFINEMENT_OK")
    ) {
      throw new Error(
        `Windows confinement canary failed closed (exit ${execution.exitCode}); stdout=${JSON.stringify(execution.stdout.trim())}; stderr=${JSON.stringify(execution.stderr.trim())}`,
      );
    }
    return {
      status: "passed",
      enforcement: WINDOWS_CONFINEMENT,
      workspace_write: "passed",
      forbidden_absolute_read: "passed",
      forbidden_dotnet_read: "passed",
      forbidden_junction_read: "passed",
      stdout_sha256: sha256(execution.stdout),
      stderr_sha256: sha256(execution.stderr),
    };
  } finally {
    await runPowerShell(
      `$path = ${tomlQuote(junctionPath)}\nif (Test-Path -LiteralPath $path) { [System.IO.Directory]::Delete($path) }`,
      { timeoutMs: 30_000 },
    );
    await rm(resolve(workspaceDir, ".external-confinement-canary.txt"), {
      force: true,
    });
    await rm(forbiddenFile, { force: true });
  }
}

export async function hashExternalWorkspace(path) {
  const entries = [];
  async function walk(current) {
    for (const entry of await (
      await import("node:fs/promises")
    ).readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      const rel = relative(path, absolute).split(sep).join("/");
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isSymbolicLink())
        throw new Error(`external workspace contains symlink ${rel}`);
      else if (entry.isFile())
        entries.push({ path: rel, sha256: await fileSha256(absolute) });
    }
  }
  await walk(path);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return sha256(stableJson(entries));
}
