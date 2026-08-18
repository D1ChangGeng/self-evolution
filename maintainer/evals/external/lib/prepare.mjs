import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertSafeRelativePath,
  copyClean,
  exists,
  fileSha256,
  hashTree,
  inside,
  sha256,
  stableJson,
  VERIFICATION_ARTIFACTS,
  verificationArtifactBindingDigest,
  writeJson,
} from "./core.mjs";
import { collectWorkspacePatch } from "./collector.mjs";

const exec = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
export const PINNED_WSL_TOOLCHAIN = Object.freeze({
  distro: "Ubuntu",
  root: "/home/d26fo/.local/share/self-evolution-toolchains/node-v22.13.1",
  node: "22.13.1",
  npm: "10.9.2",
});

function toolchainPath(toolchain) {
  return `${toolchain.root}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
}

async function toLinuxPath(path, toolchain) {
  if (process.platform !== "win32") return resolve(path);
  try {
    const result = await exec(
      "wsl.exe",
      [
        "--distribution",
        toolchain.distro,
        "--exec",
        "wslpath",
        "-a",
        "-u",
        resolve(path),
      ],
      {
        timeout: 30_000,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      },
    );
    return result.stdout.trim();
  } catch (error) {
    throw new Error(
      `WSL path conversion failed: ${error.stderr || error.message}`,
    );
  }
}

function quotePosixShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function shellInvocation(command, cwd, toolchain) {
  const linuxCwd = await toLinuxPath(cwd, toolchain);
  const script =
    'cd -- "$1" && export PATH="$2" && command="$3" && shift 3 && while [ "$#" -gt 0 ]; do export "$1"; shift; done && exec bash --noprofile --norc -c "$command"';
  if (process.platform === "win32") {
    return {
      file: "wsl.exe",
      args: [
        "--distribution",
        toolchain.distro,
        "--exec",
        "bash",
        "--noprofile",
        "--norc",
        "-c",
        script,
        "external-eval",
        linuxCwd,
        toolchainPath(toolchain),
        command,
      ],
    };
  }
  return {
    file: "/bin/bash",
    args: [
      "--noprofile",
      "--norc",
      "-c",
      script,
      "external-eval",
      linuxCwd,
      toolchainPath(toolchain),
      command,
    ],
  };
}

export async function runCommand(command, options = {}) {
  const toolchain = options.toolchain ?? PINNED_WSL_TOOLCHAIN;
  const { file, args } = await shellInvocation(
    command,
    options.cwd ?? process.cwd(),
    toolchain,
  );
  for (const [name, value] of Object.entries(options.env ?? {})) {
    args.push(`${name}=${value}`);
  }
  const startedAt = Date.now();
  try {
    const result = await exec(file, args, {
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 45 * 60 * 1000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return {
      command,
      status: "completed",
      exit_code: 0,
      started_at_ms: startedAt,
      finished_at_ms: Date.now(),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      command,
      status: error.killed ? "timed-out" : "failed",
      exit_code: Number.isInteger(error.code) ? error.code : 1,
      started_at_ms: startedAt,
      finished_at_ms: Date.now(),
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

export async function verifyPinnedToolchain(
  toolchain = PINNED_WSL_TOOLCHAIN,
  cwd = process.cwd(),
) {
  const result = await runCommand(
    'printf \'%s\\n%s\\n\' "$(node --version)" "$(npm --version)"',
    { cwd, toolchain, timeoutMs: 30_000 },
  );
  const [nodeVersion, npmVersion] = result.stdout.trim().split(/\r?\n/);
  if (
    result.exit_code !== 0 ||
    nodeVersion !== `v${toolchain.node}` ||
    npmVersion !== toolchain.npm
  ) {
    throw new Error(
      `pinned WSL toolchain mismatch: expected node v${toolchain.node}/npm ${toolchain.npm}, received ${nodeVersion ?? "unavailable"}/${npmVersion ?? "unavailable"}`,
    );
  }
  return { node: nodeVersion.slice(1), npm: npmVersion, ...toolchain };
}

export async function runCommands(commands, options = {}) {
  const results = [];
  for (const command of commands) {
    const result = await runCommand(command, options);
    results.push(result);
    if (result.exit_code !== 0 && !options.continueOnError) break;
  }
  return results;
}

async function git(args, options = {}) {
  try {
    const result = await exec("git", args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 10 * 60 * 1000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(
      `git ${args.join(" ")} failed: ${error.stderr || error.message}`,
    );
  }
}

async function configureSyntheticRepository(root) {
  await git(["config", "core.autocrlf", "false"], { cwd: root });
  await git(["config", "core.eol", "lf"], { cwd: root });
}

export async function refreshSyntheticCommit(root) {
  await configureSyntheticRepository(root);
  await rm(resolve(root, "node_modules"), { recursive: true, force: true });
  if (await exists(resolve(root, "package-lock.json"))) {
    await git(["add", "--force", "--", "package-lock.json"], { cwd: root });
  }
  await git(["add", "-A"], { cwd: root });
  await git(["commit", "--quiet", "--amend", "--no-edit", "--allow-empty"], {
    cwd: root,
  });
  const commitCount = await git(["rev-list", "--count", "HEAD"], {
    cwd: root,
  });
  const status = await git(["status", "--porcelain=v1"], { cwd: root });
  if (commitCount !== "1" || status !== "") {
    throw new Error(
      `synthetic repository is not frozen (commits=${commitCount}, dirty=${status !== ""})`,
    );
  }
  return {
    commit_sha: await git(["rev-parse", "HEAD"], { cwd: root }),
    tree_sha: await git(["rev-parse", "HEAD^{tree}"], { cwd: root }),
    commit_count: 1,
    clean: true,
  };
}

export async function materializeCommit({
  mirrorDir,
  repository,
  sha,
  targetDir,
}) {
  await mkdir(dirname(mirrorDir), { recursive: true });
  let resolved;
  if (!(await exists(mirrorDir))) {
    await git(["clone", "--mirror", repository.url, mirrorDir], {
      timeoutMs: 20 * 60 * 1000,
    });
  } else {
    await git(["remote", "set-url", "origin", repository.url], {
      cwd: mirrorDir,
    });
    try {
      resolved = await git(["rev-parse", `${sha}^{commit}`], {
        cwd: mirrorDir,
      });
    } catch {
      await git(["fetch", "--prune", "origin"], {
        cwd: mirrorDir,
        timeoutMs: 20 * 60 * 1000,
      });
    }
  }
  resolved ??= await git(["rev-parse", `${sha}^{commit}`], {
    cwd: mirrorDir,
  });
  if (resolved !== sha)
    throw new Error(`expected ${sha}, resolved ${resolved}`);
  const archive = resolve(dirname(targetDir), `${sha}.tar`);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await git(
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.eol=lf",
      "archive",
      "--format=tar",
      `--output=${archive}`,
      sha,
    ],
    { cwd: mirrorDir },
  );
  const [linuxArchive, linuxTarget] = await Promise.all([
    toLinuxPath(archive, PINNED_WSL_TOOLCHAIN),
    toLinuxPath(targetDir, PINNED_WSL_TOOLCHAIN),
  ]);
  const unpack = await runCommand(
    `tar -xf ${quotePosixShell(linuxArchive)} -C ${quotePosixShell(linuxTarget)}`,
    {
      timeoutMs: 10 * 60 * 1000,
      toolchain: PINNED_WSL_TOOLCHAIN,
    },
  );
  await rm(archive, { force: true });
  if (unpack.exit_code !== 0)
    throw new Error(unpack.stderr || "tar extraction failed");
  await git(["init", "--quiet"], { cwd: targetDir });
  await configureSyntheticRepository(targetDir);
  await git(["config", "user.name", "self-evolution external eval"], {
    cwd: targetDir,
  });
  await git(["config", "user.email", "eval.invalid@example.invalid"], {
    cwd: targetDir,
  });
  await git(["add", "-A"], { cwd: targetDir });
  await git(["commit", "--quiet", "-m", "Frozen task input"], {
    cwd: targetDir,
  });
  return resolved;
}

async function injectHiddenTests(task, taskRoot, workspace) {
  for (const mapping of task.hidden_tests) {
    assertSafeRelativePath(mapping.source, `${task.id}.hidden_tests.source`);
    assertSafeRelativePath(
      mapping.destination,
      `${task.id}.hidden_tests.destination`,
    );
    const source = inside(taskRoot, resolve(taskRoot, mapping.source));
    const destination = inside(
      workspace,
      resolve(workspace, mapping.destination),
    );
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }
}

export async function materializeValidationEnvironment(
  task,
  taskRoot,
  workspace,
) {
  const preload = task.validation_environment?.preload ?? [];
  if (preload.length === 0) return {};
  const targetRoot = resolve(workspace, ".external-eval/validation");
  await rm(targetRoot, { recursive: true, force: true });
  const targetPaths = [];
  for (const [index, sourcePath] of preload.entries()) {
    assertSafeRelativePath(
      sourcePath,
      `${task.id}.validation_environment.preload[${index}]`,
    );
    const source = inside(taskRoot, resolve(taskRoot, sourcePath));
    const target = resolve(
      targetRoot,
      `preload-${index}${extname(sourcePath)}`,
    );
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { force: true });
    targetPaths.push(await toLinuxPath(target, PINNED_WSL_TOOLCHAIN));
  }
  return {
    NODE_OPTIONS: targetPaths.map((path) => `--require=${path}`).join(" "),
  };
}

async function commandEvidence(root, name, commands, expected, options = {}) {
  const results = await runCommands(commands, {
    cwd: root,
    toolchain: PINNED_WSL_TOOLCHAIN,
    env: options.env,
  });
  const actual = results.every((result) => result.exit_code === 0)
    ? "pass"
    : "fail";
  return {
    name,
    expected,
    actual,
    passed: actual === expected,
    commands: results.map((item) => ({
      command: item.command,
      status: item.status,
      exit_code: item.exit_code,
      started_at_ms: item.started_at_ms,
      finished_at_ms: item.finished_at_ms,
      stdout_sha256: sha256(item.stdout),
      stderr_sha256: sha256(item.stderr),
      stdout: item.stdout,
      stderr: item.stderr,
    })),
  };
}

async function installEvidence(
  root,
  name,
  commands,
  expectedLockfileSha256 = null,
) {
  const lockfile = resolve(root, "package-lock.json");
  const before = (await exists(lockfile)) ? await fileSha256(lockfile) : null;
  const evidence = await commandEvidence(root, name, commands, "pass");
  const after = (await exists(lockfile)) ? await fileSha256(lockfile) : null;
  const lockfileUnchanged = before !== null && before === after;
  const lockfileMatchesFrozen =
    expectedLockfileSha256 === null || before === expectedLockfileSha256;
  return {
    ...evidence,
    passed: evidence.passed && lockfileUnchanged && lockfileMatchesFrozen,
    lockfile_before_sha256: before,
    lockfile_after_sha256: after,
    expected_lockfile_sha256: expectedLockfileSha256,
    lockfile_unchanged: lockfileUnchanged,
    lockfile_matches_frozen: lockfileMatchesFrozen,
  };
}

function skippedCommandEvidence(name, expected, reason) {
  return {
    name,
    expected,
    actual: "not-run",
    passed: false,
    skipped: true,
    reason,
    commands: [],
  };
}

export async function runAfterPassingEvidence(
  prerequisite,
  run,
  { name, expected, reason = "prerequisite failed" },
) {
  if (!prerequisite?.passed) {
    return skippedCommandEvidence(name, expected, reason);
  }
  return run();
}

async function cleanupPreflightInstallations(workspaces) {
  const errors = [];
  for (const workspace of workspaces) {
    try {
      await rm(resolve(workspace, "node_modules"), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      errors.push(
        `${workspace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (errors.length > 0)
    throw new Error(
      `preflight dependency cleanup failed: ${errors.join("; ")}`,
    );
}

function preflightWorkspaceRoots(preparedRoot) {
  return [
    resolve(preparedRoot, "preflight/base-hidden"),
    resolve(preparedRoot, "preflight/oracle-hidden"),
    resolve(preparedRoot, "preflight/clean-ci"),
    resolve(preparedRoot, "preflight/base-suite"),
  ];
}

function errorDetails(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function combineErrors(primary, secondary, message) {
  if (!primary) return secondary;
  return new AggregateError([primary, secondary], message);
}

export async function finalizePreflight({
  task,
  preparedRoot,
  result = null,
  error = null,
  runtime,
}) {
  const writeEvidence = runtime?.writeJson ?? writeJson;
  const cleanupInstallations =
    runtime?.cleanupPreflightInstallations ?? cleanupPreflightInstallations;
  const failure =
    error ??
    (!result?.ready
      ? new Error(`${task.id}: preflight contract failed`)
      : null);
  const evidence = result
    ? {
        ...result,
        ...(failure ? { failure: errorDetails(failure) } : {}),
      }
    : {
        schema_version: "1.0",
        task_id: task.id,
        repository: task.repository,
        checks: [],
        ready: false,
        failure: errorDetails(failure),
      };
  const evidencePath = resolve(preparedRoot, "preflight.json");
  let pendingError = failure;
  let evidenceWritten = false;
  try {
    await mkdir(preparedRoot, { recursive: true });
    await writeEvidence(evidencePath, evidence);
    evidenceWritten = true;
  } catch (writeError) {
    pendingError = combineErrors(
      pendingError,
      writeError,
      `${task.id}: preflight evidence write failed`,
    );
  }
  let cleanupError = null;
  try {
    await cleanupInstallations(preflightWorkspaceRoots(preparedRoot));
  } catch (caught) {
    cleanupError = caught;
    pendingError = combineErrors(
      pendingError,
      cleanupError,
      `${task.id}: preflight dependency cleanup failed`,
    );
  }
  if (cleanupError || !evidenceWritten) {
    const failureEvidence = {
      ...evidence,
      ready: false,
      failure: errorDetails(pendingError),
    };
    try {
      await writeEvidence(evidencePath, failureEvidence);
    } catch (writeError) {
      pendingError = combineErrors(
        pendingError,
        writeError,
        `${task.id}: preflight failure evidence write failed`,
      );
    }
  }
  if (pendingError) throw pendingError;
  return result;
}

async function ensureLockfile(task, workspaceDir) {
  const lockfile = resolve(workspaceDir, "package-lock.json");
  if (task.install.lockfile_mode === "generate") {
    const generation = await runCommands(task.install.generation_commands, {
      cwd: workspaceDir,
      toolchain: PINNED_WSL_TOOLCHAIN,
    });
    if (generation.some((result) => result.exit_code !== 0)) {
      throw new Error(`${task.id}: lockfile generation failed`);
    }
  }
  if (!(await exists(lockfile))) {
    throw new Error(
      `${task.id}: package-lock.json is missing after preparation`,
    );
  }
  return fileSha256(lockfile);
}

async function prepareTaskCore({ task, taskRoot, campaignRoot, cacheRoot }) {
  const preparedRoot = resolve(campaignRoot, "prepared", task.id);
  const baseRoot = resolve(preparedRoot, "base");
  const oracleRoot = resolve(preparedRoot, "oracle");
  const mirrorDir = resolve(cacheRoot, `${task.id}.git`);
  await materializeCommit({
    mirrorDir,
    repository: task.repository,
    sha: task.repository.base_sha,
    targetDir: baseRoot,
  });
  await materializeCommit({
    mirrorDir,
    repository: task.repository,
    sha: task.repository.oracle_sha,
    targetDir: oracleRoot,
  });
  const pinnedToolchain = await verifyPinnedToolchain(
    PINNED_WSL_TOOLCHAIN,
    baseRoot,
  );
  if (
    task.toolchain?.node !== pinnedToolchain.node ||
    task.toolchain?.npm !== pinnedToolchain.npm
  ) {
    throw new Error(
      `${task.id}: task requires node ${task.toolchain?.node ?? "unspecified"}/npm ${task.toolchain?.npm ?? "unspecified"}, not the pinned ${pinnedToolchain.node}/${pinnedToolchain.npm}`,
    );
  }
  const lockfileSha256 = await ensureLockfile(task, baseRoot);
  const oracleLockfile = resolve(oracleRoot, "package-lock.json");
  if (task.install.lockfile_mode === "generate") {
    await cp(resolve(baseRoot, "package-lock.json"), oracleLockfile, {
      force: true,
    });
  }
  const oracleLockfileSha256 = await fileSha256(oracleLockfile);
  if (oracleLockfileSha256 !== lockfileSha256) {
    throw new Error(`${task.id}: base and oracle lockfile hashes differ`);
  }
  const baseSynthetic = await refreshSyntheticCommit(baseRoot);
  const oracleSynthetic = await refreshSyntheticCommit(oracleRoot);

  const baseHiddenRoot = resolve(preparedRoot, "preflight/base-hidden");
  const oracleHiddenRoot = resolve(preparedRoot, "preflight/oracle-hidden");
  const cleanRoot = resolve(preparedRoot, "preflight/clean-ci");
  const baseSuiteRoot = resolve(preparedRoot, "preflight/base-suite");
  await copyClean(baseRoot, baseHiddenRoot);
  await copyClean(oracleRoot, oracleHiddenRoot);
  await copyClean(baseRoot, cleanRoot);
  await copyClean(baseRoot, baseSuiteRoot);
  await injectHiddenTests(task, taskRoot, baseHiddenRoot);
  await injectHiddenTests(task, taskRoot, oracleHiddenRoot);
  const validationEnvironments = {
    baseHidden: await materializeValidationEnvironment(
      task,
      taskRoot,
      baseHiddenRoot,
    ),
    oracleHidden: await materializeValidationEnvironment(
      task,
      taskRoot,
      oracleHiddenRoot,
    ),
    clean: await materializeValidationEnvironment(task, taskRoot, cleanRoot),
    baseSuite: await materializeValidationEnvironment(
      task,
      taskRoot,
      baseSuiteRoot,
    ),
  };
  const cleanInstall = await installEvidence(
    cleanRoot,
    "clean-install",
    task.install.commands,
    lockfileSha256,
  );
  const cleanCi = await runAfterPassingEvidence(
    cleanInstall,
    () =>
      commandEvidence(
        cleanRoot,
        "clean-ci-after-install",
        task.validation.clean_ci,
        "pass",
        { env: validationEnvironments.clean },
      ),
    {
      name: "clean-ci-after-install",
      expected: "pass",
      reason: "clean npm ci failed",
    },
  );
  const baseSuiteInstall = await installEvidence(
    baseSuiteRoot,
    "base-suite-install",
    task.install.commands,
    lockfileSha256,
  );
  const baseSuite = await runAfterPassingEvidence(
    baseSuiteInstall,
    () =>
      commandEvidence(
        baseSuiteRoot,
        "base-original-suite",
        task.validation.base_suite,
        "pass",
        { env: validationEnvironments.baseSuite },
      ),
    {
      name: "base-original-suite",
      expected: "pass",
      reason: "base-suite npm ci failed",
    },
  );
  const baseHiddenInstall = await installEvidence(
    baseHiddenRoot,
    "base-hidden-install",
    task.install.commands,
    lockfileSha256,
  );
  const baseHidden = await runAfterPassingEvidence(
    baseHiddenInstall,
    () =>
      commandEvidence(
        baseHiddenRoot,
        "base-hidden",
        task.validation.base_should_fail,
        "fail",
        { env: validationEnvironments.baseHidden },
      ),
    {
      name: "base-hidden",
      expected: "fail",
      reason: "base-hidden npm ci failed",
    },
  );
  const oracleHiddenInstall = await installEvidence(
    oracleHiddenRoot,
    "oracle-hidden-install",
    task.install.commands,
    lockfileSha256,
  );
  const oracleHidden = await runAfterPassingEvidence(
    oracleHiddenInstall,
    () =>
      commandEvidence(
        oracleHiddenRoot,
        "oracle-hidden",
        task.validation.oracle_should_pass,
        "pass",
        { env: validationEnvironments.oracleHidden },
      ),
    {
      name: "oracle-hidden",
      expected: "pass",
      reason: "oracle-hidden npm ci failed",
    },
  );
  const checks = [
    cleanInstall,
    cleanCi,
    baseSuiteInstall,
    baseSuite,
    baseHiddenInstall,
    baseHidden,
    oracleHiddenInstall,
    oracleHidden,
  ];
  const result = {
    schema_version: "1.0",
    task_id: task.id,
    repository: task.repository,
    lockfile_sha256: lockfileSha256,
    oracle_lockfile_sha256: oracleLockfileSha256,
    synthetic_repositories: {
      base: baseSynthetic,
      oracle: oracleSynthetic,
    },
    toolchain: pinnedToolchain,
    base_tree_sha256: (
      await hashTree(baseRoot, { exclude: [/^\.git(?:\/|$)/] })
    ).sha256,
    oracle_tree_sha256: (
      await hashTree(oracleRoot, { exclude: [/^\.git(?:\/|$)/] })
    ).sha256,
    checks,
    ready: checks.every((check) => check.passed),
  };
  return result;
}

export async function prepareTask(args) {
  const preparedRoot = resolve(args.campaignRoot, "prepared", args.task.id);
  let result = null;
  let error = null;
  try {
    result = await prepareTaskCore(args);
  } catch (caught) {
    error = caught;
  }
  return finalizePreflight({
    task: args.task,
    preparedRoot,
    result,
    error,
  });
}

export async function createUnitWorkspace({
  taskId,
  unit,
  campaignRoot,
  workspaceDir = resolve(
    campaignRoot,
    "workspaces",
    taskId,
    String(unit.attempt),
    unit.blind_label,
  ),
}) {
  const source = resolve(campaignRoot, "prepared", taskId, "base");
  await copyClean(source, workspaceDir);
  return workspaceDir;
}

export async function installUnitWorkspace({ task, workspaceDir, outputDir }) {
  const install = await installEvidence(
    workspaceDir,
    "unit-clean-install",
    task.install.commands,
  );
  await mkdir(outputDir, { recursive: true });
  await writeJson(resolve(outputDir, "install.json"), install);
  if (!install.passed) {
    throw new Error(`${task.id}: unit clean npm ci failed`);
  }
  return install;
}

function normalizeStatusPath(value) {
  const selected = value.trim().split(" -> ").at(-1);
  if (!selected) return null;
  const unquoted =
    selected.startsWith('"') && selected.endsWith('"')
      ? selected.slice(1, -1)
      : selected;
  return unquoted.replaceAll("\\", "/");
}

function isTestPath(path) {
  return (
    /^(?:test|tests|spec|specs|fixtures?)\//i.test(path) ||
    /(?:^|\/)[^/]*(?:\.test|\.spec|-test)\.[^/]+$/i.test(path) ||
    /^(?:test|tests)\.[^/]+$/i.test(path)
  );
}

function isKnownPatchPath(path) {
  return (
    /^(?:src|lib|source|app)\//i.test(path) ||
    /^(?:index|browser|utils?|parse|stringify)(?:\.[^/]+)+$/i.test(path) ||
    isTestPath(path) ||
    path === "AGENTS.md" ||
    /^\.agents\//.test(path) ||
    /^\.opencode\//.test(path) ||
    /^(?:README|CHANGELOG|SECURITY|CONTRIBUTING)(?:\.[^/]+)?$/i.test(path) ||
    /^docs\//i.test(path)
  );
}

function patchLineFacts(diff) {
  const facts = [];
  let path = null;
  for (const line of String(diff).split(/\r?\n/)) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      path = header[2];
      continue;
    }
    if (
      path &&
      (line.startsWith("+") || line.startsWith("-")) &&
      !line.startsWith("+++") &&
      !line.startsWith("---")
    ) {
      facts.push({
        path,
        kind: line[0] === "+" ? "add" : "delete",
        text: line.slice(1),
      });
    }
  }
  return facts;
}

export function analyzePatchSafety({
  status,
  diff,
  hiddenDestinations = [],
  baselinePackage = null,
  currentPackage = null,
}) {
  const findings = [];
  const parsed = [];
  for (const [index, line] of String(status).split(/\r?\n/).entries()) {
    if (!line) continue;
    if (line.length < 4) {
      findings.push({
        code: "unparsed-status",
        severity: "severe",
        detail: `status line ${index + 1} is malformed`,
      });
      continue;
    }
    const code = line.slice(0, 2);
    const path = normalizeStatusPath(line.slice(3));
    if (!path) {
      findings.push({
        code: "unparsed-path",
        severity: "severe",
        detail: `status line ${index + 1} has no path`,
      });
      continue;
    }
    parsed.push({ code, path });
  }

  const hidden = new Set(
    hiddenDestinations.map((path) => path.replaceAll("\\", "/")),
  );
  for (const item of parsed) {
    if (hidden.has(item.path)) {
      findings.push({
        code: "hidden-test-modified",
        severity: "severe",
        path: item.path,
      });
    }
    if (
      /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(
        item.path,
      )
    ) {
      findings.push({
        code: "dependency-manifest-modified",
        severity: "severe",
        path: item.path,
      });
    }
    if (/^(?:dist|pkg|build|coverage)\//i.test(item.path)) {
      findings.push({
        code: "generated-output-modified",
        severity: "severe",
        path: item.path,
      });
    }
    if (isTestPath(item.path) && /[DR]/.test(item.code)) {
      findings.push({
        code: "test-deleted-or-renamed",
        severity: "severe",
        path: item.path,
      });
    }
    if (
      !isKnownPatchPath(item.path) &&
      !/^(?:package(?:-lock)?\.json)$/i.test(item.path)
    ) {
      findings.push({
        code: "unknown-changed-path",
        severity: "severe",
        path: item.path,
      });
    }
  }

  const patchLines = patchLineFacts(diff);
  if (
    patchLines.some((line) => line.kind === "delete" && isTestPath(line.path))
  ) {
    findings.push({
      code: "test-lines-deleted",
      severity: "severe",
      detail:
        "tracked test changes contain deletions; additive tests are required",
    });
  }
  const apiPattern =
    /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|\{|\*)|module\.exports\b|exports\.[A-Za-z_$]|declare\s+(?:function|class|const|namespace)|(?:main|types|typings|exports|bin)\s*:)/;
  if (patchLines.some((line) => apiPattern.test(line.text))) {
    findings.push({
      code: "public-api-surface-changed",
      severity: "severe",
      detail:
        "patch changes an obvious export, declaration, or package entry point",
    });
  }
  if (baselinePackage !== null || currentPackage !== null) {
    if (!baselinePackage || !currentPackage) {
      findings.push({
        code: "package-manifest-unreadable",
        severity: "severe",
      });
    } else if (
      stableJson(baselinePackage.scripts ?? {}) !==
      stableJson(currentPackage.scripts ?? {})
    ) {
      findings.push({
        code: "package-scripts-changed",
        severity: "severe",
        detail: "test/build/lint command surface changed",
      });
    }
  }
  return {
    status: findings.length === 0 ? "pass" : "fail",
    passed: findings.length === 0,
    changed_paths: parsed,
    findings,
  };
}

async function packageAtHead(workspaceDir) {
  try {
    return JSON.parse(
      await git(["show", "HEAD:package.json"], { cwd: workspaceDir }),
    );
  } catch {
    return null;
  }
}

async function packageInWorkspace(workspaceDir) {
  try {
    return JSON.parse(
      await readFile(resolve(workspaceDir, "package.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

export async function verifyRepairedWorkspace({
  task,
  unit,
  taskRoot,
  workspaceDir,
  outputDir,
}) {
  const verifyRoot = `${workspaceDir}.verify`;
  const workspacePatch = await collectWorkspacePatch(workspaceDir);
  const diff = workspacePatch.patch_text;
  const changed = workspacePatch.status.trimEnd();
  const patchSafety = analyzePatchSafety({
    status: changed,
    diff,
    hiddenDestinations: task.hidden_tests.map((item) => item.destination),
    baselinePackage: await packageAtHead(workspaceDir),
    currentPackage: await packageInWorkspace(workspaceDir),
  });
  await copyClean(workspaceDir, verifyRoot);
  await injectHiddenTests(task, taskRoot, verifyRoot);
  const validationEnvironment = await materializeValidationEnvironment(
    task,
    taskRoot,
    verifyRoot,
  );
  const install = await installEvidence(
    verifyRoot,
    "verification-clean-install",
    task.install.commands,
  );
  const focused = await runAfterPassingEvidence(
    install,
    () =>
      commandEvidence(verifyRoot, "focused", task.validation.focused, "pass", {
        env: validationEnvironment,
      }),
    {
      name: "focused",
      expected: "pass",
      reason: "verification npm ci failed",
    },
  );
  const full = await runAfterPassingEvidence(
    install,
    () =>
      commandEvidence(verifyRoot, "full", task.validation.full, "pass", {
        env: validationEnvironment,
      }),
    {
      name: "full",
      expected: "pass",
      reason: "verification npm ci failed",
    },
  );
  const result = {
    schema_version: "1.0",
    task_id: task.id,
    attempt: unit.attempt,
    blind_label: unit.blind_label,
    hidden_tests: install.passed && focused.passed ? "pass" : "fail",
    full_suite: install.passed && full.passed ? "pass" : "fail",
    regression_safety:
      install.passed && full.passed && patchSafety.passed ? "pass" : "fail",
    focused,
    full,
    clean_install: install,
    patch_safety: patchSafety,
    patch_sha256: workspacePatch.patch_sha256,
    changed_paths: workspacePatch.changed_paths,
    changed_paths_sha256: workspacePatch.changed_paths_sha256,
    patch_binding_sha256: workspacePatch.binding_sha256,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "patch.diff"), workspacePatch.patch);
  await writeFile(
    resolve(outputDir, "changed-paths.txt"),
    workspacePatch.changed_paths_bytes,
  );
  const artifacts = {
    focused,
    full,
    clean_install: install,
    patch_safety: patchSafety,
  };
  result.artifact_bindings = Object.fromEntries(
    Object.entries(VERIFICATION_ARTIFACTS).map(([name, path]) => [
      name,
      {
        path,
        artifact_sha256: sha256(stableJson(artifacts[name])),
        value_sha256: sha256(stableJson(artifacts[name])),
      },
    ]),
  );
  result.artifact_bindings.binding_sha256 =
    verificationArtifactBindingDigest(result);
  for (const [name, path] of Object.entries(VERIFICATION_ARTIFACTS)) {
    await writeJson(resolve(outputDir, path), artifacts[name]);
  }
  await writeJson(resolve(outputDir, "verification.json"), result);
  await rm(verifyRoot, { recursive: true, force: true });
  return result;
}

export async function promotePreparedBase(source, destination) {
  const temporary = `${destination}.next`;
  await copyClean(source, temporary);
  await rm(destination, { recursive: true, force: true });
  await rename(temporary, destination);
}

export async function writeTaskBinding(campaignRoot, task, preflight) {
  const taskBinding = {
    schema_version: "1.0",
    task_id: task.id,
    task_contract_sha256: task.contract_sha256,
    repository: task.repository,
    lockfile_sha256: preflight.lockfile_sha256,
    prompt_sha256: {
      onboarding: sha256(task.prompt.onboarding),
      repair: sha256(task.prompt.repair),
    },
  };
  await writeJson(
    resolve(campaignRoot, "bindings", `${task.id}.json`),
    taskBinding,
  );
  return taskBinding;
}
