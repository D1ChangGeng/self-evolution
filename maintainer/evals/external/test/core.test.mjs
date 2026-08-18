import assert from "node:assert/strict";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import {
  aggregateCampaign,
  assertNoVersionLeak,
  assertSafeRelativePath,
  createSchedule,
  campaignGateStatus,
  expectedCoverage,
  evidencePhase,
  hardCorrect,
  initialState,
  loadTaskSpecs,
  markReviewSchemaInvalid,
  normalizeTaskSpec,
  reviewSealDigest,
  sealReviews,
  sha256,
  stableJson,
  transitionState,
  validateOnboardingEvidence,
  validateWorkspaceEditEvidence,
  validateStateChain,
  validateVerdict,
  validateVerdictAgainstRuns,
  verificationArtifactBindingDigest,
  verificationEvidence,
  verifyChecksums,
  writeChecksums,
} from "../lib/core.mjs";
import {
  isReviewSchemaError,
  FORMAL_CAMPAIGN_PROTOCOL,
  FORMAL_TASK_IDS,
  expectedRunBindings,
  parseCli,
  prepareCampaign,
  requireExplicitCampaignOption,
  runUnit,
  selectedUnits,
  validateCampaignId,
  validateSmokeGate,
  validateFormalCampaignProtocol,
} from "../lib/campaign.mjs";
import {
  PINNED_WSL_TOOLCHAIN,
  verifyPinnedToolchain,
} from "../lib/prepare.mjs";
import { collectWorkspaceManifest } from "../lib/collector.mjs";

const task = {
  schema_version: "1.0",
  id: "example-task",
  title: "Example",
  toolchain: { node: "22.13.1", npm: "10.9.2" },
  repository: {
    url: "https://example.invalid/project.git",
    base_sha: "1".repeat(40),
    oracle_sha: "2".repeat(40),
    license: "MIT",
  },
  prompt: { onboarding: "Onboard this project.", repair: "Repair the defect." },
  install: {
    lockfile_mode: "generate",
    generation_commands: ["npm install --package-lock-only"],
    commands: ["npm ci"],
  },
  validation: Object.fromEntries(
    [
      "base_should_fail",
      "oracle_should_pass",
      "base_suite",
      "clean_ci",
      "focused",
      "full",
    ].map((name) => [name, ["npm test"]]),
  ),
  validation_environment: { preload: ["validation/preload.cjs"] },
  hidden_tests: [{ source: "hidden/test.js", destination: "test/hidden.js" }],
};

function armScores(overrides = {}) {
  return {
    correctness: "pass",
    regression_safety: "pass",
    scope_discipline: 3,
    knowledge_retrieval_credibility: 3,
    capture_value: 3,
    test_evidence: 3,
    final_delivery: 3,
    ...overrides,
  };
}

test("task contract accepts extensions and rejects traversal", () => {
  const normalized = normalizeTaskSpec(task, task.id);
  assert.equal(normalized.title, "Example");
  assert.deepEqual(normalized.validation_environment.preload, [
    "validation/preload.cjs",
  ]);
  assert.throws(
    () =>
      normalizeTaskSpec(
        {
          ...task,
          hidden_tests: [{ source: "../oracle.js", destination: "test/x.js" }],
        },
        task.id,
      ),
    /safe POSIX-style relative path/,
  );
  assert.throws(
    () =>
      normalizeTaskSpec(
        {
          ...task,
          validation_environment: { preload: ["../preload.cjs"] },
        },
        task.id,
      ),
    /safe POSIX-style relative path/,
  );
  assert.throws(() => assertSafeRelativePath("C:\\secret"), /safe POSIX/);
});

test("task loading binds validation preload bytes into the contract", async () => {
  const tasksRoot = await mkdtemp(resolve(tmpdir(), "external-task-contract-"));
  const sourceRoot = resolve(
    "maintainer/evals/external/tasks/p-limit-detached-map",
  );
  const targetRoot = resolve(tasksRoot, "p-limit-detached-map");
  await cp(sourceRoot, targetRoot, { recursive: true });

  const [before] = await loadTaskSpecs(tasksRoot);
  const preloadPath = resolve(
    targetRoot,
    "validation/domexception-native-error.cjs",
  );
  await writeFile(preloadPath, `${await readFile(preloadPath, "utf8")}\n`);
  const [after] = await loadTaskSpecs(tasksRoot);

  assert.notEqual(before.contract_sha256, after.contract_sha256);
  const taskJsonPath = resolve(targetRoot, "task.json");
  const taskJson = JSON.parse(await readFile(taskJsonPath, "utf8"));
  await writeFile(
    taskJsonPath,
    stableJson({
      ...taskJson,
      validation_environment: { preload: ["validation/missing.cjs"] },
    }),
  );
  await assert.rejects(
    loadTaskSpecs(tasksRoot),
    /must name an existing regular file/,
  );
});

test("schedule has balanced opaque arms and no public version mapping", () => {
  const schedule = createSchedule(
    ["a-task", "b-task"],
    "campaign-1",
    Buffer.alloc(32, 7),
  );
  assert.equal(schedule.public.units.length, 12);
  assert.equal(
    new Set(schedule.public.units.map((unit) => unit.blind_label)).size,
    12,
  );
  assert.ok(schedule.public.units.every((unit) => !("version" in unit)));
  for (const unit of schedule.public.units) {
    assert.match(unit.blind_label, /^arm-[0-9a-f]{12}$/);
    assert.ok(["v1", "v2"].includes(schedule.sealed.mapping[unit.blind_label]));
  }
  assert.equal(
    schedule.sealed.schedule_sha256,
    sha256(stableJson(schedule.public)),
  );
});

test("campaign selectors reject invalid or empty filters and review single arms", () => {
  const schedule = createSchedule(
    ["alpha"],
    "campaign-selectors",
    Buffer.alloc(32, 6),
  );
  assert.equal(selectedUnits(schedule.public, schedule.sealed, {}).length, 6);
  assert.throws(
    () => selectedUnits(schedule.public, schedule.sealed, { task: "missing" }),
    /unknown task/,
  );
  assert.throws(
    () => selectedUnits(schedule.public, schedule.sealed, { task: "" }),
    /unknown task/,
  );
  assert.throws(
    () => selectedUnits(schedule.public, schedule.sealed, { attempt: "4" }),
    /one of 1, 2, or 3/,
  );
  assert.throws(
    () => selectedUnits(schedule.public, schedule.sealed, { attempt: true }),
    /one of 1, 2, or 3/,
  );
  assert.throws(
    () => selectedUnits(schedule.public, schedule.sealed, { attempt: "" }),
    /one of 1, 2, or 3/,
  );
  assert.throws(
    () =>
      selectedUnits(schedule.public, schedule.sealed, {
        arm: "arm-000000000000",
      }),
    /unknown opaque arm/,
  );
  assert.throws(
    () => selectedUnits(schedule.public, schedule.sealed, { arm: "" }),
    /unknown opaque arm/,
  );
  assert.throws(
    () =>
      selectedUnits(
        schedule.public,
        schedule.sealed,
        { arm: schedule.public.units[0].blind_label },
        { review: true },
      ),
    /requires both arms/,
  );
});

test("state transitions are resumable and completed work cannot regress", () => {
  const schedule = createSchedule(
    ["a-task"],
    "campaign-1",
    Buffer.alloc(32, 8),
  );
  const state = initialState(schedule.public);
  const unit = schedule.public.units[0];
  transitionState(state, { unit: unit.id, phase: "onboarding" }, "running");
  transitionState(state, { unit: unit.id, phase: "onboarding" }, "completed");
  assert.equal(state.units[unit.id].phases.onboarding.attempts, 1);
  assert.throws(
    () =>
      transitionState(state, { unit: unit.id, phase: "onboarding" }, "failed"),
    /cannot be downgraded/,
  );
  const other = schedule.public.units[1];
  transitionState(state, { unit: other.id, phase: "onboarding" }, "running");
  assert.throws(
    () =>
      transitionState(
        state,
        { unit: other.id, phase: "onboarding" },
        "running",
      ),
    /cannot be restarted/,
  );
});

test("run phase exceptions become structured terminal failures", async () => {
  const schedule = createSchedule(
    ["alpha"],
    "campaign-run-failure",
    Buffer.alloc(32, 2),
  );
  const unit = {
    ...schedule.public.units[0],
    version: schedule.sealed.mapping[schedule.public.units[0].blind_label],
  };
  const state = initialState(schedule.public);
  const campaignRoot = await mkdtemp(
    resolve(tmpdir(), "external-eval-run-failure-"),
  );
  const executionBase = await mkdtemp(
    resolve(tmpdir(), "external-eval-run-failure-execution-"),
  );
  const executionRoot = resolve(executionBase, "campaign-run-failure");
  const workspaceDir = resolve(
    executionRoot,
    "units",
    "alpha",
    String(unit.attempt),
    unit.blind_label,
  );
  await mkdir(resolve(campaignRoot, "prepared/alpha/base"), {
    recursive: true,
  });
  await mkdir(
    resolve(campaignRoot, `subjects/${unit.version}/self-evolution`),
    {
      recursive: true,
    },
  );
  const preparedRoot = resolve(campaignRoot, "prepared/alpha/base");
  await writeFile(resolve(preparedRoot, "package.json"), '{"name":"x"}\n');
  await writeFile(
    resolve(preparedRoot, "package-lock.json"),
    '{"name":"x","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x"}}}\n',
  );
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "-q"], { cwd: preparedRoot });
  execFileSync("git", ["config", "user.name", "external eval test"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["config", "user.email", "eval@example.invalid"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["add", "package.json"], { cwd: preparedRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: preparedRoot });
  await cp(preparedRoot, workspaceDir, { recursive: true });
  state.units[unit.id].phases.onboarding.status = "completed";
  const taskValue = {
    id: "alpha",
    contract_root: resolve(campaignRoot, "contracts/alpha"),
    prompt: { onboarding: "onboard", repair: "repair" },
  };
  const executor = {
    async prepareExecutionEnvironment() {},
    async runPhase() {
      throw new Error("provider exploded");
    },
    async collectRunEvidence({
      campaign,
      unit: selected,
      phase,
      workspaceDir,
    }) {
      const workspaceManifest = await import("../lib/collector.mjs").then(
        ({ collectWorkspaceManifest }) =>
          collectWorkspaceManifest(workspaceDir),
      );
      return {
        schema_version: "1.0",
        campaign_id: campaign.campaign_id,
        task_id: selected.task_id,
        attempt: selected.attempt,
        blind_label: selected.blind_label,
        phase,
        usage: { status: "not-measured", value: null },
        execution: { duration_ms: null },
        selected_context: [],
        knowledge_diff: [],
        capture: [],
      };
    },
  };
  await assert.doesNotReject(
    runUnit({
      repositoryRoot: campaignRoot,
      campaignRoot,
      campaign: {
        campaign_id: "campaign-run-failure",
        execution_model: "provider/model",
        execution_root: executionRoot,
      },
      state,
      unit,
      task: taskValue,
      executor,
      executionRoot,
    }),
  );
  assert.equal(state.units[unit.id].phases.repair.status, "failed");
  const unitRoot = resolve(
    campaignRoot,
    "runs",
    "alpha",
    String(unit.attempt),
    unit.blind_label,
  );
  const result = JSON.parse(
    await readFile(resolve(unitRoot, "repair/result.json"), "utf8"),
  );
  const runArtifact = JSON.parse(
    await readFile(resolve(unitRoot, "run.json"), "utf8"),
  );
  assert.equal(result.status, "failed");
  assert.equal(runArtifact.failure.reason, "phase-execution-exception");
});

test("runUnit passes the frozen task contract into both model phases", async () => {
  const schedule = createSchedule(
    ["alpha"],
    "campaign-task-forwarding",
    Buffer.alloc(32, 12),
  );
  const unit = {
    ...schedule.public.units[0],
    version: schedule.sealed.mapping[schedule.public.units[0].blind_label],
  };
  const state = initialState(schedule.public);
  const campaignRoot = await mkdtemp(
    resolve(tmpdir(), "external-eval-task-forwarding-"),
  );
  const executionBase = await mkdtemp(
    resolve(tmpdir(), "external-eval-task-forwarding-execution-"),
  );
  const executionRoot = resolve(executionBase, "campaign-task-forwarding");
  const workspaceDir = resolve(
    executionRoot,
    "units",
    "alpha",
    String(unit.attempt),
    unit.blind_label,
  );
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(resolve(campaignRoot, "prepared/alpha/base"), {
    recursive: true,
  });
  await mkdir(
    resolve(campaignRoot, `subjects/${unit.version}/self-evolution`),
    { recursive: true },
  );
  const preparedRoot = resolve(campaignRoot, "prepared/alpha/base");
  await writeFile(resolve(preparedRoot, "package.json"), '{"name":"x"}\n');
  await writeFile(
    resolve(preparedRoot, "package-lock.json"),
    '{"name":"x","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x"}}}\n',
  );
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "-q"], { cwd: preparedRoot });
  execFileSync("git", ["config", "user.name", "external eval test"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["config", "user.email", "eval@example.invalid"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["add", "package.json", "package-lock.json"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: preparedRoot });
  await cp(preparedRoot, workspaceDir, { recursive: true });
  const taskValue = {
    id: "alpha",
    contract_root: resolve(campaignRoot, "contracts/alpha"),
    prompt: { onboarding: "onboard", repair: "repair" },
    install: { commands: ["node --version"] },
    validation: { focused: ["npm test"], full: ["npm test"] },
  };
  const seen = [];
  const executor = {
    async prepareExecutionEnvironment() {},
    async runPhase(input) {
      seen.push({ phase: input.phase, task: input.task });
      return { status: "completed", exit_code: 0 };
    },
    async collectRunEvidence({
      campaign,
      unit: selected,
      phase,
      workspaceDir,
    }) {
      const workspaceManifest = await collectWorkspaceManifest(workspaceDir);
      return {
        schema_version: "1.0",
        campaign_id: campaign.campaign_id,
        task_id: selected.task_id,
        attempt: selected.attempt,
        blind_label: selected.blind_label,
        phase,
        usage: { status: "not-measured", value: null },
        execution: { duration_ms: 1 },
        selected_context: [],
        knowledge_diff: [],
        capture: [],
        source_or_test_changed: false,
        workspace_edit: {
          schema_version: "1.0",
          receipt_count: 0,
          receipts: [],
          covered_paths: [],
          unreceipted_changes: [],
        },
        workspace_manifest: {
          post: { manifest_sha256: workspaceManifest.manifest_sha256 },
        },
      };
    },
  };
  const outcome = await runUnit({
    repositoryRoot: campaignRoot,
    campaignRoot,
    campaign: {
      campaign_id: "campaign-task-forwarding",
      execution_model: "provider/model",
      execution_root: executionRoot,
    },
    state,
    unit,
    task: taskValue,
    executor,
    executionRoot,
  });
  if (seen.length === 0) {
    const unitRoot = resolve(
      campaignRoot,
      "runs",
      "alpha",
      String(unit.attempt),
      unit.blind_label,
    );
    const run = JSON.parse(
      await readFile(resolve(unitRoot, "run.json"), "utf8"),
    );
    assert.fail(
      `runUnit stopped before model phases: ${outcome} ${JSON.stringify(run)}`,
    );
  }
  assert.deepEqual(
    seen.map((item) => item.phase),
    ["onboarding", "repair"],
  );
  assert.ok(seen.every((item) => item.task === taskValue));
});

test("runUnit fails closed if workspace bytes drift between onboarding and repair", async () => {
  const schedule = createSchedule(
    ["alpha"],
    "campaign-session-chain",
    Buffer.alloc(32, 21),
  );
  const unit = {
    ...schedule.public.units[0],
    version: schedule.sealed.mapping[schedule.public.units[0].blind_label],
  };
  const state = initialState(schedule.public);
  const campaignRoot = await mkdtemp(
    resolve(tmpdir(), "external-eval-session-chain-"),
  );
  const executionBase = await mkdtemp(
    resolve(tmpdir(), "external-eval-session-chain-execution-"),
  );
  const executionRoot = resolve(executionBase, "campaign-session-chain");
  const workspaceDir = resolve(
    executionRoot,
    "units",
    "alpha",
    String(unit.attempt),
    unit.blind_label,
  );
  const preparedRoot = resolve(campaignRoot, "prepared/alpha/base");
  await mkdir(preparedRoot, { recursive: true });
  await mkdir(
    resolve(campaignRoot, `subjects/${unit.version}/self-evolution`),
    { recursive: true },
  );
  await writeFile(resolve(preparedRoot, "package.json"), '{"name":"x"}\n');
  await writeFile(
    resolve(preparedRoot, "package-lock.json"),
    '{"name":"x","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x"}}}\n',
  );
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "-q"], { cwd: preparedRoot });
  execFileSync("git", ["config", "user.name", "external eval test"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["config", "user.email", "eval@example.invalid"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["add", "package.json", "package-lock.json"], {
    cwd: preparedRoot,
  });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: preparedRoot });
  const taskValue = {
    id: "alpha",
    contract_root: resolve(campaignRoot, "contracts/alpha"),
    prompt: { onboarding: "onboard", repair: "repair" },
    install: { commands: ["node --version"] },
    validation: { focused: [], full: [] },
  };
  const executor = {
    async prepareExecutionEnvironment() {},
    async runPhase({ phase }) {
      return { status: "completed", exit_code: 0, phase };
    },
    async collectRunEvidence({
      campaign,
      unit: selected,
      phase,
      workspaceDir,
    }) {
      const manifest = await collectWorkspaceManifest(workspaceDir);
      if (phase === "onboarding") {
        await writeFile(
          resolve(workspaceDir, "tampered-between-sessions.txt"),
          "x",
        );
      }
      return {
        schema_version: "1.0",
        campaign_id: campaign.campaign_id,
        task_id: selected.task_id,
        attempt: selected.attempt,
        blind_label: selected.blind_label,
        phase,
        usage: { status: "not-measured", value: null },
        execution: { duration_ms: 1 },
        selected_context: [],
        knowledge_diff: [],
        capture: [],
        source_or_test_changed: false,
        workspace_edit: {
          schema_version: "1.0",
          receipt_count: 0,
          receipts: [],
          covered_paths: [],
          unreceipted_changes: [],
        },
        workspace_manifest: {
          post: { manifest_sha256: manifest.manifest_sha256 },
        },
      };
    },
  };
  const outcome = await runUnit({
    repositoryRoot: campaignRoot,
    campaignRoot,
    campaign: {
      campaign_id: "campaign-session-chain",
      execution_model: "provider/model",
      execution_root: executionRoot,
    },
    state,
    unit,
    task: taskValue,
    executor,
    executionRoot,
  });
  assert.equal(outcome, "failed");
  assert.equal(state.units[unit.id].phases.onboarding.status, "completed");
  assert.equal(state.units[unit.id].phases.repair.status, "failed");
  const run = JSON.parse(
    await readFile(
      resolve(
        campaignRoot,
        "runs",
        "alpha",
        String(unit.attempt),
        unit.blind_label,
        "run.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    run.failure.reason,
    "onboarding-repair-workspace-chain-mismatch",
  );
});

test("execution environment exceptions fail the pending model phase", async () => {
  const schedule = createSchedule(
    ["alpha"],
    "campaign-environment-failure",
    Buffer.alloc(32, 10),
  );
  const unit = {
    ...schedule.public.units[0],
    version: schedule.sealed.mapping[schedule.public.units[0].blind_label],
  };
  const state = initialState(schedule.public);
  const campaignRoot = await mkdtemp(
    resolve(tmpdir(), "external-eval-environment-failure-"),
  );
  const executionBase = await mkdtemp(
    resolve(tmpdir(), "external-eval-environment-failure-execution-"),
  );
  const executionRoot = resolve(executionBase, "campaign-environment-failure");
  const workspaceDir = resolve(
    executionRoot,
    "units",
    "alpha",
    String(unit.attempt),
    unit.blind_label,
  );
  await mkdir(
    resolve(campaignRoot, `subjects/${unit.version}/self-evolution`),
    {
      recursive: true,
    },
  );
  await mkdir(workspaceDir, { recursive: true });
  state.units[unit.id].phases.onboarding.status = "completed";
  const executor = {
    async prepareExecutionEnvironment() {
      throw new Error("config invalid");
    },
    async collectRunEvidence({ campaign, unit: selected, phase }) {
      return {
        schema_version: "1.0",
        campaign_id: campaign.campaign_id,
        task_id: selected.task_id,
        attempt: selected.attempt,
        blind_label: selected.blind_label,
        phase,
        usage: { status: "not-measured", value: null },
        execution: { duration_ms: null },
        selected_context: [],
        knowledge_diff: [],
        capture: [],
      };
    },
  };
  await runUnit({
    repositoryRoot: campaignRoot,
    campaignRoot,
    campaign: {
      campaign_id: "campaign-environment-failure",
      execution_model: "provider/model",
      execution_root: executionRoot,
    },
    state,
    unit,
    task: {
      id: "alpha",
      prompt: { onboarding: "onboard", repair: "repair" },
    },
    executor,
    executionRoot,
  });
  assert.equal(state.units[unit.id].phases.onboarding.status, "completed");
  assert.equal(state.units[unit.id].phases.repair.status, "failed");
  assert.notEqual(state.units[unit.id].phases.repair.status, "running");
});

test("only schema-invalid blind reviews may retry before reveal", () => {
  const schedule = createSchedule(["alpha"], "campaign-1", Buffer.alloc(32, 9));
  const state = initialState(schedule.public);
  const pair = "alpha-1";
  transitionState(state, { pair }, "running");
  markReviewSchemaInvalid(state, pair, { reason: "invalid JSON" });
  assert.equal(state.reviews[pair].status, "retryable");
  transitionState(state, { pair }, "running");
  transitionState(state, { pair }, "failed", {
    error_category: "execution-failure",
  });
  assert.throws(
    () => transitionState(state, { pair }, "running"),
    /cannot be rerun/,
  );
});

test("review retry classification includes parse and bound-schema failures only", () => {
  assert.equal(
    isReviewSchemaError(new Error("reviewer verdict has unexpected keys")),
    true,
  );
  assert.equal(
    isReviewSchemaError(new Error("verdict.scores.A: is missing correctness")),
    true,
  );
  assert.equal(
    isReviewSchemaError(new Error("blind reviewer execution failed")),
    false,
  );
});

test("onboarding allowlist rejects product writes but permits knowledge writes", () => {
  assert.deepEqual(
    validateOnboardingEvidence({
      filesystem_trace: [
        { access: "write", path: "AGENTS.md" },
        { access: "write", path: ".agents/knowledge/index.yaml" },
      ],
    }),
    { valid: true, violations: [] },
  );
  const invalid = validateOnboardingEvidence({
    filesystem_trace: [{ access: "write", path: "src/index.js" }],
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.violations, ["write:src/index.js"]);
  assert.equal(
    validateOnboardingEvidence({
      filesystem_trace: [{ access: "write", path: null }],
    }).valid,
    false,
  );
  const adapters = validateOnboardingEvidence({
    filesystem_trace: [
      { access: "write", path: ".opencode/opencode.json" },
      { access: "write", path: ".claude/settings.json" },
      { access: "write", path: ".cursor/hooks.json" },
      { access: "write", path: ".augment/settings.json" },
      {
        access: "write",
        path: ".agents/generated/adapters/opencode/opencode-plugin.mjs",
      },
    ],
  });
  assert.equal(adapters.valid, false);
  assert.equal(adapters.violations.length, 4);
});

test("workspace edit receipts allow unreceipted knowledge but cover every product change", () => {
  assert.deepEqual(
    validateWorkspaceEditEvidence(
      {
        workspace_edit: {
          schema_version: "1.0",
          receipt_count: 0,
          receipts: [],
          covered_paths: [],
          unreceipted_changes: [
            "AGENTS.md",
            ".agents/knowledge/inbox/2026-08.md",
          ],
        },
      },
      "repair",
    ),
    { valid: true, violations: [] },
  );
  assert.deepEqual(
    validateWorkspaceEditEvidence(
      {
        workspace_edit: {
          schema_version: "1.0",
          receipt_count: 1,
          receipts: [{}],
          covered_paths: ["src/index.js", "test/index.test.js"],
          unreceipted_changes: ["AGENTS.md"],
        },
      },
      "repair",
    ),
    { valid: true, violations: [] },
  );
  assert.deepEqual(
    validateWorkspaceEditEvidence(
      {
        workspace_edit: {
          schema_version: "1.0",
          receipt_count: 0,
          receipts: [],
          covered_paths: [],
          unreceipted_changes: ["src/index.js", "package.json"],
        },
      },
      "repair",
    ).violations,
    ["unreceipted:src/index.js", "unreceipted:package.json"],
  );
  assert.deepEqual(
    validateWorkspaceEditEvidence(
      {
        workspace_edit: {
          schema_version: "1.0",
          receipt_count: 1,
          receipts: [{}],
          covered_paths: ["src/index.js"],
          unreceipted_changes: [],
        },
      },
      "onboarding",
    ).violations,
    ["onboarding-edit:src/index.js"],
  );
});

test("verdict binds A and B to exactly the pair's opaque labels", () => {
  const pair = [
    { task_id: "alpha", attempt: 1, blind_label: "arm-aaaaaaaaaaaa" },
    { task_id: "alpha", attempt: 1, blind_label: "arm-bbbbbbbbbbbb" },
  ];
  const verdict = {
    schema_version: "1.0",
    task_id: "alpha",
    attempt: 1,
    arms: { A: pair[0].blind_label, B: pair[1].blind_label },
    winner: "A",
    scores: { A: armScores(), B: armScores() },
    rationale: "Arm A is correct and safer.",
  };
  assert.equal(validateVerdict(verdict, pair), verdict);
  assert.throws(
    () =>
      validateVerdict(
        { ...verdict, arms: { A: "arm-cccccccccccc", B: pair[1].blind_label } },
        pair,
      ),
    /bind exactly/,
  );
  assert.throws(
    () =>
      validateVerdict(
        {
          ...verdict,
          scores: {
            A: armScores({ test_evidence: 6 }),
            B: armScores(),
          },
        },
        pair,
      ),
    /integer from 1 through 5/,
  );
  assert.throws(
    () =>
      validateVerdict(
        {
          ...verdict,
          winner: "A",
          scores: {
            A: armScores({ regression_safety: "uncertain" }),
            B: armScores(),
          },
        },
        pair,
      ),
    /cannot select an arm/,
  );
});

test("hard correctness and verdict winners fail closed on uncertain safety", () => {
  const unsafe = run("alpha", 1, "arm-aaaaaaaaaaaa", true);
  unsafe.verification.regression_safety = "uncertain";
  assert.equal(hardCorrect(unsafe), false);
  const verdict = {
    task_id: "alpha",
    attempt: 1,
    arms: { A: unsafe.blind_label, B: "arm-bbbbbbbbbbbb" },
    winner: "A",
  };
  assert.throws(
    () => validateVerdictAgainstRuns(verdict, [unsafe]),
    /without matching hard-correct run evidence/,
  );
});

test("review sealing requires exact completed coverage and binds verdict hashes", () => {
  const schedule = createSchedule(["alpha"], "campaign-1", Buffer.alloc(32, 3));
  const state = initialState(schedule.public);
  const verdicts = [1, 2, 3].map((attempt) => ({
    task_id: "alpha",
    attempt,
    arms: { A: `arm-a${attempt}`, B: `arm-b${attempt}` },
    winner: "tie",
    sha256: String(attempt).repeat(64),
  }));
  assert.throws(() => sealReviews(state, verdicts), /requires all 3 verdicts/);
  for (const review of Object.values(state.reviews))
    review.status = "completed";
  const seal = sealReviews(state, verdicts);
  assert.equal(seal.status, "sealed");
  assert.equal(seal.verdicts_sha256, reviewSealDigest(verdicts));
});

test("state chain rejects repair or review before prerequisites", () => {
  const schedule = createSchedule(["alpha"], "campaign-1", Buffer.alloc(32, 4));
  const state = initialState(schedule.public);
  const unit = schedule.public.units[0];
  state.units[unit.id].phases.repair.status = "running";
  assert.throws(
    () => validateStateChain(state, schedule.public, schedule.sealed.mapping),
    /repair started before onboarding completed/,
  );
});

test("checksum verification rejects artifact tampering", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-eval-checksum-"));
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  await writeFile(resolve(root, "artifacts/raw.txt"), "original\n", "utf8");
  await writeChecksums(root);
  assert.equal(await verifyChecksums(root), 1);
  await writeFile(resolve(root, "artifacts/raw.txt"), "tampered\n", "utf8");
  await assert.rejects(verifyChecksums(root), /hash mismatch/);
});

test("checksum checkpoints bind every replacement to the previous manifest", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-eval-chain-"));
  await writeFile(resolve(root, "one.txt"), "one\n", "utf8");
  await writeChecksums(root);
  await writeFile(resolve(root, "two.txt"), "two\n", "utf8");
  await writeChecksums(root, [], { allowMutation: true });
  const checkpoints = (
    await readFile(resolve(root, "CHECKPOINTS.jsonl"), "utf8")
  )
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  assert.equal(checkpoints.length, 2);
  assert.equal(
    checkpoints[1].previous_checksum_sha256,
    checkpoints[0].checksum_sha256,
  );
  checkpoints[1].previous_checksum_sha256 = "0".repeat(64);
  await writeFile(
    resolve(root, "CHECKPOINTS.jsonl"),
    `${checkpoints.map(JSON.stringify).join("\n")}\n`,
    "utf8",
  );
  await assert.rejects(verifyChecksums(root), /previous checksum chain/);
});

test("blind-bundle leak check rejects version and subject identifiers", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-eval-blind-"));
  const subjectSha = "f".repeat(64);
  const clean = resolve(root, "clean.json");
  await writeFile(clean, '{"arms":{"A":"arm-abcdef123456"}}\n', "utf8");
  await assert.doesNotReject(assertNoVersionLeak(clean, [subjectSha]));
  const leaking = resolve(root, "leaking.json");
  await writeFile(leaking, '{"subject_sha256":"abc","arm":"v2"}\n', "utf8");
  await assert.rejects(assertNoVersionLeak(leaking), /blinded-review leak/);
  const nestedPath = resolve(root, "nested-path.json");
  await writeFile(
    nestedPath,
    JSON.stringify({ arms: { A: { capture: [{ text: "C:\\sealed\\map" }] } } }),
    "utf8",
  );
  await assert.rejects(assertNoVersionLeak(nestedPath), /blinded-review leak/);
  const nestedSubject = resolve(root, "nested-subject.json");
  await writeFile(
    nestedSubject,
    JSON.stringify({ arms: { A: { final: `result ${subjectSha}` } } }),
    "utf8",
  );
  await assert.rejects(
    assertNoVersionLeak(nestedSubject, { subject: { sha256: subjectSha } }),
    /forbidden value/,
  );
});

function run(
  taskId,
  attempt,
  label,
  correct,
  regression = false,
  metrics = undefined,
) {
  return {
    schema_version: "1.0",
    campaign_id: "campaign-evidence",
    task_id: taskId,
    attempt,
    blind_label: label,
    status: "completed",
    verification: {
      hidden_tests: correct ? "pass" : "fail",
      full_suite: correct ? "pass" : "fail",
      regression_safety: regression ? "fail" : "pass",
    },
    metrics,
  };
}

function completeMetrics(seed, captureItems = 0) {
  return {
    onboarding: {
      usage_status: "measured",
      input_tokens: seed,
      output_tokens: 1,
      duration_ms: 10,
      selected_context_bytes: 20,
      knowledge_bytes: 30,
      capture_items: 0,
    },
    repair: {
      usage_status: "measured",
      input_tokens: seed + 1,
      output_tokens: 2,
      duration_ms: 11,
      selected_context_bytes: 21,
      knowledge_bytes: 31,
      capture_items: captureItems,
    },
  };
}

const formalSubjectSha256 = sha256("formal-subject");
const formalToolchain = {
  distro: "Ubuntu",
  root: "/pinned/node",
  node: "22.13.1",
  npm: "10.9.2",
};
const formalAssurance = {
  ...FORMAL_CAMPAIGN_PROTOCOL.execution_assurance,
};
const formalShimEnforcement =
  FORMAL_CAMPAIGN_PROTOCOL.toolchain_shim_enforcement;
const formalWorkspaceEditRuntimeSha256 =
  FORMAL_CAMPAIGN_PROTOCOL.workspace_edit_runtime_sha256;

function formalIsolationEvidence(label, phase) {
  const confinement = {
    restricted_token: { status: "passed" },
    coordinator_acl: [
      {
        status: "restored",
        restore_receipt_sha256: sha256(`${label}:${phase}:acl`),
      },
    ],
    windows_canary: { status: "passed" },
  };
  const credentials = {
    transport: "isolated-disk-only",
    content_env_absent: true,
  };
  const instructions = { path: "AGENTS.md", sha256: sha256("agents") };
  const shell_wrapper = {
    canary_status: "passed",
    path_sha256: sha256("shell-path"),
    receipt_sha256: sha256("shell-receipt"),
    workspace_edit_runtime_sha256: formalWorkspaceEditRuntimeSha256,
  };
  return { confinement, credentials, instructions, shell_wrapper };
}

function formalExpectedBindings() {
  return {
    subject_sha256: formalSubjectSha256,
    toolchain: formalToolchain,
    toolchain_shim_enforcement: formalShimEnforcement,
    workspace_edit_runtime_sha256: formalWorkspaceEditRuntimeSha256,
    assurance: formalAssurance,
  };
}

function workspaceManifestEvidence(label, phase) {
  const pre = sha256(`${label}:${phase}:workspace-pre`);
  const post = sha256(`${label}:${phase}:workspace-post`);
  return {
    schema_version: "1.0",
    algorithm: "sha256",
    exclusions: [],
    pre: {
      path: "workspace.pre.json",
      artifact_sha256: sha256(`${pre}:artifact`),
      manifest_sha256: pre,
      file_count: 1,
      total_bytes: 10,
    },
    post: {
      path: "workspace.post.json",
      artifact_sha256: sha256(`${post}:artifact`),
      manifest_sha256: post,
      file_count: 1,
      total_bytes: 11,
    },
    diff: {
      path: "workspace-diff.json",
      artifact_sha256: sha256(`${post}:diff-artifact`),
      binding_sha256: sha256(`${post}:diff-binding`),
      change_count: 1,
      changes: [{ change: "modified", path: "AGENTS.md" }],
    },
    final_state_binding_sha256: sha256(`${post}:final-binding`),
  };
}

function withRawEvidence(runValue) {
  const evidence = Object.fromEntries(
    ["onboarding", "repair"].map((phase) => {
      const metric = runValue.metrics[phase];
      const capture = Array.from(
        { length: metric.capture_items },
        (_, index) => ({
          path: `.agents/knowledge/inbox/item-${index}.md`,
        }),
      );
      const workspaceManifest = workspaceManifestEvidence(
        runValue.blind_label,
        phase,
      );
      return [
        phase,
        {
          status: "loaded",
          path: `runs/${runValue.task_id}/${runValue.attempt}/${runValue.blind_label}/${phase}/evidence.json`,
          sha256: sha256(`${runValue.blind_label}:${phase}`),
          value: {
            schema_version: "1.0",
            campaign_id: runValue.campaign_id,
            task_id: runValue.task_id,
            attempt: runValue.attempt,
            blind_label: runValue.blind_label,
            phase,
            usage: {
              status: metric.usage_status,
              value: {
                input_tokens: metric.input_tokens,
                output_tokens: metric.output_tokens,
              },
            },
            execution: { duration_ms: metric.duration_ms },
            parse_errors: [],
            path_escape_detected: false,
            network_violation_detected: false,
            child_session_detected: false,
            skill_load: {
              status: "passed",
              loaded_skill_path: "<isolated>/subject/self-evolution/SKILL.md",
              loaded_skill_path_matches_subject: true,
              subject_sha256: formalSubjectSha256,
              probe_sha256: sha256(`${runValue.blind_label}:${phase}:skill`),
            },
            effective_config: {
              sha256: sha256(`${runValue.blind_label}:${phase}:config`),
              resolved_probe_sha256: sha256(
                `${runValue.blind_label}:${phase}:resolved-config`,
              ),
              disk_and_environment_identical: true,
            },
            subject: {
              original_before_sha256: formalSubjectSha256,
              original_after_sha256: formalSubjectSha256,
              copy_before_sha256: formalSubjectSha256,
              copy_after_sha256: formalSubjectSha256,
              unchanged: true,
            },
            randomness: {
              seed_support: "not-supported",
              seed: "not-measured",
              variant: null,
            },
            assurance: {
              ...formalAssurance,
              filesystem_trace_kind: "opencode-tool-event-derived",
              workspace_state: "pre-post-byte-manifest",
              workspace_event_trace: "opencode-tool-event-derived",
              filesystem_audit: "not-syscall-audit",
              child_sessions: "denied",
            },
            toolchain_shims: {
              enforcement: formalShimEnforcement,
              toolchain: formalToolchain,
              sha256: sha256(`${runValue.blind_label}:${phase}:shims`),
            },
            ...formalIsolationEvidence(runValue.blind_label, phase),
            session_chain:
              phase === "repair"
                ? {
                    status: "matched",
                    expected_pre_manifest_sha256:
                      workspaceManifest.pre.manifest_sha256,
                    actual_pre_manifest_sha256:
                      workspaceManifest.pre.manifest_sha256,
                  }
                : { status: "not-applicable" },
            workspace_manifest: workspaceManifest,
            workspace_edit: {
              schema_version: "1.0",
              receipt_count: 0,
              receipts: [],
              covered_paths: [],
              unreceipted_changes: ["AGENTS.md"],
            },
            workspace_tree_sha256: workspaceManifest.post.manifest_sha256,
            selected_context: [
              { path: "source.js", bytes: metric.selected_context_bytes },
            ],
            knowledge_diff: [
              {
                path: ".agents/knowledge/domains/project.md",
                change: "modified",
                bytes: metric.knowledge_bytes,
              },
            ],
            capture,
          },
        },
      ];
    }),
  );
  const executionBindings = Object.fromEntries(
    Object.entries(evidence).map(([phase, artifact]) => {
      const value = artifact.value;
      return [
        phase,
        {
          subject_sha256: value.skill_load.subject_sha256,
          loaded_skill_path: value.skill_load.loaded_skill_path,
          skill_load_probe_sha256: value.skill_load.probe_sha256,
          effective_config_sha256: value.effective_config.sha256,
          effective_config_probe_sha256:
            value.effective_config.resolved_probe_sha256,
          toolchain_shim_sha256: value.toolchain_shims.sha256,
          toolchain_shim_enforcement: value.toolchain_shims.enforcement,
          toolchain_sha256: sha256(stableJson(value.toolchain_shims.toolchain)),
          workspace_final_state_binding_sha256:
            value.workspace_manifest.final_state_binding_sha256,
          workspace_post_manifest_sha256:
            value.workspace_manifest.post.manifest_sha256,
          session_chain_sha256: sha256(stableJson(value.session_chain)),
          confinement_sha256: sha256(stableJson(value.confinement)),
          credentials_sha256: sha256(stableJson(value.credentials)),
          instructions_sha256: sha256(stableJson(value.instructions)),
          shell_wrapper_sha256: sha256(stableJson(value.shell_wrapper)),
        },
      ];
    }),
  );
  return {
    ...runValue,
    raw_evidence: evidence,
    execution_bindings: executionBindings,
  };
}

function withVerificationEvidence(runValue) {
  const verification = runValue.verification;
  const artifacts = {
    focused: { name: "focused", passed: true, commands: [] },
    full: { name: "full", passed: true, commands: [] },
    clean_install: { name: "clean-install", passed: true, commands: [] },
    patch_safety: { status: "pass", passed: true, findings: [] },
  };
  Object.assign(verification, {
    schema_version: "1.0",
    task_id: runValue.task_id,
    attempt: runValue.attempt,
    blind_label: runValue.blind_label,
    ...artifacts,
    patch_sha256: sha256("patch"),
    changed_paths_sha256: sha256("changed-paths"),
  });
  verification.patch_binding_sha256 = sha256(
    stableJson({
      changed_paths_sha256: verification.changed_paths_sha256,
      patch_sha256: verification.patch_sha256,
    }),
  );
  verification.artifact_bindings = Object.fromEntries(
    Object.entries(artifacts).map(([name, value]) => [
      name,
      {
        path:
          name === "clean_install"
            ? "clean-install.json"
            : name === "patch_safety"
              ? "patch-safety.json"
              : `${name}.json`,
        artifact_sha256: sha256(stableJson(value)),
        value_sha256: sha256(stableJson(value)),
      },
    ]),
  );
  verification.artifact_bindings.binding_sha256 =
    verificationArtifactBindingDigest(verification);
  runValue.raw_verification = {
    verification: {
      status: "loaded",
      path: `runs/${runValue.task_id}/${runValue.attempt}/${runValue.blind_label}/verification/verification.json`,
      sha256: sha256(stableJson(verification)),
      value: structuredClone(verification),
    },
    ...Object.fromEntries(
      Object.entries(artifacts).map(([name, value]) => [
        name,
        {
          status: "loaded",
          path: `runs/${runValue.task_id}/${runValue.attempt}/${runValue.blind_label}/verification/${verification.artifact_bindings[name].path}`,
          sha256: sha256(stableJson(value)),
          value: structuredClone(value),
        },
      ]),
    ),
    patch: {
      status: "loaded",
      path: "verification/patch.diff",
      sha256: verification.patch_sha256,
    },
    changed_paths: {
      status: "loaded",
      path: "verification/changed-paths.txt",
      sha256: verification.changed_paths_sha256,
    },
  };
  runValue.execution_bindings.verification = {
    verification_artifact_sha256: runValue.raw_verification.verification.sha256,
    artifact_binding_sha256: verification.artifact_bindings.binding_sha256,
    patch_binding_sha256: verification.patch_binding_sha256,
  };
  return runValue;
}

test("formal campaign gate requires strict raw phase evidence", () => {
  const schedule = createSchedule(
    ["alpha"],
    "campaign-evidence",
    Buffer.alloc(32, 5),
  );
  const state = initialState(schedule.public);
  state.smoke = { status: "passed" };
  const runs = schedule.public.units.map((unit) => {
    state.units[unit.id].phases.onboarding.status = "completed";
    state.units[unit.id].phases.repair.status = "completed";
    state.units[unit.id].phases.verification.status = "completed";
    const version = schedule.sealed.mapping[unit.blind_label];
    return withVerificationEvidence(
      withRawEvidence({
        ...run(
          unit.task_id,
          unit.attempt,
          unit.blind_label,
          version === "v2",
          false,
          completeMetrics(unit.attempt),
        ),
        schema_version: "1.0",
        campaign_id: "campaign-evidence",
      }),
    );
  });
  for (const review of Object.values(state.reviews))
    review.status = "completed";
  state.review_seal = {
    status: "sealed",
    expected: 3,
    verdicts_sha256: "0".repeat(64),
    sealed_at: new Date(0).toISOString(),
  };
  const verdicts = [1, 2, 3].map((attempt) => ({
    task_id: "alpha",
    attempt,
    arms: { A: "unused-a", B: "unused-b" },
    winner: "tie",
  }));
  const pairLabels = new Map();
  for (const unit of schedule.public.units) {
    if (!pairLabels.has(unit.attempt)) pairLabels.set(unit.attempt, []);
    pairLabels.get(unit.attempt).push(unit.blind_label);
  }
  for (const verdict of verdicts) {
    verdict.arms = {
      A: pairLabels.get(verdict.attempt)[0],
      B: pairLabels.get(verdict.attempt)[1],
    };
  }
  for (const runValue of runs) {
    for (const phase of ["onboarding", "repair"]) {
      const evidence = runValue.raw_evidence[phase].value;
      runValue.metrics[phase] = {
        usage_status: "measured",
        input_tokens: evidence.usage.value.input_tokens,
        output_tokens: evidence.usage.value.output_tokens,
        duration_ms: evidence.execution.duration_ms,
        selected_context_bytes: evidence.selected_context[0].bytes,
        knowledge_bytes: evidence.knowledge_diff[0].bytes,
        capture_items: evidence.capture.length,
      };
    }
  }
  const passed = campaignGateStatus({
    campaign: { diagnostic: false, smoke: { status: "passed" } },
    schedule: schedule.public,
    state,
    runs,
    verdicts,
    strictEvidence: true,
    expectedBindingsForRun: () => formalExpectedBindings(),
  });
  assert.equal(passed.gates.runs.raw_evidence.invalid_phase_artifacts, 0);
  assert.equal(passed.complete, true);
  runs[0].raw_evidence.onboarding.value.campaign_id = "wrong-campaign";
  const failed = campaignGateStatus({
    campaign: { diagnostic: false, smoke: { status: "passed" } },
    schedule: schedule.public,
    state,
    runs,
    verdicts,
    strictEvidence: true,
    expectedBindingsForRun: () => formalExpectedBindings(),
  });
  assert.equal(failed.complete, false);
  assert.match(failed.reasons.join(" "), /raw phase evidence/);
  runs[0] = withRawEvidence({
    ...run(
      schedule.public.units[0].task_id,
      schedule.public.units[0].attempt,
      schedule.public.units[0].blind_label,
      schedule.sealed.mapping[schedule.public.units[0].blind_label] === "v2",
      false,
      completeMetrics(schedule.public.units[0].attempt),
    ),
    schema_version: "1.0",
    campaign_id: "campaign-evidence",
  });
  runs[0].raw_evidence.repair.value.skill_load.status = "not-measured";
  const tampered = campaignGateStatus({
    campaign: { diagnostic: false, smoke: { status: "passed" } },
    schedule: schedule.public,
    state,
    runs,
    verdicts,
    strictEvidence: true,
    expectedBindingsForRun: () => formalExpectedBindings(),
  });
  assert.equal(tampered.complete, false);
  assert.equal(
    evidencePhase(runs[0], "repair", {
      strict: true,
      expectedBindings: formalExpectedBindings(),
    }).binding.status,
    "invalid-execution-integrity",
  );
});

test("strict phase evidence rejects omitted or tampered execution bindings", () => {
  const runValue = withRawEvidence({
    ...run("alpha", 1, "arm-binding000001", true, false, completeMetrics(1)),
    schema_version: "1.0",
    campaign_id: "campaign-evidence",
  });
  const binding = () =>
    evidencePhase(runValue, "repair", {
      strict: true,
      expectedBindings: formalExpectedBindings(),
    }).binding.status;
  assert.equal(binding(), "verified");

  delete runValue.execution_bindings.repair.effective_config_sha256;
  assert.equal(binding(), "run-execution-binding-mismatch");
  runValue.execution_bindings = withRawEvidence({
    ...runValue,
    metrics: completeMetrics(1),
  }).execution_bindings;

  runValue.raw_evidence.repair.value.skill_load.loaded_skill_path =
    "<other>/subject/self-evolution/SKILL.md";
  assert.equal(binding(), "run-execution-binding-mismatch");
  runValue.raw_evidence.repair.value.skill_load.loaded_skill_path =
    runValue.execution_bindings.repair.loaded_skill_path;
  runValue.raw_evidence.repair.value.skill_load.probe_sha256 =
    runValue.execution_bindings.repair.skill_load_probe_sha256;
  runValue.raw_evidence.repair.value.effective_config.sha256 =
    runValue.execution_bindings.repair.effective_config_sha256;
  runValue.raw_evidence.repair.value.effective_config.resolved_probe_sha256 =
    runValue.execution_bindings.repair.effective_config_probe_sha256;
  runValue.raw_evidence.repair.value.toolchain_shims.sha256 =
    runValue.execution_bindings.repair.toolchain_shim_sha256;

  runValue.raw_evidence.repair.value.subject.copy_after_sha256 = sha256(
    "tampered-subject-copy",
  );
  assert.equal(binding(), "execution-binding-mismatch");
  runValue.raw_evidence.repair.value.subject.copy_after_sha256 =
    formalSubjectSha256;

  runValue.raw_evidence.repair.value.toolchain_shims.toolchain.node = "22.0.0";
  assert.equal(binding(), "run-execution-binding-mismatch");
});

test("strict phase evidence rejects unreceipted product changes", () => {
  const runValue = withRawEvidence({
    ...run("alpha", 1, "arm-receipt000001", true, false, completeMetrics(1)),
    schema_version: "1.0",
    campaign_id: "campaign-evidence",
  });
  const binding = () =>
    evidencePhase(runValue, "repair", {
      strict: true,
      expectedBindings: formalExpectedBindings(),
    }).binding.status;
  assert.equal(binding(), "verified");
  runValue.raw_evidence.repair.value.workspace_edit.unreceipted_changes = [
    "src/index.js",
  ];
  assert.equal(binding(), "invalid-execution-integrity");
  runValue.raw_evidence.repair.value.workspace_edit.unreceipted_changes = [
    ".agents/knowledge/inbox/2026-08.md",
  ];
  assert.equal(binding(), "verified");
});

test("verification evidence recomputes command and patch bindings", () => {
  const value = withVerificationEvidence(
    withRawEvidence(
      run("alpha", 1, "arm-aaaaaaaaaaaa", true, false, completeMetrics(1)),
    ),
  );
  assert.equal(
    verificationEvidence(value, { strict: true }).status,
    "verified",
  );
  value.raw_verification.focused.value.passed = false;
  assert.equal(
    verificationEvidence(value, { strict: true }).status,
    "invalid-focused-artifact",
  );
  value.raw_verification.focused.value.passed = true;
  value.raw_verification.patch.sha256 = sha256("different patch");
  assert.equal(
    verificationEvidence(value, { strict: true }).status,
    "invalid-patch-or-artifact-binding",
  );
});

test("winner aggregation prioritizes task majority over review preference", () => {
  const mapping = {};
  const runs = [];
  const reviews = [];
  for (const taskId of ["alpha", "beta", "gamma"]) {
    for (const attempt of [1, 2, 3]) {
      const v1 = `arm-${taskId}1${attempt}`;
      const v2 = `arm-${taskId}2${attempt}`;
      mapping[v1] = "v1";
      mapping[v2] = "v2";
      runs.push(run(taskId, attempt, v1, taskId === "alpha" && attempt < 3));
      runs.push(run(taskId, attempt, v2, taskId !== "gamma" || attempt < 3));
      reviews.push({
        task_id: taskId,
        attempt,
        arms: { A: v1, B: v2 },
        winner: "A",
      });
    }
  }
  const summary = aggregateCampaign({
    tasks: ["alpha", "beta", "gamma"],
    runs,
    reviews,
    mapping,
  });
  assert.equal(summary.winner, "v2");
  assert.equal(summary.basis, "more tasks passed by majority of attempts");
});

test("incomplete evidence never declares a winner", () => {
  const summary = aggregateCampaign({
    tasks: ["alpha"],
    runs: [run("alpha", 1, "arm-one", true)],
    reviews: [],
    mapping: { "arm-one": "v2" },
  });
  assert.equal(summary.winner, "no-clear-winner");
  assert.match(summary.basis, /incomplete/);
  assert.deepEqual(summary.versions.v1.efficiency.total_tokens, {
    status: "not-measured",
    unit: "tokens",
    value: null,
    measured_runs: 0,
    expected_runs: 3,
  });
});

test("invalid raw evidence cannot declare a winner despite complete tuples", () => {
  const mapping = {};
  const runs = [];
  const reviews = [];
  for (const attempt of [1, 2, 3]) {
    const v1 = `arm-rawa0000000${attempt}`;
    const v2 = `arm-rawb0000000${attempt}`;
    mapping[v1] = "v1";
    mapping[v2] = "v2";
    runs.push(
      run("alpha", attempt, v1, false),
      run("alpha", attempt, v2, true),
    );
    reviews.push({
      task_id: "alpha",
      attempt,
      arms: { A: v1, B: v2 },
      winner: "B",
    });
  }
  const summary = aggregateCampaign({
    tasks: ["alpha"],
    runs,
    reviews,
    mapping,
    evidenceComplete: false,
  });
  assert.equal(summary.complete, false);
  assert.equal(summary.winner, "no-clear-winner");
  assert.match(summary.basis, /raw phase evidence/);
});

test("efficiency totals require complete run coverage and reviewer item labels", () => {
  const mapping = {};
  const runs = [];
  const reviews = [];
  for (const attempt of [1, 2, 3]) {
    const v1 = `arm-a0000000000${attempt}`;
    const v2 = `arm-b0000000000${attempt}`;
    mapping[v1] = "v1";
    mapping[v2] = "v2";
    runs.push(
      withRawEvidence(
        run("alpha", attempt, v1, true, false, completeMetrics(attempt, 1)),
      ),
      withRawEvidence(
        run("alpha", attempt, v2, true, false, completeMetrics(attempt, 1)),
      ),
    );
    reviews.push({
      task_id: "alpha",
      attempt,
      arms: { A: v1, B: v2 },
      winner: "tie",
      scores: {
        A: {
          ...armScores(),
          capture_item_labels: [
            { id: "capture-repair-001", verdict: "low-value" },
          ],
        },
        B: {
          ...armScores(),
          capture_item_labels: [
            { id: "capture-repair-001", verdict: "not-low-value" },
          ],
        },
      },
      verdict_path: `blind/alpha/${attempt}/verdict.json`,
      verdict_sha256: String(attempt).repeat(64),
    });
  }
  const summary = aggregateCampaign({
    tasks: ["alpha"],
    runs,
    reviews,
    mapping,
  });
  assert.equal(summary.versions.v1.efficiency.onboarding_tokens.value, 9);
  assert.equal(summary.versions.v1.efficiency.total_tokens.value, 24);
  assert.equal(summary.versions.v1.efficiency.duration_ms.value, 63);
  assert.equal(
    summary.versions.v1.efficiency.selected_context_bytes.value,
    123,
  );
  assert.equal(summary.versions.v1.efficiency.knowledge_bytes.value, 183);
  assert.equal(summary.versions.v1.efficiency.capture_items.value, 3);
  assert.equal(summary.versions.v1.efficiency.low_value_captures.value, 3);
  assert.equal(summary.versions.v2.efficiency.low_value_captures.value, 0);
  assert.equal(
    summary.blind_reviews[0].verdict_path,
    "blind/alpha/1/verdict.json",
  );

  delete reviews[0].scores.A.capture_item_labels;
  const unlabeled = aggregateCampaign({
    tasks: ["alpha"],
    runs,
    reviews,
    mapping,
  });
  assert.equal(
    unlabeled.versions.v1.efficiency.low_value_captures.status,
    "not-measured",
  );
  assert.equal(unlabeled.versions.v1.efficiency.low_value_captures.value, null);
  assert.equal(
    unlabeled.versions.v1.efficiency.low_value_captures.measured_runs,
    2,
  );

  reviews[0].scores.A.capture_item_labels = [
    { id: "capture-repair-999", verdict: "low-value" },
  ];
  const mismatched = aggregateCampaign({
    tasks: ["alpha"],
    runs,
    reviews,
    mapping,
  });
  assert.equal(
    mismatched.versions.v1.efficiency.low_value_captures.status,
    "not-measured",
  );
});

test("efficiency never changes correctness-first winner and diagnostic cannot win", () => {
  const mapping = {};
  const runs = [];
  const reviews = [];
  for (const taskId of ["alpha", "beta", "gamma"]) {
    for (const attempt of [1, 2, 3]) {
      const v1 = `arm-${taskId}a${attempt}`;
      const v2 = `arm-${taskId}b${attempt}`;
      mapping[v1] = "v1";
      mapping[v2] = "v2";
      runs.push(
        withRawEvidence(
          run(taskId, attempt, v1, false, false, completeMetrics(1)),
        ),
        withRawEvidence(
          run(taskId, attempt, v2, true, false, completeMetrics(1000)),
        ),
      );
      reviews.push({
        task_id: taskId,
        attempt,
        arms: { A: v1, B: v2 },
        winner: "A",
        scores: { A: armScores(), B: armScores() },
      });
    }
  }
  const summary = aggregateCampaign({
    tasks: ["alpha", "beta", "gamma"],
    runs,
    reviews,
    mapping,
  });
  assert.equal(summary.winner, "v2");
  assert.ok(
    summary.versions.v2.efficiency.total_tokens.value >
      summary.versions.v1.efficiency.total_tokens.value,
  );
  const diagnostic = aggregateCampaign({
    tasks: ["alpha", "beta", "gamma"],
    runs,
    reviews,
    mapping,
    diagnostic: true,
  });
  assert.equal(diagnostic.complete, false);
  assert.equal(diagnostic.winner, "no-clear-winner");
  assert.match(diagnostic.basis, /diagnostic/);
});

test("coverage aggregation rejects duplicate and unexpected tuples", () => {
  const mapping = { "arm-one": "v1", "arm-two": "v2" };
  const duplicate = run("alpha", 1, "arm-one", true);
  assert.throws(
    () =>
      aggregateCampaign({
        tasks: ["alpha"],
        runs: [duplicate, duplicate],
        reviews: [],
        mapping,
      }),
    /duplicates tuple/,
  );
  const coverage = expectedCoverage(["alpha", "beta"]);
  assert.equal(coverage.runKeys.length, 12);
  assert.equal(coverage.reviewKeys.length, 6);
});

test("checksum verification rejects unlisted campaign artifacts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-eval-coverage-"));
  await writeFile(resolve(root, "one.txt"), "one\n", "utf8");
  await writeChecksums(root);
  await writeFile(resolve(root, "late.txt"), "late\n", "utf8");
  await assert.rejects(verifyChecksums(root), /exact campaign artifact set/);
});

test("CLI exposes all five campaign phases", () => {
  for (const command of ["prepare", "run", "review", "verify", "report"]) {
    assert.equal(parseCli([command]).command, command);
  }
  assert.throws(() => parseCli(["release"]), /usage/);
});

test("existing campaign commands require an explicit campaign id", () => {
  assert.throws(
    () => requireExplicitCampaignOption({}),
    /--campaign is required/,
  );
  assert.doesNotThrow(() =>
    requireExplicitCampaignOption({ campaign: "external-new" }),
  );
});

test("campaign ids cannot escape the coordinator or execution roots", () => {
  assert.equal(
    validateCampaignId("external-20260806T120000Z-ab12cd34"),
    "external-20260806T120000Z-ab12cd34",
  );
  for (const value of [
    "../external-escape",
    "external/escape",
    "external\\escape",
    "external-..\\escape",
    "campaign-1",
    "external-",
  ]) {
    assert.throws(() => validateCampaignId(value), /safe external-\*/);
  }
});

test("formal task filters require explicit diagnostic mode", () => {
  const filtered = parseCli(["prepare", "--task", "alpha"]);
  assert.equal(filtered.options.task, "alpha");
  assert.equal(filtered.options.diagnostic, undefined);
  const diagnostic = parseCli(["prepare", "--task", "alpha", "--diagnostic"]);
  assert.equal(diagnostic.options.diagnostic, true);
});

test("prepare checks restricted WSL before creating a campaign tree", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-preflight-order-"));
  const output = resolve(root, "campaigns");
  const campaign = "external-preflight-order";
  const taskRoot = resolve(
    root,
    "maintainer/evals/external/tasks/p-limit-detached-map",
  );
  await mkdir(taskRoot, { recursive: true });
  await writeFile(
    resolve(taskRoot, "task.json"),
    JSON.stringify({
      ...task,
      id: "p-limit-detached-map",
      validation_environment: undefined,
    }),
  );
  let received;
  const events = [];
  await assert.rejects(
    prepareCampaign({
      repositoryRoot: root,
      options: {
        output,
        campaign,
        execution: resolve(root, "execution"),
        task: "p-limit-detached-map",
        diagnostic: true,
      },
      runtime: {
        async prewarmRestrictedWsl(options) {
          events.push("prewarm");
          assert.equal(options.distro, PINNED_WSL_TOOLCHAIN.distro);
          await assert.rejects(access(resolve(output, campaign)));
        },
        async verifyRestrictedWslAvailability(options) {
          events.push("restricted");
          received = options;
          await assert.rejects(access(resolve(output, campaign)));
          throw new Error("restricted WSL unavailable");
        },
      },
    }),
    /restricted WSL unavailable/,
  );
  assert.equal(received.distro, PINNED_WSL_TOOLCHAIN.distro);
  assert.equal(received.scratchRoot, resolve(root, "execution"));
  assert.deepEqual(events, ["prewarm", "restricted"]);
  await assert.rejects(access(resolve(output, campaign)));
});

test("prepare stops after a failed WSL prewarm without creating campaign state", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-prewarm-order-"));
  const output = resolve(root, "campaigns");
  const campaign = "external-prewarm-order";
  const taskRoot = resolve(
    root,
    "maintainer/evals/external/tasks/p-limit-detached-map",
  );
  await mkdir(taskRoot, { recursive: true });
  await writeFile(
    resolve(taskRoot, "task.json"),
    JSON.stringify({
      ...task,
      id: "p-limit-detached-map",
      validation_environment: undefined,
    }),
  );
  let restrictedCalled = false;
  await assert.rejects(
    prepareCampaign({
      repositoryRoot: root,
      options: {
        output,
        campaign,
        execution: resolve(root, "execution"),
        task: "p-limit-detached-map",
        diagnostic: true,
      },
      runtime: {
        async prewarmRestrictedWsl() {
          await assert.rejects(access(resolve(output, campaign)));
          throw new Error("profile prewarm failed");
        },
        async verifyRestrictedWslAvailability() {
          restrictedCalled = true;
        },
      },
    }),
    /profile prewarm failed/,
  );
  assert.equal(restrictedCalled, false);
  await assert.rejects(access(resolve(output, campaign)));
});

test("existing campaign errors before restricted WSL preflight", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-preflight-existing-"));
  const output = resolve(root, "campaigns");
  const campaign = "external-existing";
  await mkdir(resolve(output, campaign), { recursive: true });
  let prewarmCalled = false;
  let restrictedCalled = false;
  await assert.rejects(
    prepareCampaign({
      repositoryRoot: root,
      options: { output, campaign },
      runtime: {
        async prewarmRestrictedWsl() {
          prewarmCalled = true;
        },
        async verifyRestrictedWslAvailability() {
          restrictedCalled = true;
        },
      },
    }),
    /already exists; pass --resume/,
  );
  assert.equal(prewarmCalled, false);
  assert.equal(restrictedCalled, false);
});

test("formal campaign protocol pins task ids, models, toolchain, and isolation", () => {
  const campaign = {
    diagnostic: false,
    tasks: FORMAL_TASK_IDS.map((id) => ({ id })),
    ...FORMAL_CAMPAIGN_PROTOCOL,
  };
  assert.doesNotThrow(() => validateFormalCampaignProtocol(campaign));
  for (const mutate of [
    (value) => (value.attempts = 2),
    (value) => (value.tasks = value.tasks.slice(1)),
    (value) => (value.execution_model = "replacement/model"),
    (value) => (value.opencode_version = "latest"),
    (value) => (value.toolchain = { ...value.toolchain, node: "22.0.0" }),
    (value) => (value.workspace_edit_runtime_sha256 = sha256("replacement")),
    (value) =>
      (value.execution_assurance = {
        ...value.execution_assurance,
        network_enforcement: "best-effort",
      }),
  ]) {
    const tampered = structuredClone(campaign);
    mutate(tampered);
    assert.throws(
      () => validateFormalCampaignProtocol(tampered),
      /protocol constants/,
    );
  }
});

test("model smoke gate binds both models, usage, and artifact hash", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-eval-smoke-"));
  await mkdir(resolve(root, "smoke"), { recursive: true });
  const summary = {
    schema_version: "1.0",
    status: "passed",
    results: [
      {
        role: "execution",
        model: "zeo/gpt-5.5-high",
        status: "passed",
        response_count: 1,
        response_usage: [{ input_tokens: 1, output_tokens: 1 }],
      },
      {
        role: "review",
        model: "dev-claude/claude-sonnet-4-6-thinking-high",
        status: "passed",
        response_count: 1,
        response_usage: [{ input_tokens: 1, output_tokens: 1 }],
      },
    ],
    skill_load_probes: ["v1", "v2"].map((version) => ({
      version,
      status: "passed",
      loaded_skill_path: `<smoke-${version}>/subject/self-evolution/SKILL.md`,
      subject_sha256: sha256(`smoke-${version}-subject`),
      effective_config_sha256: sha256(`smoke-${version}-config`),
      effective_config_probe_sha256: sha256(`smoke-${version}-config-probe`),
      probe_sha256: sha256(`smoke-${version}-skill-probe`),
      runtime_path: "/subject/self-evolution",
      runtime_status: "readable",
      runtime_sha256: sha256(`smoke-${version}-subject`),
      entrypoint: `${version}-entrypoint --help`,
      entrypoint_status: "passed",
      entrypoint_stdout_sha256: sha256(`${version}:entrypoint:stdout`),
      entrypoint_stderr_sha256: sha256(`${version}:entrypoint:stderr`),
      subject_write_status: "blocked",
      subject_write_stdout_sha256: sha256(`${version}:write:stdout`),
      subject_write_stderr_sha256: sha256(`${version}:write:stderr`),
    })),
  };
  const serialized = stableJson(summary);
  await writeFile(resolve(root, "smoke/smoke.json"), serialized, "utf8");
  const environment = {
    assurance: {
      network_enforcement:
        "windows-restricted-token+wsl-bwrap-user-net+deny-first-command-allowlist",
      network_namespace: "wsl-bwrap-unshare-user-net",
      network_canaries: "node+python+shell-wrapper+interop",
      filesystem_enforcement:
        "windows-restricted-token+reversible-forbidden-acl+wsl-bwrap-bind-map",
      windows_confinement:
        "codex-windows-restricted-token+reversible-coordinator-acl",
      codex_sandbox_profile: "external-opencode",
      toolchain_shim_enforcement:
        "opencode-config-shell-to-wsl-bwrap-unshare-user-net",
    },
    confinement: {
      ...Object.fromEntries(
        ["execution", "review"].map((role) => [
          role,
          {
            restricted_token: { status: "passed" },
            coordinator_acl: [
              {
                status: "restored",
                restore_receipt_sha256: sha256(`${role}:restore`),
              },
            ],
            windows_canary: { status: "passed" },
          },
        ]),
      ),
    },
    network_namespace_canaries: {
      execution: { status: "passed" },
      review: { status: "passed" },
    },
    credentials: Object.fromEntries(
      ["execution", "review"].map((role) => [
        role,
        {
          transport: "isolated-disk-only",
          content_env_absent: true,
          config_path_sha256: sha256(`${role}:config`),
          auth_path_sha256: null,
        },
      ]),
    ),
    instructions: { path: "AGENTS.md", sha256: sha256("agents") },
    shell_wrapper: {
      path_sha256: sha256("shell-path"),
      receipt_status: "not-exercised-by-config-probe",
      receipt_sha256: null,
      workspace_edit_runtime_sha256:
        FORMAL_CAMPAIGN_PROTOCOL.workspace_edit_runtime_sha256,
    },
    workspace_edit_gateway: {
      status: "passed",
      runtime_sha256: FORMAL_CAMPAIGN_PROTOCOL.workspace_edit_runtime_sha256,
      command_sha256: sha256("gateway-command"),
      patch_sha256: sha256("gateway-patch"),
      receipt_sha256: sha256("gateway-receipt"),
      stdout_sha256: sha256("gateway-stdout"),
      stderr_sha256: sha256("gateway-stderr"),
    },
  };
  const environmentSerialized = stableJson(environment);
  await writeFile(
    resolve(root, "smoke/environment.json"),
    environmentSerialized,
    "utf8",
  );
  const binding = {
    status: "passed",
    artifact: "smoke/smoke.json",
    sha256: sha256(serialized),
    environment_artifact: "smoke/environment.json",
    environment_sha256: sha256(environmentSerialized),
  };
  const files = {
    campaign: {
      execution_model: "zeo/gpt-5.5-high",
      review_model: "dev-claude/claude-sonnet-4-6-thinking-high",
      execution_assurance: {
        ...environment.assurance,
        credential_transport: "isolated-disk-only",
      },
      toolchain_shim_enforcement:
        environment.assurance.toolchain_shim_enforcement,
      workspace_edit_runtime_sha256:
        FORMAL_CAMPAIGN_PROTOCOL.workspace_edit_runtime_sha256,
      subjects: {
        v1: { sha256: sha256("smoke-v1-subject") },
        v2: { sha256: sha256("smoke-v2-subject") },
      },
      smoke: binding,
    },
    state: { smoke: { ...binding } },
  };
  await assert.doesNotReject(validateSmokeGate(root, files));
  summary.skill_load_probes[0].subject_write_status = "writable";
  const writableSubjectSerialized = stableJson(summary);
  await writeFile(
    resolve(root, "smoke/smoke.json"),
    writableSubjectSerialized,
    "utf8",
  );
  files.campaign.smoke.sha256 = sha256(writableSubjectSerialized);
  files.state.smoke.sha256 = sha256(writableSubjectSerialized);
  await assert.rejects(
    validateSmokeGate(root, files),
    /exact v1\/v2 skill-load probes/,
  );
  summary.skill_load_probes[0].subject_write_status = "blocked";
  environment.workspace_edit_gateway.status = "blocked";
  const blockedGatewayEnvironment = stableJson(environment);
  await writeFile(
    resolve(root, "smoke/environment.json"),
    blockedGatewayEnvironment,
    "utf8",
  );
  files.campaign.smoke.environment_sha256 = sha256(blockedGatewayEnvironment);
  files.state.smoke.environment_sha256 = sha256(blockedGatewayEnvironment);
  const restoredSummary = stableJson(summary);
  await writeFile(resolve(root, "smoke/smoke.json"), restoredSummary, "utf8");
  files.campaign.smoke.sha256 = sha256(restoredSummary);
  files.state.smoke.sha256 = sha256(restoredSummary);
  await assert.rejects(validateSmokeGate(root, files), /isolation gates/);
  environment.workspace_edit_gateway.status = "passed";
  const restoredEnvironment = stableJson(environment);
  await writeFile(
    resolve(root, "smoke/environment.json"),
    restoredEnvironment,
    "utf8",
  );
  files.campaign.smoke.environment_sha256 = sha256(restoredEnvironment);
  files.state.smoke.environment_sha256 = sha256(restoredEnvironment);
  summary.skill_load_probes[0].subject_sha256 = sha256(
    "tampered-smoke-subject",
  );
  const tamperedProbeSerialized = stableJson(summary);
  await writeFile(
    resolve(root, "smoke/smoke.json"),
    tamperedProbeSerialized,
    "utf8",
  );
  files.campaign.smoke.sha256 = sha256(tamperedProbeSerialized);
  files.state.smoke.sha256 = sha256(tamperedProbeSerialized);
  await assert.rejects(
    validateSmokeGate(root, files),
    /exact v1\/v2 skill-load probes/,
  );
  summary.skill_load_probes[0].subject_sha256 =
    files.campaign.subjects.v1.sha256;
  summary.results[1] = { ...summary.results[0] };
  const duplicateSerialized = stableJson(summary);
  await writeFile(
    resolve(root, "smoke/smoke.json"),
    duplicateSerialized,
    "utf8",
  );
  files.campaign.smoke.sha256 = sha256(duplicateSerialized);
  files.state.smoke.sha256 = sha256(duplicateSerialized);
  await assert.rejects(
    validateSmokeGate(root, files),
    /does not bind both models and usage/,
  );
  files.state.smoke.status = "blocked";
  await assert.rejects(
    validateSmokeGate(root, files),
    /smoke gate has not passed/,
  );
});

test("pinned WSL toolchain is exactly Node 22.13.1 and npm 10.9.2", async () => {
  const actual = await verifyPinnedToolchain();
  assert.equal(actual.node, PINNED_WSL_TOOLCHAIN.node);
  assert.equal(actual.npm, PINNED_WSL_TOOLCHAIN.npm);
});
