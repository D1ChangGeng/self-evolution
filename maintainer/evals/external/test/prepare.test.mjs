import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  analyzePatchSafety,
  finalizePreflight,
  materializeCommit,
  materializeValidationEnvironment,
  refreshSyntheticCommit,
  runCommand,
  runAfterPassingEvidence,
} from "../lib/prepare.mjs";

const exec = promisify(execFile);

async function git(root, ...args) {
  const result = await exec("git", args, { cwd: root, windowsHide: true });
  return result.stdout.trim();
}

test("a generated lockfile is included in the sole clean synthetic commit", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-prepare-git-"));
  await mkdir(resolve(root, "node_modules/cache"), { recursive: true });
  await writeFile(resolve(root, "package.json"), '{"name":"fixture"}\n');
  await writeFile(resolve(root, "node_modules/cache/transient"), "ignore\n");
  await git(root, "init", "--quiet");
  await git(root, "config", "user.name", "external eval test");
  await git(root, "config", "user.email", "eval@example.invalid");
  await git(root, "add", "package.json");
  await git(root, "commit", "--quiet", "-m", "Frozen task input");
  await writeFile(
    resolve(root, ".gitignore"),
    "package-lock.json\nnode_modules\n",
  );
  await writeFile(
    resolve(root, "package-lock.json"),
    '{"name":"fixture","lockfileVersion":3}\n',
  );

  const frozen = await refreshSyntheticCommit(root);

  assert.equal(frozen.commit_count, 1);
  assert.equal(frozen.clean, true);
  assert.equal(await git(root, "rev-list", "--count", "HEAD"), "1");
  assert.equal(await git(root, "status", "--porcelain=v1"), "");
  assert.match(
    await git(root, "ls-tree", "-r", "--name-only", "HEAD"),
    /package-lock\.json/,
  );
  await assert.rejects(readFile(resolve(root, "node_modules/cache/transient")));
});

test(
  "materializeCommit converts quoted Windows archive paths for WSL tar",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(
      resolve(tmpdir(), "external materialize ' quoted path-"),
    );
    const source = resolve(root, "source repo");
    const mirror = resolve(root, "mirror repo.git");
    const target = resolve(root, "target checkout");
    await mkdir(source, { recursive: true });
    await git(source, "init", "--quiet");
    await git(source, "config", "core.autocrlf", "false");
    await git(source, "config", "core.eol", "lf");
    await git(source, "config", "user.name", "external eval test");
    await git(source, "config", "user.email", "eval@example.invalid");
    await writeFile(resolve(source, "fixture.txt"), "materialized\n");
    await git(source, "add", "fixture.txt");
    await git(source, "commit", "--quiet", "-m", "fixture");
    const sha = await git(source, "rev-parse", "HEAD");

    await mkdir(mirror, { recursive: true });
    await git(mirror, "init", "--bare", "--quiet");
    await git(mirror, "config", "core.autocrlf", "true");
    await git(mirror, "remote", "add", "origin", source);
    await git(mirror, "fetch", "--quiet", source, `${sha}:refs/heads/main`);

    assert.equal(
      await materializeCommit({
        mirrorDir: mirror,
        repository: { url: source },
        sha,
        targetDir: target,
      }),
      sha,
    );
    assert.equal(
      await readFile(resolve(target, "fixture.txt"), "utf8"),
      "materialized\n",
    );
    assert.equal(await git(target, "config", "core.autocrlf"), "false");
    assert.equal(await git(target, "config", "core.eol"), "lf");
    assert.equal(await git(target, "rev-list", "--count", "HEAD"), "1");
  },
);

test("materializeCommit uses a cached commit when origin is unreachable", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-cached-commit-"));
  const source = resolve(root, "source");
  const mirror = resolve(root, "mirror.git");
  const target = resolve(root, "target");
  const unreachableOrigin = resolve(root, "unreachable.git");
  await mkdir(source, { recursive: true });
  await git(source, "init", "--quiet");
  await git(source, "config", "user.name", "external eval test");
  await git(source, "config", "user.email", "eval@example.invalid");
  await writeFile(resolve(source, "fixture.txt"), "cached\n");
  await git(source, "add", "fixture.txt");
  await git(source, "commit", "--quiet", "-m", "fixture");
  const sha = await git(source, "rev-parse", "HEAD");
  await git(root, "clone", "--mirror", "--quiet", source, mirror);

  assert.equal(
    await materializeCommit({
      mirrorDir: mirror,
      repository: { url: unreachableOrigin },
      sha,
      targetDir: target,
    }),
    sha,
  );
  assert.equal(
    await readFile(resolve(target, "fixture.txt"), "utf8"),
    "cached\n",
  );
  assert.equal(
    await git(mirror, "remote", "get-url", "origin"),
    unreachableOrigin,
  );
});

test("materializeCommit fetches when the requested commit is missing", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-missing-commit-"));
  const source = resolve(root, "source");
  const mirror = resolve(root, "mirror.git");
  await mkdir(source, { recursive: true });
  await git(source, "init", "--quiet");
  await git(source, "config", "user.name", "external eval test");
  await git(source, "config", "user.email", "eval@example.invalid");
  await writeFile(resolve(source, "fixture.txt"), "cached\n");
  await git(source, "add", "fixture.txt");
  await git(source, "commit", "--quiet", "-m", "fixture");
  await git(root, "clone", "--mirror", "--quiet", source, mirror);

  await assert.rejects(
    materializeCommit({
      mirrorDir: mirror,
      repository: { url: resolve(root, "unreachable.git") },
      sha: "0".repeat(40),
      targetDir: resolve(root, "target"),
    }),
    /git fetch --prune origin failed/,
  );
});

test("a failed install skips the hidden test instead of proving the base failure", async () => {
  let ran = false;
  const evidence = await runAfterPassingEvidence(
    { passed: false },
    async () => {
      ran = true;
      return { passed: true };
    },
    { name: "base-hidden", expected: "fail", reason: "npm ci failed" },
  );

  assert.equal(ran, false);
  assert.equal(evidence.actual, "not-run");
  assert.equal(evidence.passed, false);
  assert.equal(evidence.reason, "npm ci failed");
});

test("preflight cleanup removes dependencies while preserving frozen evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-preflight-cleanup-"));
  const preparedRoot = resolve(root, "prepared/task");
  const workspaces = [
    "base-hidden",
    "oracle-hidden",
    "clean-ci",
    "base-suite",
  ].map((name) => resolve(preparedRoot, "preflight", name));
  for (const workspace of workspaces) {
    await mkdir(resolve(workspace, "node_modules/pkg"), { recursive: true });
    await mkdir(resolve(workspace, "src"), { recursive: true });
    await writeFile(resolve(workspace, "node_modules/pkg/index.js"), "noise\n");
    await writeFile(resolve(workspace, "src/index.js"), "evidence\n");
    await writeFile(resolve(workspace, "package-lock.json"), "lockfile\n");
  }
  const result = {
    schema_version: "1.0",
    task_id: "task",
    repository: { url: "https://example.invalid/repo.git" },
    ready: false,
    checks: [
      {
        name: "oracle-hidden",
        passed: true,
        commands: [{ stdout: "kept stdout", stderr: "kept stderr" }],
      },
    ],
  };

  result.ready = true;
  assert.equal(
    await finalizePreflight({
      task: { id: "task", repository: result.repository },
      preparedRoot,
      result,
    }),
    result,
  );

  assert.deepEqual(
    JSON.parse(await readFile(resolve(preparedRoot, "preflight.json"), "utf8")),
    result,
  );
  for (const workspace of workspaces) {
    await assert.rejects(
      readFile(resolve(workspace, "node_modules/pkg/index.js")),
    );
    assert.equal(
      await readFile(resolve(workspace, "src/index.js"), "utf8"),
      "evidence\n",
    );
    assert.equal(
      await readFile(resolve(workspace, "package-lock.json"), "utf8"),
      "lockfile\n",
    );
  }
});

test("failed preflight finalization writes failure evidence before dependency cleanup", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-preflight-failure-"));
  const preparedRoot = resolve(root, "prepared/task");
  const workspaces = [
    "base-hidden",
    "oracle-hidden",
    "clean-ci",
    "base-suite",
  ].map((name) => resolve(preparedRoot, "preflight", name));
  for (const workspace of workspaces) {
    await mkdir(resolve(workspace, "node_modules/pkg"), { recursive: true });
    await writeFile(resolve(workspace, "node_modules/pkg/index.js"), "noise\n");
  }

  await assert.rejects(
    finalizePreflight({
      task: {
        id: "task",
        repository: { url: "https://example.invalid/repo.git" },
      },
      preparedRoot,
      error: new Error("install crashed before checks completed"),
    }),
    /install crashed before checks completed/,
  );

  const evidence = JSON.parse(
    await readFile(resolve(preparedRoot, "preflight.json"), "utf8"),
  );
  assert.equal(evidence.ready, false);
  assert.deepEqual(evidence.checks, []);
  assert.equal(
    evidence.failure.message,
    "install crashed before checks completed",
  );
  for (const workspace of workspaces) {
    await assert.rejects(
      readFile(resolve(workspace, "node_modules/pkg/index.js")),
    );
  }
});

test("dependency cleanup failure rewrites successful preflight evidence as failed", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "external-preflight-cleanup-failure-"),
  );
  const preparedRoot = resolve(root, "prepared/task");
  const cleanupError = new Error("simulated dependency cleanup failure");
  const result = {
    schema_version: "1.0",
    task_id: "task",
    repository: { url: "https://example.invalid/repo.git" },
    ready: true,
    checks: [
      {
        name: "oracle-hidden",
        passed: true,
        commands: [{ stdout: "kept stdout", stderr: "kept stderr" }],
      },
    ],
  };
  let receivedWorkspaces;

  await assert.rejects(
    finalizePreflight({
      task: { id: "task", repository: result.repository },
      preparedRoot,
      result,
      runtime: {
        cleanupPreflightInstallations: async (workspaces) => {
          receivedWorkspaces = workspaces;
          throw cleanupError;
        },
      },
    }),
    (error) => error === cleanupError,
  );

  assert.deepEqual(
    receivedWorkspaces,
    ["base-hidden", "oracle-hidden", "clean-ci", "base-suite"].map((name) =>
      resolve(preparedRoot, "preflight", name),
    ),
  );
  const evidence = JSON.parse(
    await readFile(resolve(preparedRoot, "preflight.json"), "utf8"),
  );
  assert.equal(evidence.ready, false);
  assert.deepEqual(evidence.checks, result.checks);
  assert.equal(evidence.failure.name, "Error");
  assert.equal(evidence.failure.message, cleanupError.message);
});

test("runCommand passes validation environment into the isolated WSL shell", async () => {
  const result = await runCommand('test "$EXTERNAL_VALIDATION_PROBE" = bound', {
    env: { EXTERNAL_VALIDATION_PROBE: "bound" },
    timeoutMs: 30_000,
  });

  assert.equal(result.exit_code, 0, result.stderr);
});

test("validation preload materializes only into the neutral verification area", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-validation-env-"));
  const taskRoot = resolve(root, "contract");
  const workspace = resolve(root, "workspace");
  await mkdir(resolve(taskRoot, "validation"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(
    resolve(taskRoot, "validation/domexception-native-error.cjs"),
    "module.exports = {};\n",
  );
  const environment = await materializeValidationEnvironment(
    {
      id: "example-task",
      validation_environment: {
        preload: ["validation/domexception-native-error.cjs"],
      },
    },
    taskRoot,
    workspace,
  );

  assert.match(
    environment.NODE_OPTIONS,
    /\.external-eval\/validation\/preload-0\.cjs$/,
  );
  assert.deepEqual(
    await readdir(resolve(workspace, ".external-eval/validation")),
    ["preload-0.cjs"],
  );
  assert.deepEqual(await readdir(workspace), [".external-eval"]);
});

test("patch safety accepts a focused source fix with additive tests", () => {
  const packageJson = { scripts: { test: "ava", lint: "xo" } };
  const result = analyzePatchSafety({
    status: " M index.js\n?? test/detached.test.js",
    diff: [
      "diff --git a/index.js b/index.js",
      "--- a/index.js",
      "+++ b/index.js",
      "@@ -1 +1 @@",
      "-const value = this();",
      "+const value = generator();",
    ].join("\n"),
    hiddenDestinations: ["test/external-hidden.test.js"],
    baselinePackage: packageJson,
    currentPackage: packageJson,
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.findings, []);
});

test("patch safety fails closed on structural risks", () => {
  const result = analyzePatchSafety({
    status: [
      "D  test/existing.test.js",
      " M package.json",
      " M test/external-hidden.test.js",
      "?? mystery.bin",
    ].join("\n"),
    diff: [
      "diff --git a/test/existing.test.js b/test/existing.test.js",
      "--- a/test/existing.test.js",
      "+++ b/test/existing.test.js",
      "@@ -1,2 +1 @@",
      "-test('keeps behavior', () => {});",
      "-test('keeps errors', () => {});",
      "+test.skip('keeps behavior', () => {});",
      "diff --git a/index.js b/index.js",
      "--- a/index.js",
      "+++ b/index.js",
      "@@ -1 +1 @@",
      "-export const publicName = 1;",
      "+export const renamed = 1;",
    ].join("\n"),
    hiddenDestinations: ["test/external-hidden.test.js"],
    baselinePackage: { scripts: { test: "ava", lint: "xo" } },
    currentPackage: { scripts: { test: "true" } },
  });

  assert.equal(result.status, "fail");
  const codes = new Set(result.findings.map((item) => item.code));
  for (const code of [
    "test-deleted-or-renamed",
    "test-lines-deleted",
    "dependency-manifest-modified",
    "hidden-test-modified",
    "unknown-changed-path",
    "package-scripts-changed",
    "public-api-surface-changed",
  ]) {
    assert.ok(codes.has(code), `missing ${code}`);
  }
});
