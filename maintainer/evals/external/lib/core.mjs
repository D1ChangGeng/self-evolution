import { createHash, randomBytes } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export const SCHEMA_VERSION = "1.0";
export const ATTEMPTS = Object.freeze([1, 2, 3]);
export const VERSIONS = Object.freeze(["v1", "v2"]);
export const PHASES = Object.freeze(["onboarding", "repair", "verification"]);
export const VERIFICATION_ARTIFACTS = Object.freeze({
  focused: "focused.json",
  full: "full.json",
  clean_install: "clean-install.json",
  patch_safety: "patch-safety.json",
});
export const VERDICT_SCORE_DIMENSIONS = Object.freeze([
  "correctness",
  "regression_safety",
  "scope_discipline",
  "knowledge_retrieval_credibility",
  "capture_value",
  "test_evidence",
  "final_delivery",
]);
const VERDICT_HARD_GATE_VALUES = Object.freeze(["pass", "fail", "uncertain"]);
const CAPTURE_ITEM_VERDICTS = Object.freeze([
  "low-value",
  "not-low-value",
  "unresolved",
]);
const CAMPAIGN_CHECKSUM_EXCLUDE = Object.freeze([
  /^SHA256SUMS$/,
  /^CHECKPOINTS\.jsonl$/,
  /^workspaces(?:\/|$)/,
  /(?:^|\/)node_modules(?:\/|$)/,
  /(?:^|\/)\.git(?:\/|$)/,
]);

export const CHECKPOINTS_FILE = "CHECKPOINTS.jsonl";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(name, message) {
  throw new Error(`${name}: ${message}`);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function fileSha256(path) {
  return sha256(await readFile(path));
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function assertSafeRelativePath(value, name = "path") {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => part === "" || part === "..")
  ) {
    fail(name, "must be a safe POSIX-style relative path");
  }
}

export function inside(root, candidate, name = "path") {
  const base = resolve(root);
  const target = resolve(candidate);
  const offset = relative(base, target);
  if (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  ) {
    return target;
  }
  fail(name, `escapes ${base}`);
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stableJson(value), "utf8");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function treeEntries(root, current, output, options) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (options.exclude?.some((pattern) => pattern.test(path))) continue;
    const metadata = await lstat(absolute);
    if (entry.isDirectory()) {
      output.push({
        path: `${path}/`,
        mode: metadata.mode & 0o777,
        type: "directory",
      });
      await treeEntries(root, absolute, output, options);
    } else if (entry.isSymbolicLink()) {
      fail(path, "symbolic links are not accepted in frozen campaign inputs");
    } else if (entry.isFile()) {
      const bytes = await readFile(absolute);
      output.push({
        path,
        mode: metadata.mode & 0o777,
        size: bytes.byteLength,
        sha256: sha256(bytes),
        type: "file",
      });
    }
  }
}

export async function hashTree(root, options = {}) {
  const absolute = resolve(root);
  if (!(await exists(absolute))) fail("tree", `${absolute} does not exist`);
  const entries = [];
  await treeEntries(absolute, absolute, entries, options);
  return { entries, sha256: sha256(stableJson(entries)) };
}

export const REPOSITORY_ROOT_HASH_EXCLUSIONS = Object.freeze([
  /^\.git(?:\/|$)/,
  /^node_modules(?:\/|$)/,
]);

export async function repositoryRootSha256(repositoryRoot) {
  return (
    await hashTree(repositoryRoot, {
      exclude: REPOSITORY_ROOT_HASH_EXCLUSIONS,
    })
  ).sha256;
}

/**
 * Hash a frozen archive with the same portable mode convention used by the
 * maintainer v1 baseline: shell hooks are executable and every other file is
 * regular.  `hashTree()` intentionally preserves host filesystem modes, so it
 * cannot be used as the baseline provenance digest on Windows/DrvFS.
 */
export async function archiveTreeHash(root) {
  const tree = await hashTree(root, { exclude: [/^\.git(?:\/|$)/] });
  const files = tree.entries
    .filter((entry) => entry.type === "file")
    .map((entry) => ({
      path: entry.path,
      mode: entry.path.endsWith(".sh") ? "100755" : "100644",
      sha256: entry.sha256,
    }));
  const input = [];
  for (const entry of files) {
    input.push(entry.path, "\0", entry.mode, "\0", entry.sha256, "\0");
  }
  return {
    entries: files.map(({ path, mode }) => ({ path, mode })),
    sha256: sha256(Buffer.from(input.join(""))),
  };
}

export function makeCampaignId(now = new Date(), entropy = randomBytes(4)) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `external-${stamp}-${Buffer.from(entropy).toString("hex")}`;
}

function seededOrder(items, seed) {
  return [...items]
    .map((item) => ({ item, key: sha256(`${seed}\0${stableJson(item)}`) }))
    .sort((left, right) => left.key.localeCompare(right.key, "en"))
    .map(({ item }) => item);
}

export function createSchedule(taskIds, campaignId, secret = randomBytes(32)) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    fail("taskIds", "must be a non-empty array");
  }
  const mapping = {};
  const units = [];
  for (const taskId of [...taskIds].sort((a, b) => a.localeCompare(b, "en"))) {
    for (const attempt of ATTEMPTS) {
      const pairId = `${taskId}-${attempt}`;
      const pairLabels = new Set();
      const labels = VERSIONS.map((version) => ({
        version,
        label: `arm-${sha256(`${Buffer.from(secret).toString("hex")}\0${pairId}\0${version}`).slice(0, 12)}`,
      }));
      for (const item of labels) {
        if (mapping[item.label] || pairLabels.has(item.label)) {
          fail("schedule", "opaque arm label collision");
        }
        pairLabels.add(item.label);
        mapping[item.label] = item.version;
      }
      for (const { version, label } of labels) {
        units.push({
          id: `${pairId}-${label}`,
          task_id: taskId,
          attempt,
          blind_label: label,
        });
      }
    }
  }
  const publicSchedule = {
    schema_version: SCHEMA_VERSION,
    campaign_id: campaignId,
    units: seededOrder(units, campaignId),
  };
  return {
    public: {
      ...publicSchedule,
    },
    sealed: {
      schema_version: SCHEMA_VERSION,
      campaign_id: campaignId,
      mapping,
      schedule_sha256: sha256(stableJson(publicSchedule)),
    },
  };
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(name, "must be a non-empty string");
  }
}

function requireStringArray(value, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(name, `must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  for (const [index, item] of value.entries()) {
    requireString(item, `${name}[${index}]`);
  }
}

function normalizeCommands(value, name, allowEmpty = false) {
  requireStringArray(value, name, { allowEmpty });
  return value;
}

export function normalizeTaskSpec(raw, directoryName = raw?.id ?? "task") {
  if (!isRecord(raw)) fail(directoryName, "task.json must contain an object");
  if (raw.schema_version !== SCHEMA_VERSION) {
    fail(`${directoryName}.schema_version`, `must be ${SCHEMA_VERSION}`);
  }
  requireString(raw.id, `${directoryName}.id`);
  if (!ID_PATTERN.test(raw.id))
    fail(`${directoryName}.id`, "must be kebab-case");
  if (directoryName !== raw.id) {
    fail(directoryName, `directory name must equal task id ${raw.id}`);
  }
  if (!isRecord(raw.repository))
    fail(`${raw.id}.repository`, "must be an object");
  for (const field of ["url", "base_sha", "oracle_sha", "license"]) {
    requireString(raw.repository[field], `${raw.id}.repository.${field}`);
  }
  for (const field of ["base_sha", "oracle_sha"]) {
    if (!/^[0-9a-f]{40}$/.test(raw.repository[field])) {
      fail(
        `${raw.id}.repository.${field}`,
        "must be a lowercase 40-character Git SHA",
      );
    }
  }
  if (!isRecord(raw.prompt)) fail(`${raw.id}.prompt`, "must be an object");
  requireString(raw.prompt.onboarding, `${raw.id}.prompt.onboarding`);
  requireString(raw.prompt.repair, `${raw.id}.prompt.repair`);
  if (!isRecord(raw.install)) fail(`${raw.id}.install`, "must be an object");
  if (!["existing", "generate"].includes(raw.install.lockfile_mode)) {
    fail(`${raw.id}.install.lockfile_mode`, "must be existing or generate");
  }
  normalizeCommands(
    raw.install.generation_commands ?? [],
    `${raw.id}.install.generation_commands`,
    true,
  );
  normalizeCommands(raw.install.commands, `${raw.id}.install.commands`);
  if (!isRecord(raw.validation))
    fail(`${raw.id}.validation`, "must be an object");
  for (const field of [
    "base_should_fail",
    "oracle_should_pass",
    "base_suite",
    "clean_ci",
    "focused",
    "full",
  ]) {
    normalizeCommands(raw.validation[field], `${raw.id}.validation.${field}`);
  }
  let validationEnvironment;
  if (raw.validation_environment !== undefined) {
    if (!isRecord(raw.validation_environment)) {
      fail(`${raw.id}.validation_environment`, "must be an object");
    }
    const preload = raw.validation_environment.preload ?? [];
    requireStringArray(preload, `${raw.id}.validation_environment.preload`, {
      allowEmpty: true,
    });
    for (const [index, path] of preload.entries()) {
      assertSafeRelativePath(
        path,
        `${raw.id}.validation_environment.preload[${index}]`,
      );
    }
    validationEnvironment = { preload };
  }
  const hiddenTests = Array.isArray(raw.hidden_tests)
    ? raw.hidden_tests
    : [raw.hidden_tests];
  if (hiddenTests.length === 0 || hiddenTests.some((item) => !isRecord(item))) {
    fail(`${raw.id}.hidden_tests`, "must contain one or more test mappings");
  }
  for (const [index, item] of hiddenTests.entries()) {
    for (const field of ["source", "destination"]) {
      assertSafeRelativePath(
        item[field],
        `${raw.id}.hidden_tests[${index}].${field}`,
      );
    }
  }
  return {
    ...raw,
    install: {
      ...raw.install,
      generation_commands: raw.install.generation_commands ?? [],
    },
    ...(validationEnvironment === undefined
      ? {}
      : { validation_environment: validationEnvironment }),
    hidden_tests: hiddenTests,
  };
}

export async function loadTaskSpecs(tasksRoot) {
  const directories = (await readdir(tasksRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const tasks = [];
  for (const directory of directories) {
    const taskPath = resolve(tasksRoot, directory.name, "task.json");
    if (!(await exists(taskPath))) continue;
    const task = normalizeTaskSpec(await readJson(taskPath), directory.name);
    const taskRoot = resolve(tasksRoot, directory.name);
    for (const [index, path] of (
      task.validation_environment?.preload ?? []
    ).entries()) {
      const preloadPath = inside(
        taskRoot,
        resolve(taskRoot, path),
        `${task.id}.validation_environment.preload[${index}]`,
      );
      if (!(await exists(preloadPath)) || !(await stat(preloadPath)).isFile()) {
        fail(
          `${task.id}.validation_environment.preload[${index}]`,
          `${path} must name an existing regular file`,
        );
      }
    }
    const taskTree = await hashTree(taskRoot);
    tasks.push({ ...task, contract_sha256: taskTree.sha256 });
  }
  if (tasks.length === 0)
    fail("tasks", `no task.json files found under ${tasksRoot}`);
  return tasks;
}

export async function freezeSubjects(repositoryRoot, targetRoot) {
  const v1Source = resolve(repositoryRoot, "legacy/v1/skill");
  const v1BaselinePath = resolve(
    repositoryRoot,
    "maintainer/evals/baseline/v1.json",
  );
  const v2SkillSource = resolve(repositoryRoot, "skills/self-evolution");
  const v2BundleSource = resolve(
    repositoryRoot,
    "skills/self-evolution/references/bin/kb.mjs",
  );
  for (const path of [
    v1Source,
    v1BaselinePath,
    v2SkillSource,
    v2BundleSource,
  ]) {
    if (!(await exists(path))) fail("subject", `${path} is missing`);
  }
  const v1Baseline = await readJson(v1BaselinePath);
  const v1Archive = await archiveTreeHash(v1Source);
  if (v1Archive.sha256 !== v1Baseline.source?.archive_tree_sha256) {
    fail("subject", "frozen v1 archive does not match baseline/v1.json");
  }
  const v1LegacySource = resolve(v1Source, "SKILL.v1.md");
  const v1LegacyBytes = (await readFile(v1LegacySource, "utf8")).replace(
    /\r\n?/g,
    "\n",
  );
  const v1SkillSha256 = sha256(Buffer.from(v1LegacyBytes));
  if (v1SkillSha256 !== v1Baseline.source?.skill_sha256) {
    fail("subject", "frozen v1 skill does not match baseline/v1.json");
  }
  const subjectRoot = resolve(targetRoot, "subjects");
  const v1Target = resolve(subjectRoot, "v1/self-evolution");
  const v2Target = resolve(subjectRoot, "v2/self-evolution");
  await rm(subjectRoot, { recursive: true, force: true });
  await mkdir(v1Target, { recursive: true });
  await mkdir(v2Target, { recursive: true });
  await cp(v1Source, v1Target, { recursive: true, preserveTimestamps: true });
  await cp(v2SkillSource, v2Target, {
    recursive: true,
    preserveTimestamps: true,
  });
  const v1LegacyPath = resolve(v1Target, "SKILL.v1.md");
  const v1SkillPath = resolve(v1Target, "SKILL.md");
  await cp(v1LegacyPath, v1SkillPath, {
    force: true,
    preserveTimestamps: true,
  });
  await rm(v1LegacyPath, { force: true });
  const v1 = await hashTree(v1Target);
  const v2Skill = await hashTree(v2Target);
  const v2Bundle = await fileSha256(resolve(v2Target, "references/bin/kb.mjs"));
  const v2Subject = sha256(
    stableJson({ bundle_sha256: v2Bundle, skill_tree_sha256: v2Skill.sha256 }),
  );
  return {
    v1: {
      path: v1Target,
      sha256: v1.sha256,
      tree: v1.entries,
      archive_sha256: v1Archive.sha256,
      skill_sha256: v1SkillSha256,
      source_commit_sha: v1Baseline.source?.source_commit_sha,
    },
    v2: {
      path: v2Target,
      sha256: v2Subject,
      skill_tree_sha256: v2Skill.sha256,
      bundle_sha256: v2Bundle,
      tree: v2Skill.entries,
    },
  };
}

export function initialState(schedule) {
  return {
    schema_version: SCHEMA_VERSION,
    campaign_id: schedule.campaign_id,
    updated_at: new Date(0).toISOString(),
    units: Object.fromEntries(
      schedule.units.map((unit) => [
        unit.id,
        {
          task_id: unit.task_id,
          attempt: unit.attempt,
          blind_label: unit.blind_label,
          phases: Object.fromEntries(
            PHASES.map((phase) => [phase, { status: "pending", attempts: 0 }]),
          ),
        },
      ]),
    ),
    reviews: Object.fromEntries(
      [
        ...new Set(
          schedule.units.map((unit) => `${unit.task_id}-${unit.attempt}`),
        ),
      ].map((pair) => [pair, { status: "pending", attempts: 0 }]),
    ),
    review_seal: {
      status: "pending",
      expected: new Set(
        schedule.units.map((unit) => `${unit.task_id}-${unit.attempt}`),
      ).size,
      verdicts_sha256: null,
      sealed_at: null,
    },
  };
}

export function validateOnboardingEvidence(evidence) {
  if (!isRecord(evidence)) fail("onboarding evidence", "must be an object");
  const violations = [];
  if (evidence.source_or_test_changed) violations.push("source-or-test-change");
  if (evidence.path_escape_detected) violations.push("path-escape");
  if (evidence.network_violation_detected) violations.push("network-access");
  const trace = Array.isArray(evidence.filesystem_trace)
    ? evidence.filesystem_trace
    : [];
  const writeAllowlist = [/^AGENTS\.md$/, /^\.agents(?:\/|$)/];
  for (const item of trace) {
    if (item?.access !== "write") continue;
    if (typeof item.path !== "string") {
      violations.push("write:unresolved-path");
      continue;
    }
    if (!writeAllowlist.some((pattern) => pattern.test(item.path))) {
      violations.push(`write:${item.path}`);
    }
  }
  return { valid: violations.length === 0, violations };
}

const KNOWLEDGE_WRITE_ALLOWLIST = [/^AGENTS\.md$/, /^\.agents(?:\/|$)/];

function isKnowledgeWritePath(path) {
  return (
    typeof path === "string" &&
    KNOWLEDGE_WRITE_ALLOWLIST.some((pattern) => pattern.test(path))
  );
}

export function validateWorkspaceEditEvidence(evidence, phase) {
  if (!isRecord(evidence)) fail(`${phase} evidence`, "must be an object");
  if (!["onboarding", "repair"].includes(phase)) {
    fail("workspace edit evidence", "phase must be onboarding or repair");
  }
  const workspaceEdit = evidence.workspace_edit;
  if (
    !isRecord(workspaceEdit) ||
    workspaceEdit.schema_version !== SCHEMA_VERSION ||
    !nonNegativeInteger(workspaceEdit.receipt_count) ||
    !Array.isArray(workspaceEdit.receipts) ||
    workspaceEdit.receipts.length !== workspaceEdit.receipt_count ||
    !Array.isArray(workspaceEdit.covered_paths) ||
    !Array.isArray(workspaceEdit.unreceipted_changes)
  ) {
    return { valid: false, violations: ["invalid-workspace-edit-evidence"] };
  }
  const violations = [];
  for (const path of workspaceEdit.unreceipted_changes) {
    if (typeof path !== "string" || !isKnowledgeWritePath(path)) {
      violations.push(
        typeof path === "string"
          ? `unreceipted:${path}`
          : "unreceipted:unresolved-path",
      );
    }
  }
  if (phase === "onboarding") {
    for (const path of workspaceEdit.covered_paths) {
      if (typeof path !== "string" || !isKnowledgeWritePath(path)) {
        violations.push(
          typeof path === "string"
            ? `onboarding-edit:${path}`
            : "onboarding-edit:unresolved-path",
        );
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

function validateScoreArm(score, name) {
  if (!isRecord(score)) fail(name, "must be an object");
  const required = VERDICT_SCORE_DIMENSIONS;
  const optional = new Set(["capture_item_labels"]);
  const keys = Object.keys(score);
  for (const dimension of required) {
    if (!keys.includes(dimension)) fail(name, `is missing ${dimension}`);
  }
  for (const key of keys) {
    if (!required.includes(key) && !optional.has(key)) {
      fail(name, `contains unexpected field ${key}`);
    }
  }
  for (const dimension of ["correctness", "regression_safety"]) {
    if (!VERDICT_HARD_GATE_VALUES.includes(score[dimension])) {
      fail(`${name}.${dimension}`, "must be pass, fail, or uncertain");
    }
  }
  for (const dimension of required.slice(2)) {
    if (
      !Number.isInteger(score[dimension]) ||
      score[dimension] < 1 ||
      score[dimension] > 5
    ) {
      fail(`${name}.${dimension}`, "must be an integer from 1 through 5");
    }
  }
  if (score.capture_item_labels === undefined) return;
  if (!Array.isArray(score.capture_item_labels)) {
    fail(`${name}.capture_item_labels`, "must be an array when present");
  }
  const ids = new Set();
  for (const [index, label] of score.capture_item_labels.entries()) {
    const itemName = `${name}.capture_item_labels[${index}]`;
    if (!isRecord(label)) fail(itemName, "must be an object");
    if (
      stableJson(Object.keys(label).sort()) !== stableJson(["id", "verdict"])
    ) {
      fail(itemName, "must contain exactly id and verdict");
    }
    requireString(label.id, `${itemName}.id`);
    if (ids.has(label.id)) fail(itemName, "duplicates a capture item id");
    ids.add(label.id);
    if (!CAPTURE_ITEM_VERDICTS.includes(label.verdict)) {
      fail(
        `${itemName}.verdict`,
        "must be low-value, not-low-value, or unresolved",
      );
    }
  }
}

export function validateVerdictScores(scores, name = "verdict.scores") {
  if (!isRecord(scores)) fail(name, "must be an object");
  if (stableJson(Object.keys(scores).sort()) !== stableJson(["A", "B"])) {
    fail(name, "must contain exactly A and B");
  }
  validateScoreArm(scores.A, `${name}.A`);
  validateScoreArm(scores.B, `${name}.B`);
  return scores;
}

export function validateVerdictWinner(scores, winner, name = "verdict") {
  if (winner === "tie") return;
  if (!["A", "B"].includes(winner))
    fail(`${name}.winner`, "must be A, B, or tie");
  const selected = scores?.[winner];
  if (
    selected?.correctness !== "pass" ||
    selected?.regression_safety !== "pass"
  ) {
    fail(
      `${name}.winner`,
      "cannot select an arm unless correctness and regression_safety both pass",
    );
  }
}

export function validateVerdict(verdict, pair) {
  if (!isRecord(verdict)) fail("verdict", "must be an object");
  if (
    stableJson(Object.keys(verdict).sort()) !==
    stableJson([
      "arms",
      "attempt",
      "rationale",
      "schema_version",
      "scores",
      "task_id",
      "winner",
    ])
  ) {
    fail("verdict", "must contain exactly the declared top-level fields");
  }
  if (verdict.schema_version !== SCHEMA_VERSION)
    fail("verdict.schema_version", `must be ${SCHEMA_VERSION}`);
  if (verdict.task_id !== pair[0]?.task_id)
    fail("verdict.task_id", "does not match pair");
  if (verdict.attempt !== pair[0]?.attempt)
    fail("verdict.attempt", "does not match pair");
  if (!isRecord(verdict.arms)) fail("verdict.arms", "must be an object");
  const actualKeys = Object.keys(verdict.arms).sort();
  if (stableJson(actualKeys) !== stableJson(["A", "B"]))
    fail("verdict.arms", "must contain exactly A and B");
  const expectedLabels = pair
    .map((unit) => unit.blind_label)
    .sort((left, right) => left.localeCompare(right, "en"));
  const actualLabels = [verdict.arms.A, verdict.arms.B].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (stableJson(actualLabels) !== stableJson(expectedLabels))
    fail("verdict.arms", "must bind exactly the opaque labels in this pair");
  if (verdict.arms.A === verdict.arms.B)
    fail("verdict.arms", "must bind distinct opaque labels");
  if (!["A", "B", "tie"].includes(verdict.winner))
    fail("verdict.winner", "must be A, B, or tie");
  requireString(verdict.rationale, "verdict.rationale");
  validateVerdictScores(verdict.scores);
  validateVerdictWinner(verdict.scores, verdict.winner);
  return verdict;
}

export function validateVerdictAgainstRuns(verdict, runs) {
  if (verdict.winner === "tie") return verdict;
  const winningLabel = verdict.arms?.[verdict.winner];
  const winningRun = runs.find(
    (run) =>
      run.task_id === verdict.task_id &&
      run.attempt === verdict.attempt &&
      run.blind_label === winningLabel,
  );
  if (!hardCorrect(winningRun)) {
    fail(
      "verdict.winner",
      "cannot select an arm without matching hard-correct run evidence",
    );
  }
  return verdict;
}

export function expectedCoverage(taskIds) {
  const runKeys = [];
  const reviewKeys = [];
  for (const taskId of taskIds) {
    for (const attempt of ATTEMPTS) {
      reviewKeys.push(`${taskId}:${attempt}`);
      for (const version of VERSIONS)
        runKeys.push(`${taskId}:${attempt}:${version}`);
    }
  }
  return { runKeys, reviewKeys };
}

export function reviewSealDigest(verdicts) {
  const seen = new Set();
  const tuples = verdicts
    .map((verdict) => {
      const key = `${verdict.task_id}:${verdict.attempt}`;
      if (seen.has(key)) fail("review seal", `duplicates verdict ${key}`);
      seen.add(key);
      return {
        task_id: verdict.task_id,
        attempt: verdict.attempt,
        arms: verdict.arms,
        winner: verdict.winner,
        sha256: verdict.sha256,
      };
    })
    .sort((left, right) =>
      `${left.task_id}:${left.attempt}`.localeCompare(
        `${right.task_id}:${right.attempt}`,
        "en",
      ),
    );
  return sha256(stableJson(tuples));
}

export function sealReviews(state, verdicts) {
  const expected =
    state.review_seal?.expected ?? Object.keys(state.reviews).length;
  const completed = Object.values(state.reviews).filter(
    (item) => item.status === "completed",
  ).length;
  if (completed !== expected || verdicts.length !== expected) {
    fail(
      "review seal",
      `requires all ${expected} verdicts before reveal; received ${completed} completed states and ${verdicts.length} artifacts`,
    );
  }
  state.review_seal = {
    status: "sealed",
    expected,
    verdicts_sha256: reviewSealDigest(verdicts),
    sealed_at: new Date().toISOString(),
  };
  return state.review_seal;
}

export function validateStateChain(state, schedule, mapping) {
  const unitById = new Map(schedule.units.map((unit) => [unit.id, unit]));
  if (Object.keys(state.units).length !== unitById.size)
    fail("state.units", "does not exactly cover the schedule");
  for (const [id, unit] of unitById) {
    const record = state.units[id];
    if (!record) fail("state.units", `is missing ${id}`);
    if (
      record.task_id !== unit.task_id ||
      record.attempt !== unit.attempt ||
      record.blind_label !== unit.blind_label ||
      !VERSIONS.includes(mapping[unit.blind_label])
    ) {
      fail("state.units", `${id} does not match the frozen schedule`);
    }
    const onboarding = record.phases?.onboarding?.status;
    const repair = record.phases?.repair?.status;
    const verification = record.phases?.verification?.status;
    if (repair !== "pending" && onboarding !== "completed")
      fail("state chain", `${id} repair started before onboarding completed`);
    if (verification !== "pending" && repair !== "completed")
      fail("state chain", `${id} verification started before repair completed`);
  }
  const expectedPairs = new Map();
  for (const unit of schedule.units) {
    const key = `${unit.task_id}-${unit.attempt}`;
    if (!expectedPairs.has(key)) expectedPairs.set(key, []);
    expectedPairs.get(key).push(unit);
  }
  if (Object.keys(state.reviews).length !== expectedPairs.size)
    fail("state.reviews", "does not exactly cover scheduled pairs");
  for (const [key, pair] of expectedPairs) {
    const review = state.reviews[key];
    if (!review) fail("state.reviews", `is missing ${key}`);
    if (
      !["pending", "retryable"].includes(review.status) &&
      pair.some((unit) => !isTerminalUnitState(state.units[unit.id]))
    ) {
      fail("state chain", `${key} review started before both runs terminated`);
    }
  }
  if (state.review_seal?.status === "sealed") {
    const completed = Object.values(state.reviews).filter(
      (review) => review.status === "completed",
    ).length;
    if (completed !== expectedPairs.size)
      fail("review seal", "was created before exact review coverage completed");
  }
  return true;
}

export function isTerminalUnitState(record) {
  if (!record?.phases) return false;
  if (record.phases.verification?.status === "completed") return true;
  return PHASES.some((phase) =>
    ["failed", "blocked"].includes(record.phases[phase]?.status),
  );
}

export function transitionState(state, target, status, details = {}) {
  if (
    !["pending", "running", "completed", "failed", "blocked"].includes(status)
  ) {
    fail("status", `${status} is invalid`);
  }
  const current = target.phase
    ? state.units?.[target.unit]?.phases?.[target.phase]
    : state.reviews?.[target.pair];
  if (!current) fail("state", "transition target does not exist");
  const invalidReviewRetry =
    !target.phase &&
    current.status === "retryable" &&
    status === "running" &&
    current.error_category === "schema-invalid";
  if (current.status === "completed" && status !== "completed") {
    fail("state", "completed work cannot be downgraded during resume");
  }
  if (current.status === "failed" || current.status === "blocked") {
    fail("state", `${current.status} work cannot be rerun during resume`);
  }
  if (
    status === "running" &&
    current.status !== "pending" &&
    !invalidReviewRetry
  ) {
    fail("state", `${current.status} work cannot be restarted during resume`);
  }
  if (status === "pending" && current.status !== "pending") {
    fail("state", `${current.status} work cannot return to pending`);
  }
  current.status = status;
  if (status === "running") current.attempts += 1;
  Object.assign(current, details);
  state.updated_at = new Date().toISOString();
  return state;
}

export function markReviewSchemaInvalid(state, pair, details = {}) {
  const current = state.reviews?.[pair];
  if (!current) fail("state", "review target does not exist");
  if (current.status !== "running") {
    fail("state", "only a running review can be marked schema-invalid");
  }
  current.status = "retryable";
  current.error_category = "schema-invalid";
  Object.assign(current, details);
  state.updated_at = new Date().toISOString();
  return state;
}

export function hardCorrect(run) {
  return (
    run?.status === "completed" &&
    run?.verification?.hidden_tests === "pass" &&
    run?.verification?.full_suite === "pass" &&
    run?.verification?.regression_safety === "pass"
  );
}

export function verificationArtifactBindingDigest(verification) {
  return sha256(
    stableJson({
      schema_version: verification?.schema_version,
      task_id: verification?.task_id,
      attempt: verification?.attempt,
      blind_label: verification?.blind_label,
      artifacts: Object.fromEntries(
        Object.keys(VERIFICATION_ARTIFACTS).map((name) => [
          name,
          verification?.artifact_bindings?.[name],
        ]),
      ),
      patch_sha256: verification?.patch_sha256,
      changed_paths_sha256: verification?.changed_paths_sha256,
      patch_binding_sha256: verification?.patch_binding_sha256,
    }),
  );
}

function artifactPathMatches(record, expected) {
  return (
    typeof record?.path === "string" &&
    (record.path === expected ||
      record.path.endsWith(`/verification/${expected}`))
  );
}

export function verificationEvidence(run, { strict = false } = {}) {
  const binding = {
    status: run?.verification ? "missing" : "not-required",
    path: run?.raw_verification?.verification?.path ?? null,
    sha256: SHA256_PATTERN.test(run?.raw_verification?.verification?.sha256)
      ? run.raw_verification.verification.sha256
      : null,
  };
  if (!run?.verification) return binding;
  const raw = run.raw_verification;
  const verificationArtifact = raw?.verification;
  if (
    verificationArtifact?.status !== "loaded" ||
    !binding.sha256 ||
    !isRecord(verificationArtifact.value)
  ) {
    return binding;
  }
  const verification = verificationArtifact.value;
  if (
    stableJson(verification) !== stableJson(run.verification) ||
    verification.schema_version !== SCHEMA_VERSION ||
    verification.task_id !== run.task_id ||
    verification.attempt !== run.attempt ||
    verification.blind_label !== run.blind_label
  ) {
    binding.status = "tuple-or-cache-mismatch";
    return binding;
  }
  if (!strict) {
    binding.status = "verified";
    return binding;
  }
  const recorded = run.execution_bindings?.verification;
  if (
    !isRecord(recorded) ||
    recorded.verification_artifact_sha256 !== binding.sha256 ||
    recorded.artifact_binding_sha256 !==
      verification.artifact_bindings?.binding_sha256 ||
    recorded.patch_binding_sha256 !== verification.patch_binding_sha256
  ) {
    binding.status = "run-verification-binding-mismatch";
    return binding;
  }
  for (const [name, expectedPath] of Object.entries(VERIFICATION_ARTIFACTS)) {
    const declared = verification.artifact_bindings?.[name];
    const artifact = raw?.[name];
    if (
      !isRecord(declared) ||
      declared.path !== expectedPath ||
      !SHA256_PATTERN.test(declared.artifact_sha256) ||
      !SHA256_PATTERN.test(declared.value_sha256) ||
      artifact?.status !== "loaded" ||
      !artifactPathMatches(artifact, expectedPath) ||
      artifact.sha256 !== declared.artifact_sha256 ||
      !isRecord(artifact.value) ||
      sha256(stableJson(artifact.value)) !== declared.value_sha256 ||
      stableJson(artifact.value) !== stableJson(verification[name])
    ) {
      binding.status = `invalid-${name}-artifact`;
      return binding;
    }
  }
  if (
    raw?.patch?.status !== "loaded" ||
    raw.patch.sha256 !== verification.patch_sha256 ||
    raw?.changed_paths?.status !== "loaded" ||
    raw.changed_paths.sha256 !== verification.changed_paths_sha256 ||
    verification.patch_binding_sha256 !==
      sha256(
        stableJson({
          changed_paths_sha256: verification.changed_paths_sha256,
          patch_sha256: verification.patch_sha256,
        }),
      ) ||
    verification.artifact_bindings?.binding_sha256 !==
      verificationArtifactBindingDigest(verification)
  ) {
    binding.status = "invalid-patch-or-artifact-binding";
    return binding;
  }
  binding.status = "verified";
  return binding;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function measuredSum(values, expectedCount, unit) {
  const measuredCount = values.filter(nonNegativeInteger).length;
  const measured =
    values.length === expectedCount && measuredCount === expectedCount;
  return {
    status: measured ? "measured" : "not-measured",
    unit,
    value: measured ? values.reduce((total, value) => total + value, 0) : null,
    measured_runs: measuredCount,
    expected_runs: expectedCount,
  };
}

export function evidencePhase(
  run,
  phase,
  { strict = false, expectedBindings = null } = {},
) {
  const artifact = run?.raw_evidence?.[phase];
  const binding = {
    status: artifact?.status ?? "missing",
    path: typeof artifact?.path === "string" ? artifact.path : null,
    sha256: SHA256_PATTERN.test(artifact?.sha256) ? artifact.sha256 : null,
    metrics_cache_status: "unverifiable",
  };
  if (
    artifact?.status !== "loaded" ||
    !binding.sha256 ||
    !isRecord(artifact.value)
  ) {
    if (artifact?.status === "loaded") binding.status = "invalid-binding";
    return { binding, metric: null };
  }
  const evidence = artifact.value;
  if (
    (strict && evidence.schema_version !== SCHEMA_VERSION) ||
    (strict && evidence.campaign_id !== run.campaign_id) ||
    evidence.task_id !== run.task_id ||
    evidence.attempt !== run.attempt ||
    evidence.blind_label !== run.blind_label ||
    evidence.phase !== phase
  ) {
    binding.status = "tuple-mismatch";
    return { binding, metric: null };
  }
  if (strict) {
    const workspace = evidence.workspace_manifest;
    const workspaceRecordValid = (record, expectedPath) =>
      isRecord(record) &&
      record.path === expectedPath &&
      SHA256_PATTERN.test(record.artifact_sha256) &&
      SHA256_PATTERN.test(record.manifest_sha256) &&
      nonNegativeInteger(record.file_count) &&
      nonNegativeInteger(record.total_bytes);
    const workspaceDiffValid =
      isRecord(workspace?.diff) &&
      workspace.diff.path === "workspace-diff.json" &&
      SHA256_PATTERN.test(workspace.diff.artifact_sha256) &&
      SHA256_PATTERN.test(workspace.diff.binding_sha256) &&
      nonNegativeInteger(workspace.diff.change_count) &&
      Array.isArray(workspace.diff.changes) &&
      workspace.diff.changes.length === workspace.diff.change_count;
    const sessionChainValid =
      phase !== "repair" || evidence.session_chain?.status === "matched";
    const workspaceEditValid = validateWorkspaceEditEvidence(
      evidence,
      phase,
    ).valid;
    const integrityValid =
      Array.isArray(evidence.parse_errors) &&
      evidence.parse_errors.length === 0 &&
      evidence.path_escape_detected === false &&
      evidence.network_violation_detected === false &&
      evidence.child_session_detected === false &&
      evidence.skill_load?.status === "passed" &&
      typeof evidence.skill_load?.loaded_skill_path === "string" &&
      evidence.skill_load.loaded_skill_path_matches_subject === true &&
      SHA256_PATTERN.test(evidence.skill_load?.subject_sha256) &&
      SHA256_PATTERN.test(evidence.skill_load?.probe_sha256) &&
      SHA256_PATTERN.test(evidence.effective_config?.sha256) &&
      evidence.effective_config?.disk_and_environment_identical === true &&
      workspace?.schema_version === SCHEMA_VERSION &&
      workspace.algorithm === "sha256" &&
      Array.isArray(workspace.exclusions) &&
      workspaceRecordValid(workspace.pre, "workspace.pre.json") &&
      workspaceRecordValid(workspace.post, "workspace.post.json") &&
      workspaceDiffValid &&
      workspaceEditValid &&
      sessionChainValid &&
      SHA256_PATTERN.test(workspace.final_state_binding_sha256) &&
      evidence.workspace_tree_sha256 === workspace.post.manifest_sha256 &&
      evidence.randomness?.seed_support === "not-supported" &&
      evidence.randomness?.seed === "not-measured" &&
      evidence.randomness?.variant === null &&
      typeof evidence.assurance?.network_enforcement === "string" &&
      evidence.assurance.network_enforcement.length > 0 &&
      evidence.assurance?.filesystem_trace_kind ===
        "opencode-tool-event-derived" &&
      evidence.assurance?.workspace_state === "pre-post-byte-manifest" &&
      evidence.assurance?.workspace_event_trace ===
        "opencode-tool-event-derived" &&
      evidence.assurance?.filesystem_audit === "not-syscall-audit" &&
      evidence.assurance?.child_sessions === "denied" &&
      isRecord(evidence.confinement) &&
      ["enforced", "passed"].includes(
        evidence.confinement.restricted_token?.status,
      ) &&
      Array.isArray(evidence.confinement.coordinator_acl) &&
      evidence.confinement.coordinator_acl.length > 0 &&
      evidence.confinement.coordinator_acl.every(
        (launch) =>
          ["restored", "not-applicable"].includes(launch?.status) &&
          (launch.status === "not-applicable" ||
            SHA256_PATTERN.test(launch?.restore_receipt_sha256)),
      ) &&
      ["passed", "not-applicable"].includes(
        evidence.confinement.windows_canary?.status,
      ) &&
      evidence.credentials?.transport === "isolated-disk-only" &&
      evidence.credentials?.content_env_absent === true &&
      evidence.instructions?.path === "AGENTS.md" &&
      SHA256_PATTERN.test(evidence.instructions?.sha256) &&
      evidence.shell_wrapper?.canary_status === "passed" &&
      SHA256_PATTERN.test(
        evidence.shell_wrapper?.workspace_edit_runtime_sha256,
      );
    if (!integrityValid) {
      binding.status = "invalid-execution-integrity";
      return { binding, metric: null };
    }
    const recorded = run?.execution_bindings?.[phase];
    const recordedBindingValid =
      isRecord(recorded) &&
      SHA256_PATTERN.test(recorded.subject_sha256) &&
      typeof recorded.loaded_skill_path === "string" &&
      recorded.loaded_skill_path.length > 0 &&
      SHA256_PATTERN.test(recorded.skill_load_probe_sha256) &&
      SHA256_PATTERN.test(recorded.effective_config_sha256) &&
      SHA256_PATTERN.test(recorded.effective_config_probe_sha256) &&
      SHA256_PATTERN.test(recorded.toolchain_shim_sha256) &&
      SHA256_PATTERN.test(recorded.toolchain_sha256) &&
      SHA256_PATTERN.test(recorded.workspace_final_state_binding_sha256) &&
      SHA256_PATTERN.test(recorded.workspace_post_manifest_sha256) &&
      (phase !== "repair" ||
        SHA256_PATTERN.test(recorded.session_chain_sha256)) &&
      SHA256_PATTERN.test(recorded.confinement_sha256) &&
      SHA256_PATTERN.test(recorded.credentials_sha256) &&
      SHA256_PATTERN.test(recorded.instructions_sha256) &&
      SHA256_PATTERN.test(recorded.shell_wrapper_sha256) &&
      recorded.subject_sha256 === evidence.skill_load.subject_sha256 &&
      recorded.loaded_skill_path === evidence.skill_load.loaded_skill_path &&
      recorded.skill_load_probe_sha256 === evidence.skill_load.probe_sha256 &&
      recorded.effective_config_sha256 === evidence.effective_config.sha256 &&
      recorded.effective_config_probe_sha256 ===
        evidence.effective_config.resolved_probe_sha256 &&
      recorded.toolchain_shim_sha256 === evidence.toolchain_shims?.sha256 &&
      recorded.toolchain_shim_enforcement ===
        evidence.toolchain_shims?.enforcement &&
      recorded.toolchain_sha256 ===
        sha256(stableJson(evidence.toolchain_shims?.toolchain)) &&
      recorded.workspace_final_state_binding_sha256 ===
        workspace.final_state_binding_sha256 &&
      recorded.workspace_post_manifest_sha256 ===
        workspace.post.manifest_sha256 &&
      (phase !== "repair" ||
        recorded.session_chain_sha256 ===
          sha256(stableJson(evidence.session_chain))) &&
      recorded.confinement_sha256 ===
        sha256(stableJson(evidence.confinement)) &&
      recorded.credentials_sha256 ===
        sha256(stableJson(evidence.credentials)) &&
      recorded.instructions_sha256 ===
        sha256(stableJson(evidence.instructions)) &&
      recorded.shell_wrapper_sha256 ===
        sha256(stableJson(evidence.shell_wrapper));
    if (!recordedBindingValid) {
      binding.status = "run-execution-binding-mismatch";
      return { binding, metric: null };
    }
    if (expectedBindings) {
      const subject = evidence.subject;
      const expectedSubjectSha256 = expectedBindings.subject_sha256;
      const expectedToolchain = expectedBindings.toolchain;
      const expectedAssurance = expectedBindings.assurance;
      const expectedConfigSha256 = expectedBindings.effective_config_sha256;
      const executionBindingValid =
        SHA256_PATTERN.test(expectedSubjectSha256) &&
        subject?.original_before_sha256 === expectedSubjectSha256 &&
        subject?.original_after_sha256 === expectedSubjectSha256 &&
        subject?.copy_before_sha256 === expectedSubjectSha256 &&
        subject?.copy_after_sha256 === expectedSubjectSha256 &&
        subject?.unchanged === true &&
        evidence.skill_load.subject_sha256 === expectedSubjectSha256 &&
        (!expectedConfigSha256 ||
          evidence.effective_config.sha256 === expectedConfigSha256) &&
        SHA256_PATTERN.test(evidence.effective_config.resolved_probe_sha256) &&
        isRecord(expectedToolchain) &&
        stableJson(evidence.toolchain_shims?.toolchain) ===
          stableJson(expectedToolchain) &&
        evidence.toolchain_shims?.enforcement ===
          expectedBindings.toolchain_shim_enforcement &&
        SHA256_PATTERN.test(evidence.toolchain_shims?.sha256) &&
        (!expectedBindings.workspace_edit_runtime_sha256 ||
          evidence.shell_wrapper.workspace_edit_runtime_sha256 ===
            expectedBindings.workspace_edit_runtime_sha256) &&
        (!expectedAssurance ||
          Object.entries(expectedAssurance).every(
            ([key, value]) => evidence.assurance?.[key] === value,
          ));
      if (!executionBindingValid) {
        binding.status = "execution-binding-mismatch";
        return { binding, metric: null };
      }
    }
  }
  const usage = evidence.usage;
  const usageValue = usage?.value;
  const usageMeasured =
    usage?.status === "measured" &&
    isRecord(usageValue) &&
    nonNegativeInteger(usageValue.input_tokens) &&
    nonNegativeInteger(usageValue.output_tokens);
  const selectedContext = Array.isArray(evidence.selected_context)
    ? evidence.selected_context
    : null;
  const knowledgeDiff = Array.isArray(evidence.knowledge_diff)
    ? evidence.knowledge_diff
    : null;
  const capture = Array.isArray(evidence.capture) ? evidence.capture : null;
  const selectedContextValid = selectedContext?.every(
    (item) =>
      isRecord(item) &&
      typeof item.path === "string" &&
      nonNegativeInteger(item.bytes),
  );
  const knowledgeDiffValid = knowledgeDiff?.every(
    (item) =>
      isRecord(item) &&
      typeof item.path === "string" &&
      ["added", "modified", "removed"].includes(item.change) &&
      (item.change === "removed" || nonNegativeInteger(item.bytes)),
  );
  const captureValid = capture?.every(
    (item) => isRecord(item) && typeof item.path === "string",
  );
  const metric = {
    usage_status: usageMeasured ? "measured" : "not-measured",
    input_tokens: usageMeasured ? usageValue.input_tokens : null,
    output_tokens: usageMeasured ? usageValue.output_tokens : null,
    duration_ms: nonNegativeInteger(evidence.execution?.duration_ms)
      ? evidence.execution.duration_ms
      : null,
    selected_context_bytes: selectedContextValid
      ? selectedContext.reduce((total, item) => total + item.bytes, 0)
      : null,
    knowledge_bytes: knowledgeDiffValid
      ? knowledgeDiff.reduce(
          (total, item) => total + (item.change === "removed" ? 0 : item.bytes),
          0,
        )
      : null,
    capture_items: captureValid ? capture.length : null,
  };
  binding.status = "verified";
  binding.metrics_cache_status = !isRecord(run?.metrics?.[phase])
    ? "missing"
    : stableJson(run.metrics[phase]) === stableJson(metric)
      ? "match"
      : "mismatch";
  return { binding, metric };
}

function runPhaseMetric(run, phase, field, { usage = false } = {}) {
  const metric = evidencePhase(run, phase).metric;
  if (!isRecord(metric)) return null;
  if (usage && metric.usage_status !== "measured") return null;
  return nonNegativeInteger(metric[field]) ? metric[field] : null;
}

function sumRunMetrics(run, field, { usage = false } = {}) {
  const onboarding = runPhaseMetric(run, "onboarding", field, { usage });
  const repair = runPhaseMetric(run, "repair", field, { usage });
  return nonNegativeInteger(onboarding) && nonNegativeInteger(repair)
    ? onboarding + repair
    : null;
}

function phaseTokenTotal(run, phase) {
  const input = runPhaseMetric(run, phase, "input_tokens", { usage: true });
  const output = runPhaseMetric(run, phase, "output_tokens", { usage: true });
  return nonNegativeInteger(input) && nonNegativeInteger(output)
    ? input + output
    : null;
}

function totalTokens(run) {
  const onboarding = phaseTokenTotal(run, "onboarding");
  const repair = phaseTokenTotal(run, "repair");
  return nonNegativeInteger(onboarding) && nonNegativeInteger(repair)
    ? onboarding + repair
    : null;
}

function expectedCaptureItems(run) {
  return sumRunMetrics(run, "capture_items");
}

function expectedCaptureItemIds(run) {
  const ids = [];
  for (const phase of ["onboarding", "repair"]) {
    const artifact = run?.raw_evidence?.[phase];
    if (
      artifact?.status !== "loaded" ||
      !Array.isArray(artifact.value?.capture)
    ) {
      return null;
    }
    for (const [index] of artifact.value.capture.entries()) {
      ids.push(`capture-${phase}-${String(index + 1).padStart(3, "0")}`);
    }
  }
  return ids;
}

function requiredEvidencePhases(run) {
  if (run?.status === "completed") return ["onboarding", "repair"];
  if (run?.failure?.phase === "onboarding") return ["onboarding"];
  if (run?.failure?.phase === "repair") return ["onboarding", "repair"];
  if (run?.failure?.phase === "verification") return ["onboarding", "repair"];
  return [];
}

function evidenceAudit(
  runs,
  expectedRuns,
  { strict = false, expectedBindingsForRun = null } = {},
) {
  const phases = runs.flatMap((run) =>
    requiredEvidencePhases(run).map(
      (phase) =>
        evidencePhase(run, phase, {
          strict,
          expectedBindings:
            typeof expectedBindingsForRun === "function"
              ? expectedBindingsForRun(run, phase)
              : null,
        }).binding,
    ),
  );
  const expectedPhaseArtifacts = expectedRuns * 2;
  const requiredPhaseArtifacts = runs.reduce(
    (total, run) => total + requiredEvidencePhases(run).length,
    0,
  );
  const verificationBindings = runs
    .filter((run) => run?.status === "completed" || run?.verification)
    .map((run) => verificationEvidence(run, { strict }));
  return {
    expected_phase_artifacts: expectedPhaseArtifacts,
    required_phase_artifacts: requiredPhaseArtifacts,
    verified_phase_artifacts: phases.filter(
      (binding) => binding.status === "verified",
    ).length,
    missing_phase_artifacts:
      phases.filter((binding) => binding.status === "missing").length +
      Math.max(0, requiredPhaseArtifacts - phases.length),
    invalid_phase_artifacts: phases.filter(
      (binding) => !["verified", "missing"].includes(binding.status),
    ).length,
    metrics_cache_mismatches: phases.filter(
      (binding) => binding.metrics_cache_status === "mismatch",
    ).length,
    required_verification_artifacts: verificationBindings.length,
    verified_verification_artifacts: verificationBindings.filter(
      (binding) => binding.status === "verified",
    ).length,
    invalid_verification_artifacts: verificationBindings.filter(
      (binding) => binding.status !== "verified",
    ).length,
  };
}

export function campaignGateStatus({
  campaign,
  schedule,
  state,
  runs,
  verdicts,
  strictEvidence = false,
  expectedBindingsForRun = null,
}) {
  const expectedRunKeys = new Set(
    schedule.units.map(
      (unit) => `${unit.task_id}:${unit.attempt}:${unit.blind_label}`,
    ),
  );
  const actualRunKeys = new Set();
  let invalidRunArtifacts = 0;
  for (const run of runs) {
    const key = `${run.task_id}:${run.attempt}:${run.blind_label}`;
    if (!expectedRunKeys.has(key) || actualRunKeys.has(key)) {
      invalidRunArtifacts += 1;
    }
    actualRunKeys.add(key);
  }
  const expectedReviewKeys = new Set(
    schedule.units.map((unit) => `${unit.task_id}:${unit.attempt}`),
  );
  const actualReviewKeys = new Set();
  let invalidVerdictArtifacts = 0;
  for (const verdict of verdicts) {
    const key = `${verdict.task_id}:${verdict.attempt}`;
    if (!expectedReviewKeys.has(key) || actualReviewKeys.has(key)) {
      invalidVerdictArtifacts += 1;
    }
    actualReviewKeys.add(key);
  }
  const terminalUnits = schedule.units.filter((unit) =>
    isTerminalUnitState(state.units?.[unit.id]),
  ).length;
  const completedReviews = [...expectedReviewKeys].filter((key) => {
    const separator = key.lastIndexOf(":");
    const taskId = key.slice(0, separator);
    const attempt = key.slice(separator + 1);
    return state.reviews?.[`${taskId}-${attempt}`]?.status === "completed";
  }).length;
  const smokePassed =
    campaign.smoke?.status === "passed" && state.smoke?.status === "passed";
  const exactRuns =
    invalidRunArtifacts === 0 &&
    actualRunKeys.size === expectedRunKeys.size &&
    [...expectedRunKeys].every((key) => actualRunKeys.has(key));
  const exactVerdicts =
    invalidVerdictArtifacts === 0 &&
    actualReviewKeys.size === expectedReviewKeys.size &&
    [...expectedReviewKeys].every((key) => actualReviewKeys.has(key));
  const evidence = evidenceAudit(runs, expectedRunKeys.size, {
    strict: strictEvidence,
    expectedBindingsForRun,
  });
  const rawEvidencePassed =
    !strictEvidence ||
    (evidence.verified_phase_artifacts === evidence.required_phase_artifacts &&
      evidence.missing_phase_artifacts === 0 &&
      evidence.invalid_phase_artifacts === 0 &&
      evidence.metrics_cache_mismatches === 0 &&
      evidence.verified_verification_artifacts ===
        evidence.required_verification_artifacts &&
      evidence.invalid_verification_artifacts === 0);
  const reviewSealPassed =
    state.review_seal?.status === "sealed" &&
    state.review_seal?.expected === expectedReviewKeys.size;
  const diagnostic = campaign.diagnostic === true;
  const complete =
    !diagnostic &&
    smokePassed &&
    terminalUnits === expectedRunKeys.size &&
    exactRuns &&
    rawEvidencePassed &&
    completedReviews === expectedReviewKeys.size &&
    exactVerdicts &&
    reviewSealPassed;
  const reasons = [];
  if (diagnostic) reasons.push("diagnostic campaign");
  if (!smokePassed) reasons.push("model smoke gate is not passed");
  if (terminalUnits !== expectedRunKeys.size)
    reasons.push(
      `terminal run states ${terminalUnits}/${expectedRunKeys.size}`,
    );
  if (!exactRuns)
    reasons.push(`run artifacts ${actualRunKeys.size}/${expectedRunKeys.size}`);
  if (!rawEvidencePassed)
    reasons.push("raw phase evidence is incomplete or invalid");
  if (completedReviews !== expectedReviewKeys.size)
    reasons.push(
      `completed review states ${completedReviews}/${expectedReviewKeys.size}`,
    );
  if (!exactVerdicts)
    reasons.push(
      `verdict artifacts ${actualReviewKeys.size}/${expectedReviewKeys.size}`,
    );
  if (!reviewSealPassed) reasons.push("blind verdict seal is not complete");
  return {
    completion_status: complete ? "complete" : "incomplete",
    complete,
    reasons,
    gates: {
      smoke: {
        status: smokePassed ? "passed" : (campaign.smoke?.status ?? "missing"),
      },
      runs: {
        status:
          exactRuns &&
          terminalUnits === expectedRunKeys.size &&
          rawEvidencePassed
            ? "passed"
            : "incomplete",
        expected: expectedRunKeys.size,
        terminal_states: terminalUnits,
        artifacts: actualRunKeys.size,
        invalid_artifacts: invalidRunArtifacts,
        raw_evidence: evidence,
      },
      reviews: {
        status:
          exactVerdicts &&
          completedReviews === expectedReviewKeys.size &&
          reviewSealPassed
            ? "passed"
            : "incomplete",
        expected: expectedReviewKeys.size,
        completed_states: completedReviews,
        verdict_artifacts: actualReviewKeys.size,
        invalid_artifacts: invalidVerdictArtifacts,
        seal: state.review_seal?.status ?? "missing",
      },
    },
  };
}

function lowValueCaptureCount(run, reviews) {
  const expected = expectedCaptureItems(run);
  if (!nonNegativeInteger(expected)) return null;
  const expectedIds = expectedCaptureItemIds(run);
  if (!Array.isArray(expectedIds) || expectedIds.length !== expected)
    return null;
  const review = reviews.find(
    (item) => item.task_id === run.task_id && item.attempt === run.attempt,
  );
  if (!review) return null;
  const neutralArm = ["A", "B"].find(
    (arm) => review.arms?.[arm] === run.blind_label,
  );
  const labels = neutralArm
    ? review.scores?.[neutralArm]?.capture_item_labels
    : null;
  if (!Array.isArray(labels) || labels.length !== expected) return null;
  const ids = new Set();
  let lowValue = 0;
  for (const label of labels) {
    if (
      !isRecord(label) ||
      typeof label.id !== "string" ||
      label.id.length === 0 ||
      ids.has(label.id) ||
      !["low-value", "not-low-value", "unresolved"].includes(label.verdict)
    ) {
      return null;
    }
    ids.add(label.id);
    if (label.verdict === "unresolved") return null;
    if (label.verdict === "low-value") lowValue += 1;
  }
  if (
    stableJson(
      [...ids].sort((left, right) => left.localeCompare(right, "en")),
    ) !==
    stableJson(
      [...expectedIds].sort((left, right) => left.localeCompare(right, "en")),
    )
  ) {
    return null;
  }
  return lowValue;
}

export function aggregateCampaign({
  tasks,
  runs,
  reviews,
  mapping,
  diagnostic = false,
  evidenceComplete = true,
}) {
  const taskIds = tasks.map((task) =>
    typeof task === "string" ? task : task.id,
  );
  const expectedRunKeys = new Set();
  const expectedReviewKeys = new Set();
  for (const taskId of taskIds) {
    for (const attempt of ATTEMPTS) {
      expectedReviewKeys.add(`${taskId}:${attempt}`);
      for (const version of VERSIONS)
        expectedRunKeys.add(`${taskId}:${attempt}:${version}`);
    }
  }
  const seenRuns = new Set();
  for (const run of runs) {
    const version = mapping[run.blind_label];
    const key = `${run.task_id}:${run.attempt}:${version}`;
    if (!expectedRunKeys.has(key))
      fail("runs", `contains unexpected tuple ${key}`);
    if (seenRuns.has(key)) fail("runs", `duplicates tuple ${key}`);
    seenRuns.add(key);
  }
  const seenReviews = new Set();
  for (const review of reviews) {
    const key = `${review.task_id}:${review.attempt}`;
    if (!expectedReviewKeys.has(key))
      fail("reviews", `contains unexpected pair ${key}`);
    if (seenReviews.has(key)) fail("reviews", `duplicates pair ${key}`);
    seenReviews.add(key);
    const labels = [review.arms?.A, review.arms?.B];
    if (
      labels.some((label) => !mapping[label]) ||
      new Set(labels.map((label) => mapping[label])).size !== 2
    ) {
      fail("reviews", `${key} does not bind one opaque arm per version`);
    }
    const expectedLabels = runs
      .filter(
        (run) =>
          run.task_id === review.task_id && run.attempt === review.attempt,
      )
      .map((run) => run.blind_label)
      .sort((left, right) => left.localeCompare(right, "en"));
    const actualLabels = [...labels].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    if (
      expectedLabels.length !== 2 ||
      stableJson(actualLabels) !== stableJson(expectedLabels)
    ) {
      fail("reviews", `${key} arms do not match its exact run pair`);
    }
  }
  const versions = Object.fromEntries(
    VERSIONS.map((version) => [
      version,
      {
        task_passes: 0,
        correct_runs: 0,
        severe_regressions: 0,
        review_wins: 0,
        review_losses: 0,
        review_ties: 0,
        tasks: {},
        efficiency: {
          onboarding_tokens: { status: "not-measured", value: null },
          onboarding_input_tokens: {
            status: "not-measured",
            value: null,
          },
          onboarding_output_tokens: {
            status: "not-measured",
            value: null,
          },
          total_tokens: { status: "not-measured", value: null },
          total_input_tokens: { status: "not-measured", value: null },
          total_output_tokens: { status: "not-measured", value: null },
          duration_ms: { status: "not-measured", value: null },
          selected_context_bytes: { status: "not-measured", value: null },
          knowledge_bytes: { status: "not-measured", value: null },
          capture_items: { status: "not-measured", value: null },
          low_value_captures: { status: "not-measured", value: null },
        },
      },
    ]),
  );
  for (const taskId of taskIds) {
    for (const version of VERSIONS) {
      const matching = runs.filter(
        (run) => run.task_id === taskId && mapping[run.blind_label] === version,
      );
      const correct = matching.filter(hardCorrect).length;
      const regressions = matching.filter(
        (run) => run.verification?.regression_safety === "fail",
      ).length;
      versions[version].correct_runs += correct;
      versions[version].severe_regressions += regressions;
      versions[version].tasks[taskId] = {
        correct,
        attempts: ATTEMPTS.length,
        passed: correct >= 2,
        severe_regressions: regressions,
        attempts_detail: ATTEMPTS.map((attempt) => {
          const run = matching.find((item) => item.attempt === attempt);
          return {
            attempt,
            status: run?.status ?? "missing",
            hard_correct: run ? hardCorrect(run) : false,
            hidden_tests: run?.verification?.hidden_tests ?? "not-measured",
            full_suite: run?.verification?.full_suite ?? "not-measured",
            regression_safety:
              run?.verification?.regression_safety ?? "not-measured",
            evidence: run
              ? Object.fromEntries(
                  ["onboarding", "repair"].map((phase) => [
                    phase,
                    evidencePhase(run, phase).binding,
                  ]),
                )
              : null,
          };
        }),
      };
      if (correct >= 2) versions[version].task_passes += 1;
    }
  }
  const expectedRunsPerVersion = taskIds.length * ATTEMPTS.length;
  for (const version of VERSIONS) {
    const matching = runs.filter((run) => mapping[run.blind_label] === version);
    const onboardingTokens = matching.map((run) =>
      phaseTokenTotal(run, "onboarding"),
    );
    const onboardingInput = matching.map((run) =>
      runPhaseMetric(run, "onboarding", "input_tokens", { usage: true }),
    );
    const onboardingOutput = matching.map((run) =>
      runPhaseMetric(run, "onboarding", "output_tokens", { usage: true }),
    );
    const allTokens = matching.map(totalTokens);
    const totalInput = matching.map((run) =>
      sumRunMetrics(run, "input_tokens", { usage: true }),
    );
    const totalOutput = matching.map((run) =>
      sumRunMetrics(run, "output_tokens", { usage: true }),
    );
    const duration = matching.map((run) => sumRunMetrics(run, "duration_ms"));
    const selected = matching.map((run) =>
      sumRunMetrics(run, "selected_context_bytes"),
    );
    const knowledge = matching.map((run) =>
      sumRunMetrics(run, "knowledge_bytes"),
    );
    const captureItems = matching.map(expectedCaptureItems);
    const lowValueCaptures = matching.map((run) =>
      lowValueCaptureCount(run, reviews),
    );
    versions[version].evidence = evidenceAudit(
      matching,
      expectedRunsPerVersion,
    );
    versions[version].efficiency = {
      onboarding_tokens: measuredSum(
        onboardingTokens,
        expectedRunsPerVersion,
        "tokens",
      ),
      onboarding_input_tokens: measuredSum(
        onboardingInput,
        expectedRunsPerVersion,
        "tokens",
      ),
      onboarding_output_tokens: measuredSum(
        onboardingOutput,
        expectedRunsPerVersion,
        "tokens",
      ),
      total_tokens: measuredSum(allTokens, expectedRunsPerVersion, "tokens"),
      total_input_tokens: measuredSum(
        totalInput,
        expectedRunsPerVersion,
        "tokens",
      ),
      total_output_tokens: measuredSum(
        totalOutput,
        expectedRunsPerVersion,
        "tokens",
      ),
      duration_ms: measuredSum(duration, expectedRunsPerVersion, "ms"),
      selected_context_bytes: measuredSum(
        selected,
        expectedRunsPerVersion,
        "bytes",
      ),
      knowledge_bytes: measuredSum(knowledge, expectedRunsPerVersion, "bytes"),
      capture_items: measuredSum(captureItems, expectedRunsPerVersion, "items"),
      low_value_captures: measuredSum(
        lowValueCaptures,
        expectedRunsPerVersion,
        "items",
      ),
    };
  }
  for (const review of reviews) {
    if (!["A", "B", "tie"].includes(review.winner)) continue;
    if (review.winner === "tie") {
      for (const version of VERSIONS) versions[version].review_ties += 1;
      continue;
    }
    const label = review.arms?.[review.winner];
    const winner = mapping[label];
    if (!winner) continue;
    const winningRun = runs.find(
      (run) =>
        run.task_id === review.task_id &&
        run.attempt === review.attempt &&
        run.blind_label === label,
    );
    if (!hardCorrect(winningRun)) continue;
    const loser = winner === "v1" ? "v2" : "v1";
    versions[winner].review_wins += 1;
    versions[loser].review_losses += 1;
  }
  const ordered = [...VERSIONS].sort((left, right) => {
    const a = versions[left];
    const b = versions[right];
    return (
      b.task_passes - a.task_passes ||
      b.correct_runs - a.correct_runs ||
      a.severe_regressions - b.severe_regressions
    );
  });
  let winner = "no-clear-winner";
  let basis = "evidence is tied or incomplete";
  const expectedRuns = expectedRunKeys.size;
  const expectedReviews = expectedReviewKeys.size;
  const exactCoverage =
    seenRuns.size === expectedRuns && seenReviews.size === expectedReviews;
  const complete = !diagnostic && exactCoverage && evidenceComplete;
  const first = versions[ordered[0]];
  const second = versions[ordered[1]];
  if (diagnostic) {
    basis = "diagnostic campaigns cannot declare a formal winner";
  } else if (!complete) {
    basis = evidenceComplete
      ? `campaign evidence is incomplete (${runs.length}/${expectedRuns} runs, ${reviews.length}/${expectedReviews} reviews)`
      : "campaign raw phase evidence is incomplete or invalid";
  } else if (first.task_passes !== second.task_passes) {
    winner = ordered[0];
    basis = "more tasks passed by majority of attempts";
  } else if (first.correct_runs !== second.correct_runs) {
    winner = ordered[0];
    basis = "more hard-correct runs";
  } else if (first.severe_regressions !== second.severe_regressions) {
    winner = ordered[0];
    basis = "fewer severe regressions";
  } else {
    const candidate = ordered.find(
      (version) =>
        versions[version].review_wins >= 6 &&
        !taskIds.some((taskId) => {
          const taskReviews = reviews.filter(
            (review) => review.task_id === taskId,
          );
          const losses = taskReviews.filter((review) => {
            if (review.winner === "tie") return false;
            const winningLabel = review.arms?.[review.winner];
            const winningRun = runs.find(
              (run) =>
                run.task_id === review.task_id &&
                run.attempt === review.attempt &&
                run.blind_label === winningLabel,
            );
            if (!hardCorrect(winningRun)) return false;
            return mapping[winningLabel] !== version;
          }).length;
          return losses >= 2;
        }),
    );
    if (candidate) {
      winner = candidate;
      basis =
        "blind review won at least 6 of 9 without a task-level majority loss";
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    release_gate_effect: "none",
    complete,
    winner,
    basis,
    versions,
    blind_reviews: [...reviews]
      .sort(
        (left, right) =>
          taskIds.indexOf(left.task_id) - taskIds.indexOf(right.task_id) ||
          left.attempt - right.attempt,
      )
      .map((review) => {
        const winningLabel =
          review.winner === "tie" ? null : review.arms?.[review.winner];
        const winningRun = winningLabel
          ? runs.find(
              (run) =>
                run.task_id === review.task_id &&
                run.attempt === review.attempt &&
                run.blind_label === winningLabel,
            )
          : null;
        return {
          task_id: review.task_id,
          attempt: review.attempt,
          winner: review.winner,
          winner_version:
            review.winner === "tie"
              ? "tie"
              : hardCorrect(winningRun)
                ? (mapping[winningLabel] ?? "not-measured")
                : "not-measured",
          verdict_path: review.verdict_path ?? null,
          verdict_sha256: review.verdict_sha256 ?? null,
        };
      }),
  };
}

export async function verifyChecksums(
  campaignRoot,
  checksumFile = "SHA256SUMS",
) {
  const path = resolve(campaignRoot, checksumFile);
  if (!(await exists(path))) fail(checksumFile, "is missing");
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  const declared = new Set();
  for (const [index, line] of lines.entries()) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) fail(`${checksumFile}:${index + 1}`, "has invalid format");
    const [, expected, relativePath] = match;
    assertSafeRelativePath(relativePath, `${checksumFile}:${index + 1}`);
    if (declared.has(relativePath)) {
      fail(`${checksumFile}:${index + 1}`, "duplicates an artifact path");
    }
    declared.add(relativePath);
    const artifact = inside(campaignRoot, resolve(campaignRoot, relativePath));
    if (!(await exists(artifact))) fail(relativePath, "is missing");
    if ((await fileSha256(artifact)) !== expected)
      fail(relativePath, "hash mismatch");
  }
  const current = await hashTree(campaignRoot, {
    exclude: CAMPAIGN_CHECKSUM_EXCLUDE,
  });
  const actual = current.entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right, "en"));
  const wanted = [...declared].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (stableJson(actual) !== stableJson(wanted))
    fail(checksumFile, "does not cover the exact campaign artifact set");
  const checksumText = await readFile(path, "utf8");
  const checksumSha256 = sha256(checksumText);
  const checkpointsPath = resolve(campaignRoot, CHECKPOINTS_FILE);
  if (!(await exists(checkpointsPath))) {
    fail(CHECKPOINTS_FILE, "is missing for an existing checksum manifest");
  }
  const checkpoints = await readCheckpointChain(campaignRoot);
  const last = checkpoints.at(-1);
  if (!last || last.checksum_sha256 !== checksumSha256) {
    fail(CHECKPOINTS_FILE, "does not bind the current SHA256SUMS");
  }
  return lines.length;
}

async function readCheckpointChain(campaignRoot) {
  const path = resolve(campaignRoot, CHECKPOINTS_FILE);
  if (!(await exists(path))) return [];
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  const checkpoints = [];
  let previous = null;
  for (const [index, line] of lines.entries()) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      fail(`${CHECKPOINTS_FILE}:${index + 1}`, "is not valid JSON");
    }
    if (
      !isRecord(item) ||
      !Number.isInteger(item.sequence) ||
      item.sequence !== index + 1 ||
      (item.previous_checksum_sha256 !== null &&
        !SHA256_PATTERN.test(item.previous_checksum_sha256)) ||
      !SHA256_PATTERN.test(item.checksum_sha256) ||
      !SHA256_PATTERN.test(item.artifact_set_sha256)
    ) {
      fail(`${CHECKPOINTS_FILE}:${index + 1}`, "has an invalid checkpoint");
    }
    if (item.previous_checksum_sha256 !== previous) {
      fail(
        `${CHECKPOINTS_FILE}:${index + 1}`,
        "breaks the previous checksum chain",
      );
    }
    previous = item.checksum_sha256;
    checkpoints.push(item);
  }
  return checkpoints;
}

export async function writeChecksums(
  campaignRoot,
  excluded = [],
  { allowInitial = true, allowMutation = false } = {},
) {
  const checksumPath = resolve(campaignRoot, "SHA256SUMS");
  const hasManifest = await exists(checksumPath);
  let previousChecksumSha256 = null;
  let previousSequence = 0;
  if (hasManifest) {
    const previousText = await readFile(checksumPath, "utf8");
    previousChecksumSha256 = sha256(previousText);
    const checkpoints = await readCheckpointChain(campaignRoot);
    const last = checkpoints.at(-1);
    if (!last || last.checksum_sha256 !== previousChecksumSha256) {
      fail(CHECKPOINTS_FILE, "does not bind the current SHA256SUMS");
    }
    previousSequence = last.sequence;
    if (!allowMutation) await verifyChecksums(campaignRoot);
  } else if (!allowInitial) {
    fail("SHA256SUMS", "initial manifest requires allowInitial");
  }
  const tree = await hashTree(campaignRoot, {
    exclude: [
      ...CAMPAIGN_CHECKSUM_EXCLUDE,
      ...excluded.map(
        (path) =>
          new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      ),
    ],
  });
  const files = tree.entries.filter((entry) => entry.type === "file");
  const content = files
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join("\n");
  const checksumText = `${content}\n`;
  await writeFile(checksumPath, checksumText, "utf8");
  const checkpoint = {
    schema_version: SCHEMA_VERSION,
    sequence: previousSequence + 1,
    previous_checksum_sha256: previousChecksumSha256,
    checksum_sha256: sha256(checksumText),
    artifact_set_sha256: sha256(
      stableJson(
        files.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
      ),
    ),
    created_at: new Date().toISOString(),
  };
  await writeFile(
    resolve(campaignRoot, CHECKPOINTS_FILE),
    `${hasManifest ? await readFile(resolve(campaignRoot, CHECKPOINTS_FILE), "utf8") : ""}${JSON.stringify(stableValue(checkpoint))}\n`,
    "utf8",
  );
  return files.length;
}

export async function assertNoVersionLeak(path, forbiddenValues = []) {
  const content = await readFile(path, "utf8");
  const patterns = [
    /(?:^|[^a-z0-9])v1(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])v2(?:[^a-z0-9]|$)/i,
    /legacy[\\/]v1/i,
    /subjects?[\\/]/i,
    /skills[\\/]self-evolution/i,
    /subject_sha256/i,
    /skill_tree_sha256/i,
    /bundle_sha256/i,
    /archive_ref/i,
    /archive_sha256/i,
    /skill_sha256/i,
    /source_commit_sha/i,
    /(?<![a-z0-9])(?:[a-z]:[\\/]|\\\\)[^\s"'<>|]*/i,
    /(?<![a-z0-9.:/])\/(?!\/)[^\s"'<>|]+/i,
  ];
  const hit = patterns.find((pattern) => pattern.test(content));
  if (hit)
    fail(basename(path), `contains a blinded-review leak matching ${hit}`);
  const visit = (value) => {
    if (typeof value === "string") {
      const forms = new Set([
        value,
        value.replaceAll("\\", "/"),
        value.replaceAll("/", "\\"),
      ]);
      if ([...forms].filter(Boolean).some((form) => content.includes(form))) {
        fail(
          basename(path),
          `contains a blinded-review forbidden value ${sha256(value).slice(0, 12)}`,
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(forbiddenValues);
}

export async function copyClean(source, target) {
  if (await exists(target)) await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, preserveTimestamps: true });
  return realpath(target);
}

export async function fileMetadata(path) {
  const metadata = await stat(path);
  return { size: metadata.size, sha256: await fileSha256(path) };
}
