import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { format } from "prettier";
import { parse, stringify } from "yaml";
import {
  fixtureContractDigest,
  stableJson,
  validateFixtureContract,
} from "./contract.mjs";
import { integratedGateFixtures, loadIntegratedEvidence } from "./evidence.mjs";

const exec = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");
const fixturesRoot = resolve(import.meta.dirname, "fixtures");
const baselinePath = resolve(import.meta.dirname, "baseline/v1.json");
const integratedEvidencePath = resolve(
  import.meta.dirname,
  "evidence/integrated-gates.json",
);
const resultPath = resolve(import.meta.dirname, "results/v2-current.json");
const reportPath = resolve(import.meta.dirname, "RESULTS.md");
const bundlePath = resolve(
  repoRoot,
  "skills/self-evolution/references/bin/kb.mjs",
);
const skillPath = resolve(repoRoot, "skills/self-evolution/SKILL.md");
const evalPolicyPaths = [
  "SPEC.md",
  "README.md",
  "contract.mjs",
  "evidence.mjs",
  "evidence-check.mjs",
  "evidence/README.md",
  "verify-fixture.mjs",
  "run.mjs",
];
const mode = process.argv[2] ?? "--verify";

if (!["--verify", "--record", "--release"].includes(mode)) {
  process.stderr.write(
    "Usage: node maintainer/evals/run.mjs --verify|--record|--release\n",
  );
  process.exit(2);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileHash(path) {
  return sha256(await readFile(path));
}

async function normalizedFilesHash(root, paths) {
  const input = [];
  for (const path of paths) {
    input.push(
      path,
      "\0",
      (await readFile(resolve(root, path), "utf8")).replace(/\r\n?/g, "\n"),
      "\0",
    );
  }
  return sha256(Buffer.from(input.join("")));
}

async function sourceTreeHash(commit, sourcePath, renames) {
  const { stdout } = await exec(
    "git",
    ["ls-tree", "-r", "--full-tree", commit, sourcePath],
    { cwd: repoRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  const entries = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+)\s+blob\s+([0-9a-f]{40})\t(.+)$/.exec(line);
      if (!match) throw new Error(`Unexpected git ls-tree row: ${line}`);
      const relativePath = match[3].slice(`${sourcePath}/`.length);
      return {
        mode: match[1],
        object: match[2],
        path: renames[relativePath] ?? relativePath,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const input = [];
  const archiveEntries = [];
  for (const entry of entries) {
    const { stdout: bytes } = await exec(
      "git",
      ["cat-file", "blob", entry.object],
      {
        cwd: repoRoot,
        windowsHide: true,
        encoding: "buffer",
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    input.push(entry.path, "\0", entry.mode, "\0", sha256(bytes), "\0");
    archiveEntries.push({ path: entry.path, mode: entry.mode });
  }
  return {
    sha256: sha256(Buffer.from(input.join(""))),
    entries: archiveEntries,
  };
}

async function archiveTreeHash(root, entries) {
  const archiveFiles = await listFiles(root);
  const expectedFiles = entries.map((entry) => entry.path);
  if (stableJson(archiveFiles) !== stableJson(expectedFiles))
    throw new Error(
      "Frozen v1 archive file set does not match its source commit",
    );
  const input = [];
  for (const entry of entries) {
    input.push(
      entry.path,
      "\0",
      entry.mode,
      "\0",
      await fileHash(resolve(root, entry.path)),
      "\0",
    );
  }
  return sha256(Buffer.from(input.join("")));
}

async function archivedBaselineTreeHash(root) {
  const input = [];
  for (const path of await listFiles(root)) {
    input.push(
      path,
      "\0",
      path.endsWith(".sh") ? "100755" : "100644",
      "\0",
      await fileHash(resolve(root, path)),
      "\0",
    );
  }
  return sha256(Buffer.from(input.join("")));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function put(root, path, content) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function listFiles(root) {
  if (!(await exists(root))) return [];
  const result = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        result.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await walk(root);
  return result;
}

async function treeSnapshot(root, excluded = new Set()) {
  const snapshot = {};
  for (const path of await listFiles(root)) {
    if (
      [...excluded].some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      )
    )
      continue;
    snapshot[path] = await fileHash(resolve(root, path));
  }
  return snapshot;
}

async function runKb(root, args, expected = 0) {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [bundlePath, ...args, "--project-root", root, "--format", "json"],
      { cwd: repoRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    if (expected !== 0)
      throw new Error(`Expected exit ${expected}, received 0: ${stdout}`);
    return JSON.parse(stdout || stderr);
  } catch (error) {
    if (error.code !== expected) {
      throw new Error(
        `kb ${args.join(" ")} expected exit ${expected}, received ${error.code}: ${error.stderr || error.stdout || error.message}`,
      );
    }
    return JSON.parse(error.stdout || error.stderr);
  }
}

async function tempProject(label) {
  const root = await mkdtemp(
    resolve(tmpdir(), `self-evolution-eval-${label}-`),
  );
  return root;
}

async function posixShell() {
  if (process.platform !== "win32") return "sh";
  try {
    const { stdout } = await exec("git", ["--exec-path"], {
      windowsHide: true,
    });
    const candidate = resolve(stdout.trim(), "../../..", "bin/bash.exe");
    if (await exists(candidate)) return candidate;
  } catch {
    /* Fall through to the standard Git for Windows location. */
  }
  const candidate = "C:/Program Files/Git/bin/bash.exe";
  if (await exists(candidate)) return candidate;
  throw new Error("A POSIX shell is required to execute the frozen v1 probe");
}

async function loadFixtures() {
  const directories = (await readdir(fixturesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const fixtures = [];
  for (const directory of directories) {
    const root = resolve(fixturesRoot, directory.name);
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    const fixture = JSON.parse(
      await readFile(resolve(root, "fixture.json"), "utf8"),
    );
    validateFixtureContract(fixture, directory.name);
    if (!readme.includes("Provenance:"))
      throw new Error(`${directory.name}: README lacks provenance`);
    fixtures.push({
      ...fixture,
      contract_sha256: fixtureContractDigest(directory.name, fixture, readme),
    });
  }
  const taskClasses = fixtures
    .map((fixture) => fixture.task_class)
    .sort((a, b) => a - b);
  if (
    JSON.stringify(taskClasses) !==
    JSON.stringify(Array.from({ length: 13 }, (_, index) => index + 1))
  )
    throw new Error(
      `Expected task classes 1-13, received ${taskClasses.join(", ")}`,
    );
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length)
    throw new Error("Fixture IDs must be unique");
  return fixtures;
}

async function verifyFixtureSetups(fixtures) {
  const verifierPath = resolve(import.meta.dirname, "verify-fixture.mjs");
  for (const fixture of fixtures) {
    const root = await tempProject(`fixture-${fixture.id}`);
    for (const file of fixture.setup.files)
      await put(root, file.path, file.content);
    let actual = "pass";
    try {
      await exec(process.execPath, [verifierPath, fixture.verifier.entry], {
        cwd: root,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    } catch {
      actual = "fail";
    }
    if (actual !== fixture.verifier.expected_initial_status)
      throw new Error(
        `${fixture.id}: verifier expected ${fixture.verifier.expected_initial_status}, received ${actual}`,
      );
  }
}

async function defaultInitProbe() {
  const root = await tempProject("init");
  const first = await runKb(root, ["init"]);
  const second = await runKb(root, ["init"]);
  const files = await listFiles(root);
  const settings = parse(
    await readFile(resolve(root, ".agents/settings.yaml"), "utf8"),
  );
  const forbidden = files.filter(
    (path) =>
      path.startsWith(".agents/generated/") ||
      path.startsWith(".agents/hooks/") ||
      path.startsWith(".agents/rules/"),
  );
  return {
    pass:
      first.changed === true &&
      second.changed === false &&
      files.length === 3 &&
      forbidden.length === 0 &&
      Object.keys(settings.adapters.active).length === 0,
    created_files: files,
    created_file_count: files.length,
    default_adapter_count: Object.keys(settings.adapters.active).length,
    default_optional_payloads: forbidden,
    repeated_init_changed: second.changed,
  };
}

async function sourceChangeProbe() {
  const root = await tempProject("source");
  await runKb(root, ["init"]);
  await put(root, "src/payments/index.ts", "export const limit = 10;\n");
  const sourcePath = resolve(root, "src/payments/index.ts");
  const baseline = await fileHash(sourcePath);
  await put(
    root,
    ".agents/knowledge/guides/payments.md",
    `---\nkind: guide\nstatus: active\nscope:\n  - "src/payments/**"\nuse_when:\n  - "changing payment limits"\nsources:\n  - path: "src/payments/index.ts"\n    checked_at: "sha256:${baseline}"\n---\n# Payments\n\nThe limit is 10.\n`,
  );
  await runKb(root, ["index"]);
  await put(root, "src/payments/index.ts", "export const limit = 20;\n");
  const checked = await runKb(root, ["check"], 1);
  const codes = checked.diagnostics.map((item) => item.code);
  return {
    pass: codes.includes("SOURCE_CHANGED"),
    diagnostic_codes: codes,
  };
}

async function wrongKnowledgeBoundaryProbe() {
  const root = await tempProject("wrong");
  await runKb(root, ["init"]);
  await put(root, "src/rollout.ts", "export const rollout = 25;\n");
  const source = await fileHash(resolve(root, "src/rollout.ts"));
  await put(
    root,
    ".agents/knowledge/guides/rollout.md",
    `---\nkind: guide\nstatus: active\nscope:\n  - "src/rollout.ts"\nuse_when:\n  - "changing rollout"\nsources:\n  - path: "src/rollout.ts"\n    checked_at: "sha256:${source}"\n---\n# Rollout\n\nThe rollout is 90 percent.\n`,
  );
  await runKb(root, ["index"]);
  const checked = await runKb(root, ["check"]);
  const semanticClaims = checked.diagnostics.filter((item) =>
    ["KNOWLEDGE_WRONG", "CLAIM_INVALID", "SEMANTIC_MISMATCH"].includes(
      item.code,
    ),
  );
  return {
    pass: checked.ok === true && semanticClaims.length === 0,
    deterministic_check_ok: checked.ok,
    semantic_judgment_emitted: semanticClaims.length > 0,
    boundary:
      "Passing deterministic checks does not certify that the Guide's prose is correct.",
  };
}

async function frozenV1InitProbe(baseline) {
  const root = await tempProject("v1-init");
  const script = resolve(repoRoot, baseline.source.init_script_path);
  let exitCode = 0;
  let stderr = "";
  try {
    await exec(
      await posixShell(),
      [
        script,
        "--project-name",
        "v1-baseline-probe",
        "--mode",
        "empty",
        "--project-root",
        root,
      ],
      { cwd: repoRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    exitCode = Number(error.code);
    stderr = error.stderr || "";
  }
  const createdFiles = (await listFiles(root)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const expectedFiles = [...baseline.empty_init.created_files].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  const errorMarkersPresent = baseline.empty_init.observed_error_markers.every(
    (marker) => stderr.toLowerCase().includes(marker.toLowerCase()),
  );
  return {
    observed: true,
    pass:
      exitCode === baseline.empty_init.observed_exit_code &&
      JSON.stringify(createdFiles) === JSON.stringify(expectedFiles) &&
      errorMarkersPresent,
    exit_code: exitCode,
    created_files: createdFiles,
    error_markers_present: errorMarkersPresent,
  };
}

async function adapterProbe() {
  const tools = ["claude-code", "cursor", "opencode", "augment-code"];
  const results = {};
  for (const tool of tools) {
    const root = await tempProject(`adapter-${tool}`);
    await runKb(root, ["init"]);
    const configPath = {
      "claude-code": ".claude/settings.json",
      cursor: ".cursor/hooks.json",
      opencode: ".opencode/opencode.json",
      "augment-code": ".augment/settings.json",
    }[tool];
    const seed =
      tool === "opencode"
        ? {
            provider: { synthetic: { endpoint: "https://example.invalid" } },
            theme: "user-theme",
          }
        : {
            hooks: {
              Stop: [
                {
                  matcher: "",
                  hooks: [{ type: "command", command: "user-owned-hook" }],
                },
              ],
            },
            user_setting: true,
          };
    await put(root, configPath, `${JSON.stringify(seed, null, 2)}\n`);
    const first = await runKb(root, [
      "adapter",
      "install",
      tool,
      "--features",
      "context-recovery,post-task-reminder",
    ]);
    const second = await runKb(root, [
      "adapter",
      "install",
      tool,
      "--features",
      "context-recovery,post-task-reminder",
    ]);
    const downgraded = await runKb(root, [
      "adapter",
      "install",
      tool,
      "--features",
      "context-recovery",
    ]);
    const repeatedDowngrade = await runKb(root, [
      "adapter",
      "install",
      tool,
      "--features",
      "context-recovery",
    ]);
    const status = await runKb(root, ["adapter", "status", tool]);
    const payloads = await listFiles(
      resolve(root, ".agents/generated/adapters", tool),
    );
    const expectedDowngradePayloads = [
      "context-recovery.mjs",
      "features.json",
      ...(tool === "opencode" ? ["opencode-plugin.mjs"] : []),
    ].sort((left, right) => left.localeCompare(right, "en"));
    const sortedPayloads = [...payloads].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    const downgradeApplied =
      downgraded.changed === true &&
      repeatedDowngrade.changed === false &&
      JSON.stringify(sortedPayloads) ===
        JSON.stringify(expectedDowngradePayloads);
    const removed = await runKb(root, ["adapter", "remove", tool]);
    const repeatedRemove = await runKb(root, ["adapter", "remove", tool]);
    const config = JSON.parse(
      await readFile(resolve(root, configPath), "utf8"),
    );
    const unrelatedPreserved =
      tool === "opencode"
        ? config.provider?.synthetic?.endpoint === "https://example.invalid" &&
          config.theme === "user-theme"
        : config.user_setting === true &&
          config.hooks?.Stop?.some((item) =>
            item.hooks?.some((hook) => hook.command === "user-owned-hook"),
          );
    results[tool] = {
      pass:
        first.changed === true &&
        second.changed === false &&
        downgradeApplied &&
        status.ok === true &&
        removed.changed === true &&
        repeatedRemove.changed === false &&
        unrelatedPreserved,
      unrelated_config_preserved: unrelatedPreserved,
      repeated_install_changed: second.changed,
      downgrade_applied: downgradeApplied,
      downgrade_payloads: sortedPayloads,
      repeated_downgrade_changed: repeatedDowngrade.changed,
      repeated_remove_changed: repeatedRemove.changed,
    };
  }
  return {
    pass: Object.values(results).every((result) => result.pass),
    tools: results,
  };
}

async function migrationProbe() {
  const root = await tempProject("migration");
  const agents = "# Old agents\r\n";
  await put(root, "AGENTS.md", agents);
  await put(root, "src/payments/index.ts", "export const amount = 1;\r\n");
  await put(
    root,
    "src/reference/config.ts",
    "export const region = 'test';\r\n",
  );
  await put(root, "src/patterns/retry.ts", "export const retries = 2;\r\n");
  await put(root, "src/decision/cache.ts", "export const shared = true;\r\n");
  await put(root, "ops/runbook.sh", "#!/bin/sh\r\nexit 0\r\n");
  await put(
    root,
    ".agents/rules/payments.md",
    "Read payments knowledge before changing payments.\r\n",
  );
  await put(
    root,
    ".agents/hooks/custom.sh",
    "#!/bin/sh\r\necho user-owned-hook\r\n",
  );
  const knowledgeFiles = {
    ".agents/knowledge/domains/payments.md":
      '---\r\ntype: domain\r\nconfidence: observed\r\nscope: ["src/payments/**"]\r\n---\r\n# Payments\r\n\r\nOld knowledge.\r\n',
    ".agents/knowledge/reference/config.md":
      '---\r\ntype: reference\r\nconfidence: observed\r\nscope: ["src/reference/**"]\r\n---\r\n# Config map\r\n\r\nOld reference.\r\n',
    ".agents/knowledge/patterns/retry.md":
      '---\r\ntype: pattern\r\nconfidence: verified\r\nscope: ["src/patterns/**"]\r\n---\r\n# Retry pattern\r\n\r\nOld pattern.\r\n',
    ".agents/knowledge/crystallized/deploy.md":
      '---\r\ntype: crystallized\r\nconfidence: observed\r\nscope: ["ops/**"]\r\n---\r\n# Deploy runbook\r\n\r\nOld runbook.\r\n',
    ".agents/knowledge/decisions/shared-cache.md":
      '---\r\nkind: decision\r\nid: shared-cache\r\nstatus: accepted\r\ndate: 2026-01-01\r\nscope: ["src/decision/**"]\r\nsupersedes: null\r\n---\r\n# Shared cache\r\n\r\nUse shared authority.\r\n',
    ".agents/knowledge/inbox/2026-01.md":
      "# Inbox\r\n\r\nPotential durable observation.\r\n",
    ".agents/knowledge/archive/retired.md": "# Retired v1 knowledge\r\n",
    ".agents/knowledge/SKILL-LOCAL.md": "# Local v1 policy\r\n",
    ".agents/knowledge/manifest.json":
      '{\r\n  "schema_version": "1.0",\r\n  "health": { "score": 80 }\r\n}\r\n',
  };
  for (const [path, content] of Object.entries(knowledgeFiles))
    await put(root, path, content);
  const excluded = new Set([".agents/.migrations", ".agents/legacy"]);
  const before = await treeSnapshot(root, excluded);
  const prepared = await runKb(root, ["migrate", "prepare"]);
  const repeatedPrepare = await runKb(root, ["migrate", "prepare"]);
  const runId = prepared.data.run_id;
  const planPath = resolve(root, prepared.data.plan);
  const plan = parse(await readFile(planPath, "utf8"));
  const tracePath = resolve(
    root,
    ".agents/.migrations",
    prepared.data.run_id,
    "traceability.yaml",
  );
  const trace = parse(await readFile(tracePath, "utf8"));
  const sourceFiles = [...plan.source_files].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const tracedSources = trace.mappings
    .map((item) => item.source)
    .sort((left, right) => left.localeCompare(right, "en"));
  const traceCoverageExact =
    JSON.stringify(sourceFiles) === JSON.stringify(tracedSources) &&
    new Set(tracedSources).size === tracedSources.length;
  const reviewById = new Map(
    plan.semantic_review.map((item) => [item.id, item]),
  );
  const traceReviewLinksValid = trace.mappings.every(
    (item) =>
      (item.review_id === null &&
        item.disposition !== "semantic review required") ||
      (typeof item.review_id === "string" &&
        item.disposition === "semantic review required" &&
        reviewById.get(item.review_id)?.source === item.source &&
        reviewById.get(item.review_id)?.proposed === item.proposed),
  );
  plan.agents_approved = true;
  for (const item of plan.semantic_review) {
    item.disposition = "preserve";
    item.resolved = true;
  }
  await writeFile(planPath, stringify(plan, { lineWidth: 0 }), "utf8");
  const applied = await runKb(root, ["migrate", "apply", runId]);
  const archivedRule = await readFile(
    resolve(root, ".agents/knowledge/archive/v1/rules/payments.md"),
    "utf8",
  );
  const archivedHook = await readFile(
    resolve(root, ".agents/knowledge/archive/v1/hooks/custom.sh"),
    "utf8",
  );
  const appliedTraceMatches =
    archivedRule.replace(/\r\n?/g, "\n") ===
      "Read payments knowledge before changing payments.\n" &&
    archivedHook.replace(/\r\n?/g, "\n") ===
      "#!/bin/sh\necho user-owned-hook\n";
  const repeatedApply = await runKb(root, ["migrate", "apply", runId]);
  const rolledBack = await runKb(root, ["migrate", "rollback", runId]);
  const repeatedRollback = await runKb(root, ["migrate", "rollback", runId]);
  const after = await treeSnapshot(root, excluded);
  const restored = JSON.stringify(after) === JSON.stringify(before);
  return {
    pass:
      prepared.changed === true &&
      repeatedPrepare.changed === false &&
      applied.changed === true &&
      repeatedApply.changed === false &&
      rolledBack.changed === true &&
      repeatedRollback.changed === false &&
      traceCoverageExact &&
      traceReviewLinksValid &&
      appliedTraceMatches &&
      restored,
    input_snapshot_sha256: sha256(Buffer.from(stableJson(before))),
    rollback_snapshot_sha256: sha256(Buffer.from(stableJson(after))),
    rollback_project_input_snapshot_restored: restored,
    trace_source_count: tracedSources.length,
    trace_coverage_exact: traceCoverageExact,
    trace_review_links_valid: traceReviewLinksValid,
    applied_trace_matches: appliedTraceMatches,
    repeated_prepare_changed: repeatedPrepare.changed,
    repeated_apply_changed: repeatedApply.changed,
    repeated_rollback_changed: repeatedRollback.changed,
  };
}

function evidenceGate(integratedEvidence, id, pendingEvidence, judge) {
  const recorded = integratedEvidence.gates[id];
  return recorded
    ? gate(id, recorded.status, recorded.evidence, judge)
    : gate(id, "pending", pendingEvidence, judge);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function reductionGate(
  integratedEvidence,
  id,
  field,
  minimumReduction,
  pendingEvidence,
  judge,
  aggregate = average,
) {
  const recorded = integratedEvidence.gates[id];
  if (!recorded) return gate(id, "pending", pendingEvidence, judge);
  if (recorded.status !== "pass")
    return gate(id, recorded.status, recorded.evidence, judge);
  const runs = recorded.validated_runs ?? [];
  const expectedFixtureIds = integratedGateFixtures.get(id) ?? [];
  const pairValues = [];
  for (const fixtureId of expectedFixtureIds)
    for (const attempt of [1, 2, 3]) {
      const pair = {};
      for (const version of ["v1", "v2"]) {
        const run = runs.find(
          (item) =>
            item.version === version &&
            item.fixture_id === fixtureId &&
            item.attempt === attempt,
        );
        const measurement = run?.measurements[field];
        if (
          !run ||
          run.execution.status !== "completed" ||
          measurement?.status !== "measured"
        )
          return gate(
            id,
            "blocked",
            `All three completed v1/v2 pairs for every fixture require measured ${field}.`,
            judge,
          );
        pair[version] = measurement.value;
      }
      pairValues.push({ fixture_id: fixtureId, attempt, ...pair });
    }
  const v1 = pairValues.map((pair) => pair.v1);
  const v2 = pairValues.map((pair) => pair.v2);
  if (v1.length === 0 || aggregate(v1) <= 0)
    return gate(
      id,
      "blocked",
      `Comparable ${field} measurements are unavailable for a program-derived threshold.`,
      judge,
    );
  const v1Value = aggregate(v1);
  const v2Value = aggregate(v2);
  const reduction = 1 - v2Value / v1Value;
  return gate(
    id,
    reduction >= minimumReduction ? "pass" : "fail",
    `${field}: ${v1Value.toFixed(1)} -> ${v2Value.toFixed(1)} (${(reduction * 100).toFixed(1)}% reduction; minimum ${(minimumReduction * 100).toFixed(0)}%)`,
    judge,
  );
}

function lowValueCaptureGate(integratedEvidence) {
  const id = "low-value-capture";
  const judge = "program-plus-blinded-review";
  const recorded = integratedEvidence.gates[id];
  if (!recorded)
    return gate(
      id,
      "pending",
      "Three-run v1/v2 Capture judgments have not been recorded.",
      judge,
    );
  if (recorded.status !== "pass")
    return gate(id, recorded.status, recorded.evidence, judge);
  const runs = recorded.validated_runs ?? [];
  for (const fixtureId of integratedGateFixtures.get(id) ?? []) {
    const pairs = [];
    for (const attempt of [1, 2, 3]) {
      const values = {};
      for (const version of ["v1", "v2"]) {
        const run = runs.find(
          (item) =>
            item.version === version &&
            item.fixture_id === fixtureId &&
            item.attempt === attempt,
        );
        const measurement = run?.measurements.low_value_captures;
        if (
          !run ||
          run.execution.status !== "completed" ||
          measurement?.status !== "measured"
        )
          return gate(
            id,
            "blocked",
            "Every fixture requires three completed v1/v2 pairs with measured low-value Capture counts.",
            judge,
          );
        values[version] = measurement.value;
      }
      if (values.v2 > values.v1)
        return gate(
          id,
          "fail",
          `${fixtureId} attempt ${attempt} increased low-value Capture (${values.v1} -> ${values.v2}).`,
          judge,
        );
      pairs.push(values);
    }
    const baseline = pairs.reduce((sum, pair) => sum + pair.v1, 0);
    const treatment = pairs.reduce((sum, pair) => sum + pair.v2, 0);
    if (
      (baseline === 0 && treatment !== 0) ||
      (baseline > 0 && 2 * treatment > baseline)
    )
      return gate(
        id,
        "fail",
        `${fixtureId} low-value Capture total ${baseline} -> ${treatment}; each fixture must reduce by at least 50%.`,
        judge,
      );
  }
  return gate(
    id,
    "pass",
    "Every fixture has three non-worsening pairs and at least 50% total low-value Capture reduction.",
    judge,
  );
}

async function migrationInputChangedProbe() {
  const root = await tempProject("migration-input-changed");
  await put(root, "AGENTS.md", "# Old agents\n");
  await put(root, "src/payments/index.ts", "export const amount = 1;\n");
  await put(
    root,
    ".agents/knowledge/domains/payments.md",
    '---\ntype: domain\nconfidence: observed\nscope: ["src/payments/**"]\n---\n# Payments\n\nOld knowledge.\n',
  );
  const prepared = await runKb(root, ["migrate", "prepare"]);
  const planPath = resolve(root, prepared.data.plan);
  const plan = parse(await readFile(planPath, "utf8"));
  plan.agents_approved = true;
  for (const item of plan.semantic_review) {
    item.disposition = "preserve";
    item.resolved = true;
  }
  await writeFile(planPath, stringify(plan, { lineWidth: 0 }), "utf8");
  await put(
    root,
    ".agents/knowledge/domains/payments.md",
    '---\ntype: domain\nconfidence: observed\nscope: ["src/payments/**"]\n---\n# Payments\n\nChanged after prepare.\n',
  );
  const result = await runKb(
    root,
    ["migrate", "apply", prepared.data.run_id],
    3,
  );
  const codes = result.diagnostics.map((item) => item.code);
  return {
    pass: codes.includes("MIGRATION_INPUT_CHANGED"),
    diagnostic_codes: codes,
  };
}

async function malformedMigrationProbe() {
  const root = await tempProject("migration-malformed");
  await put(root, "AGENTS.md", "# Old agents\n");
  await put(
    root,
    ".agents/knowledge/domains/broken.md",
    "---\ntype: domain\nscope: [\n---\n# Broken\n",
  );
  const result = await runKb(root, ["migrate", "prepare"], 2);
  const codes = result.diagnostics.map((item) => item.code);
  return {
    pass: codes.includes("MIGRATION_V1_INVALID"),
    diagnostic_codes: codes,
  };
}

async function artifactFacts(baseline, probes) {
  const skill = (await readFile(skillPath, "utf8")).replace(/\r\n?/g, "\n");
  const lines =
    skill === ""
      ? 0
      : skill.split("\n").length - (skill.endsWith("\n") ? 1 : 0);
  const initializedReduction =
    1 -
    probes.default_init.created_file_count /
      baseline.empty_init.created_file_count;
  return {
    version: JSON.parse(
      await readFile(resolve(repoRoot, "package.json"), "utf8"),
    ).version,
    skill: {
      path: "skills/self-evolution/SKILL.md",
      sha256: sha256(Buffer.from(skill)),
      lines,
      utf8_bytes: Buffer.byteLength(skill),
    },
    bundle: {
      path: "skills/self-evolution/references/bin/kb.mjs",
      sha256: await fileHash(bundlePath),
    },
    empty_init: {
      created_file_count: probes.default_init.created_file_count,
      reduction_vs_v1: Number(initializedReduction.toFixed(6)),
      created_files: probes.default_init.created_files,
    },
  };
}

function gate(id, status, evidence, judge) {
  return { id, status, evidence, judge };
}

function buildGates(baseline, artifact, probes, integratedEvidence) {
  const initReductionPass = artifact.empty_init.reduction_vs_v1 >= 0.5;
  return [
    gate(
      "skill-lines",
      artifact.skill.lines <= 450 ? "pass" : "fail",
      `${artifact.skill.lines} lines; maximum 450`,
      "program",
    ),
    gate(
      "initialized-file-count",
      initReductionPass ? "pass" : "fail",
      `${baseline.empty_init.created_file_count} -> ${artifact.empty_init.created_file_count} files (${(artifact.empty_init.reduction_vs_v1 * 100).toFixed(1)}% reduction)`,
      "program",
    ),
    reductionGate(
      integratedEvidence,
      "initialization-protocol-tokens",
      "input_tokens",
      0.4,
      "Exact, versioned tokenizer counts for the complete v1 and v2 onboarding protocols have not been recorded.",
      "program-plus-maintainer",
    ),
    reductionGate(
      integratedEvidence,
      "metadata-writes",
      "metadata_writes",
      0.6,
      "Integrated task transcripts are required to count task-time metadata writes.",
      "program-plus-maintainer",
    ),
    lowValueCaptureGate(integratedEvidence),
    reductionGate(
      integratedEvidence,
      "irrelevant-context",
      "irrelevant_context_bytes",
      0.25,
      "Three-run selected-context records have not been recorded.",
      "program-plus-blinded-review",
      median,
    ),
    evidenceGate(
      integratedEvidence,
      "retrieval-and-task-quality",
      "Frozen v1 and v2 model runs plus blinded judgments are missing.",
      "blinded-review",
    ),
    evidenceGate(
      integratedEvidence,
      "no-capture-write-free",
      "The fixture contract is executable, but three v1 and v2 routine-task runs must prove that the agent completes the task without writing project knowledge.",
      "program-plus-blinded-review",
    ),
    gate(
      "source-change-detection",
      probes.source_change.pass ? "pass" : "fail",
      `SOURCE_CHANGED emitted: ${probes.source_change.pass}`,
      "program",
    ),
    evidenceGate(
      integratedEvidence,
      "wrong-knowledge-detection",
      "The deterministic boundary probe confirms that kb check does not judge prose correctness; three integrated model runs must prove that wrong knowledge is detected and not acted upon.",
      "model-plus-blinded-review",
    ),
    evidenceGate(
      integratedEvidence,
      "high-risk-material-verification",
      "Migration safety is probed, but three integrated high-risk agent runs are not recorded.",
      "model-plus-blinded-review",
    ),
    gate(
      "migration-input-accounting",
      probes.migration.trace_coverage_exact &&
        probes.migration.trace_review_links_valid &&
        probes.migration.applied_trace_matches &&
        probes.migration_input_changed.pass &&
        probes.migration_malformed.pass
        ? "pass"
        : "fail",
      `Exact input-to-trace coverage: ${probes.migration.trace_coverage_exact}; semantic review links valid: ${probes.migration.trace_review_links_valid}; applied rule/Hook bytes match reviewed targets: ${probes.migration.applied_trace_matches}; changed and malformed inputs are refused before apply.`,
      "program",
    ),
    gate(
      "migration-rollback-identity",
      probes.migration.pass &&
        probes.migration_input_changed.pass &&
        probes.migration_malformed.pass
        ? "pass"
        : "fail",
      `Complete pre-migration project snapshot restored: ${probes.migration.rollback_project_input_snapshot_restored}; changed input and malformed v1 are refused`,
      "program",
    ),
    evidenceGate(
      integratedEvidence,
      "migration-semantic-preservation",
      "Applied-state traceability and semantic preservation require a reviewed migration corpus; rollback identity does not prove them.",
      "maintainer-review",
    ),
    gate(
      "cli-and-adapter-idempotency",
      probes.default_init.pass && probes.adapter.pass && probes.migration.pass
        ? "pass"
        : "fail",
      "Repeated init/install/remove/prepare/apply/rollback operations are unchanged.",
      "program",
    ),
    gate(
      "default-adapters-off",
      probes.default_init.pass ? "pass" : "fail",
      `${probes.default_init.default_adapter_count} active adapters and ${probes.default_init.default_optional_payloads.length} optional payloads after init`,
      "program",
    ),
    gate(
      "removed-v1-default-mechanisms",
      probes.default_init.pass ? "pass" : "fail",
      "Default v2 init contains AGENTS.md, settings.yaml, and index.yaml only; no hooks, rules, manifest, counters, or confidence state.",
      "program-plus-code-review",
    ),
  ];
}

async function buildResult() {
  const fixtures = await loadFixtures();
  await verifyFixtureSetups(fixtures);
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const archiveRoot = resolve(repoRoot, baseline.source.archive_root);
  if (
    (await archivedBaselineTreeHash(archiveRoot)) !==
    baseline.source.archive_tree_sha256
  )
    throw new Error("Frozen v1 archive tree does not match baseline/v1.json");
  if (await exists(resolve(repoRoot, ".git"))) {
    const sourceTree = await sourceTreeHash(
      baseline.source.source_commit_sha,
      baseline.source.source_tree_path,
      baseline.source.renames,
    );
    const archiveTreeDigest = await archiveTreeHash(
      archiveRoot,
      sourceTree.entries,
    );
    if (
      sourceTree.sha256 !== baseline.source.archive_tree_sha256 ||
      archiveTreeDigest !== baseline.source.archive_tree_sha256
    )
      throw new Error(
        "Frozen v1 archive tree does not match its source commit or baseline/v1.json",
      );
  }
  if (
    sha256(
      Buffer.from(
        (
          await readFile(resolve(repoRoot, baseline.source.skill_path), "utf8")
        ).replace(/\r\n?/g, "\n"),
      ),
    ) !== baseline.source.skill_sha256
  )
    throw new Error("Frozen v1 SKILL.md hash does not match baseline/v1.json");
  if (
    sha256(
      Buffer.from(
        (
          await readFile(
            resolve(repoRoot, baseline.source.init_script_path),
            "utf8",
          )
        ).replace(/\r\n?/g, "\n"),
      ),
    ) !== baseline.source.init_script_sha256
  )
    throw new Error(
      "Frozen v1 init script hash does not match baseline/v1.json",
    );

  const fixtureContracts = fixtures.map((fixture) => ({
    id: fixture.id,
    sha256: fixture.contract_sha256,
  }));
  const suiteVersion = "2.0.0-rc.1";
  const currentSkillHash = sha256(
    Buffer.from((await readFile(skillPath, "utf8")).replace(/\r\n?/g, "\n")),
  );
  const currentBundleHash = await fileHash(bundlePath);
  const evalContractHash = await normalizedFilesHash(
    import.meta.dirname,
    evalPolicyPaths,
  );
  const integratedEvidence = await loadIntegratedEvidence(
    integratedEvidencePath,
    import.meta.dirname,
    fixtures,
    {
      suite_version: suiteVersion,
      baseline_sha256: sha256(Buffer.from(stableJson(baseline))),
      v2_skill_sha256: currentSkillHash,
      v2_bundle_sha256: currentBundleHash,
      v1_subject_sha256: baseline.source.archive_tree_sha256,
      fixture_contracts_sha256: sha256(
        Buffer.from(stableJson(fixtureContracts)),
      ),
      eval_contract_sha256: evalContractHash,
    },
  );

  const probes = {
    default_init: await defaultInitProbe(),
    frozen_v1_init: await frozenV1InitProbe(baseline),
    source_change: await sourceChangeProbe(),
    wrong_knowledge_boundary: await wrongKnowledgeBoundaryProbe(),
    adapter: await adapterProbe(),
    migration: await migrationProbe(),
    migration_input_changed: await migrationInputChangedProbe(),
    migration_malformed: await malformedMigrationProbe(),
  };
  const artifact = await artifactFacts(baseline, probes);
  const gates = buildGates(baseline, artifact, probes, integratedEvidence);
  const v1InitGate = gates.find((item) => item.id === "initialized-file-count");
  if (v1InitGate && !probes.frozen_v1_init.pass) {
    v1InitGate.status = "fail";
    v1InitGate.evidence =
      "Frozen v1 initializer no longer matches its recorded output and exit behavior.";
  }
  return {
    schema_version: "1.0",
    suite_version: suiteVersion,
    artifact,
    fixture_count: fixtures.length,
    fixture_ids: fixtures.map((fixture) => fixture.id),
    fixture_contracts: fixtureContracts,
    eval_contract_sha256: evalContractHash,
    integrated_evidence_sha256: integratedEvidence.sha256,
    deterministic_probes: probes,
    gates,
    summary: {
      pass: gates.filter((item) => item.status === "pass").length,
      fail: gates.filter((item) => item.status === "fail").length,
      pending: gates.filter((item) => item.status === "pending").length,
      blocked: gates.filter((item) => item.status === "blocked").length,
      release_ready: gates.every((item) => item.status === "pass"),
    },
  };
}

function markdown(result) {
  const lines = [
    "# Current v2 Evaluation Results",
    "",
    `Artifact: \`${result.artifact.version}\``,
    `Bundle SHA-256: \`${result.artifact.bundle.sha256}\``,
    `Fixtures: ${result.fixture_count}/13`,
    `Release ready: **${result.summary.release_ready ? "yes" : "no"}**`,
    "",
    "| Gate | State | Judge | Evidence |",
    "|---|---|---|---|",
    ...result.gates.map(
      (item) =>
        `| ${item.id} | ${item.status} | ${item.judge} | ${item.evidence.replaceAll("|", "\\|")} |`,
    ),
    "",
    "## Interpretation",
    "",
    "Deterministic probes establish artifact and safety facts only. Pending gates",
    "require the frozen three-run v1/v2 task evidence and blinded judgments defined",
    "in `README.md`; they are release blockers, not assumed passes.",
    "",
  ];
  return lines.join("\n");
}

const result = await buildResult();
const serialized = await format(stableJson(result), { parser: "json" });
const rendered = await format(markdown(result), { parser: "markdown" });

if (mode === "--record") {
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, serialized, "utf8");
  await writeFile(reportPath, rendered, "utf8");
} else {
  if (!(await exists(resultPath)) || !(await exists(reportPath))) {
    throw new Error("Recorded eval results are missing. Run with --record.");
  }
  const recorded = await readFile(resultPath, "utf8");
  const recordedReport = await readFile(reportPath, "utf8");
  if (recorded !== serialized || recordedReport !== rendered)
    throw new Error(
      "Recorded eval results are stale. Run with --record and review the diff.",
    );
}

process.stdout.write(
  `${rendered}Summary: ${result.summary.pass} pass, ${result.summary.fail} fail, ${result.summary.pending} pending, ${result.summary.blocked} blocked.\n`,
);

if (result.summary.fail > 0 || result.summary.blocked > 0) process.exitCode = 1;
if (mode === "--release" && !result.summary.release_ready) process.exitCode = 1;
