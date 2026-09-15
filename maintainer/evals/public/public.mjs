import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const HEX64 = /^[0-9a-f]{64}$/;
const BASELINE_COMMIT = "c998067f73620a4721367e33a31063882896d476";
const CHANGE_CLASSES = new Set(["docs", "routing", "core", "migration"]);
const CLEANED_TIERS = new Set(["small", "stratified", "full"]);
const V2_TIERS = new Set(["small", "medium"]);
const DOMAINS = new Set(["web", "enterprise"]);
const REQUIRED_HARNESSES = new Set(["codex", "claude-code", "opencode"]);
const INTERNAL_EVIDENCE_FIELDS = new Set(["_validatedRuns", "_engineering"]);
const DERIVED_RESULT_FIELDS = new Set([
  "metrics",
  "overall_accuracy",
  "ability_accuracy",
  "p95_latency_ms",
  "context_bytes",
  "question_count",
]);
const validatedRunsByEvidence = new WeakMap();
const engineeringByEvidence = new WeakMap();
const OFFICIAL_CATALOGS = Object.freeze({
  "longmemeval-cleaned": Object.freeze({
    sha256: "58470a788dc6379c746c0fb7f6fbb54bf0a198ff0d55a0c7811d8990ff96dc57",
    compressed_base64:
      "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",
  }),
  "longmemeval-v2": Object.freeze({
    sha256: "fb52506c36e7620880fef85699370cfa11543d8dc12d4104ecd091b65acc0b09",
    compressed_base64:
      "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",
  }),
});

export const PUBLIC_POLICY = Object.freeze({
  schema_version: "2.0",
  baseline_commit: BASELINE_COMMIT,
  primary_benchmark: Object.freeze({
    id: "longmemeval-cleaned",
    repository: "xiaowu0162/LongMemEval",
    dataset: "xiaowu0162/longmemeval-cleaned",
    full_question_count: 500,
    data_revision: "98d7416c24c778c2fee6e6f3006e7a073259d48f",
    manifest_source:
      "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned",
  }),
  secondary_benchmark: Object.freeze({
    id: "longmemeval-v2",
    repository: "xiaowu0162/LongMemEval-V2",
    commit: "2cc8c540bdb87fe6761629b585e727e1c4704520",
    medium_question_count: 451,
    data_revision: "f152293e235517d504809563c833d7190b8c713b",
    manifest_source:
      "https://huggingface.co/datasets/xiaowu0162/longmemeval-v2",
  }),
  benchmark_requirements: Object.freeze({
    docs: Object.freeze([
      { id: "longmemeval-cleaned", tier: "small", min_runs: 1 },
    ]),
    routing: Object.freeze([
      { id: "longmemeval-cleaned", tier: "stratified", min_runs: 1 },
    ]),
    migration: Object.freeze([
      { id: "longmemeval-cleaned", tier: "stratified", min_runs: 1 },
    ]),
    core: Object.freeze([
      Object.freeze({ id: "longmemeval-cleaned", tier: "full", min_runs: 3 }),
      Object.freeze({
        id: "longmemeval-v2",
        tier: "small",
        min_runs: 3,
        domains: ["web", "enterprise"],
      }),
    ]),
  }),
  thresholds: Object.freeze({
    docs: Object.freeze({
      max_overall_accuracy_drop: 0.02,
      max_ability_drop: 0.03,
      max_p95_latency_ratio: 1.2,
    }),
    routing: Object.freeze({
      max_overall_accuracy_drop: 0.02,
      max_ability_drop: 0.03,
      max_p95_latency_ratio: 1.2,
      max_context_bytes_ratio: 1.15,
    }),
    core: Object.freeze({
      max_overall_accuracy_drop: 0.02,
      max_ability_drop: 0.07,
      max_p95_latency_ratio: 1.2,
      max_context_bytes_ratio: 1.15,
    }),
    migration: Object.freeze({
      max_overall_accuracy_drop: 0.02,
      max_ability_drop: 0.03,
      max_p95_latency_ratio: 1.2,
    }),
  }),
});

export const PUBLIC_RELEASE_PROFILES = Object.freeze({
  standard: Object.freeze({
    description:
      "Deterministic safety plus public benchmark and changed-path checks.",
    required_deterministic_gates: Object.freeze([
      "skill-lines",
      "initialized-file-count",
      "source-change-detection",
      "migration-input-accounting",
      "migration-rollback-identity",
      "cli-and-adapter-idempotency",
      "default-adapters-off",
      "removed-v1-default-mechanisms",
    ]),
    require_public_benchmark: true,
    require_engineering_sample_for: Object.freeze(["core"]),
    historical_integrated_required: false,
  }),
  "public-engineering": Object.freeze({
    description:
      "Bounded real public engineering evidence with official regression and permission receipts.",
    required_deterministic_gates: Object.freeze([
      "skill-lines",
      "initialized-file-count",
      "source-change-detection",
      "migration-input-accounting",
      "migration-rollback-identity",
      "cli-and-adapter-idempotency",
      "default-adapters-off",
      "removed-v1-default-mechanisms",
    ]),
    require_public_benchmark: false,
    require_engineering_sample_for: Object.freeze([]),
    historical_integrated_required: false,
  }),
  private: Object.freeze({
    description:
      "Strict historical v1/v2 integrated campaign; enhancement profile.",
    required_deterministic_gates: Object.freeze([
      "skill-lines",
      "initialized-file-count",
      "source-change-detection",
      "migration-input-accounting",
      "migration-rollback-identity",
      "cli-and-adapter-idempotency",
      "default-adapters-off",
      "removed-v1-default-mechanisms",
    ]),
    require_public_benchmark: false,
    require_engineering_sample_for: Object.freeze([]),
    historical_integrated_required: true,
  }),
});

export function benchmarkRequirements(changeClass) {
  if (!CHANGE_CLASSES.has(changeClass))
    throw new Error(`Unknown change class: ${changeClass}`);
  return PUBLIC_POLICY.benchmark_requirements[changeClass];
}

function officialCatalog(benchmarkId) {
  const encoded = OFFICIAL_CATALOGS[benchmarkId];
  if (!encoded) fail(`official catalog is not pinned for ${benchmarkId}`);
  const parsed = JSON.parse(
    inflateSync(Buffer.from(encoded.compressed_base64, "base64")).toString(
      "utf8",
    ),
  );
  const canonical = JSON.stringify(parsed);
  if (hash(Buffer.from(canonical)) !== encoded.sha256)
    fail(`pinned official catalog digest mismatch for ${benchmarkId}`);
  return parsed;
}

export function officialCatalogQuestionIds(benchmarkId) {
  return officialCatalog(benchmarkId).map((item) => item.id);
}

export function officialCatalogRows(benchmarkId) {
  return officialCatalog(benchmarkId).map((item) => ({ ...item }));
}

class EvidenceError extends Error {
  constructor(message, status = "blocked") {
    super(`Public benchmark evidence: ${message}`);
    this.status = status;
  }
}

function fail(message, status = "blocked") {
  throw new EvidenceError(message, status);
}
function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${name} must be an object`);
  return value;
}
function string(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    fail(`${name} must be a non-empty string`);
  return value;
}
function exact(value, expected, name, status = "blocked") {
  if (value !== expected) fail(`${name} must equal ${expected}`, status);
}
function digest(value, name) {
  string(value, name);
  if (!HEX64.test(value)) fail(`${name} must be a lowercase SHA-256 digest`);
  return value;
}

function rejectInternalEvidenceFields(evidence) {
  const supplied = [];
  for (const field of INTERNAL_EVIDENCE_FIELDS) {
    if (Object.hasOwn(evidence, field)) {
      delete evidence[field];
      supplied.push(field);
    }
  }
  if (supplied.length > 0)
    fail(
      `${supplied.join(", ")} are evaluator-owned and must not appear in evidence JSON`,
    );
}
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveArtifactRoot(evidence, evidencePath) {
  string(evidence.artifact_root, "artifact_root");
  return isAbsolute(evidence.artifact_root)
    ? resolve(evidence.artifact_root)
    : resolve(evidencePath, "..", evidence.artifact_root);
}

async function readArtifactRef(ref, root, name) {
  record(ref, name);
  string(ref.path, `${name}.path`);
  digest(ref.sha256, `${name}.sha256`);
  if (isAbsolute(ref.path))
    fail(`${name}.path must be relative to artifact_root`);
  const path = resolve(root, ref.path);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel))
    fail(`${name}.path escapes artifact_root`);
  if (!(await exists(path))) fail(`${name} is missing: ${ref.path}`);
  const bytes = await readFile(path);
  if (hash(bytes) !== ref.sha256) fail(`${name} hash mismatch: ${ref.path}`);
  let content;
  try {
    content = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
  return { ref, path, content };
}

function validateBenchmarkDeclarations(evidence) {
  const list = Array.isArray(evidence.benchmark)
    ? evidence.benchmark
    : [evidence.benchmark];
  if (list.length === 0) fail("benchmark must not be empty");
  const map = new Map();
  for (const [index, benchmark] of list.entries()) {
    record(benchmark, `benchmark[${index}]`);
    const id = string(benchmark.id, `benchmark[${index}].id`);
    if (map.has(id)) fail(`duplicate benchmark declaration ${id}`);
    if (id === PUBLIC_POLICY.primary_benchmark.id) {
      exact(
        benchmark.repository,
        PUBLIC_POLICY.primary_benchmark.repository,
        `benchmark[${index}].repository`,
      );
      exact(
        benchmark.dataset,
        PUBLIC_POLICY.primary_benchmark.dataset,
        `benchmark[${index}].dataset`,
      );
      exact(
        benchmark.data_revision,
        PUBLIC_POLICY.primary_benchmark.data_revision,
        `benchmark[${index}].data_revision`,
      );
    } else if (id === PUBLIC_POLICY.secondary_benchmark.id) {
      exact(
        benchmark.repository,
        PUBLIC_POLICY.secondary_benchmark.repository,
        `benchmark[${index}].repository`,
      );
      exact(
        benchmark.commit,
        PUBLIC_POLICY.secondary_benchmark.commit,
        `benchmark[${index}].commit`,
      );
      exact(
        benchmark.data_revision,
        PUBLIC_POLICY.secondary_benchmark.data_revision,
        `benchmark[${index}].data_revision`,
      );
    } else fail(`unsupported benchmark ${id}`);
    digest(benchmark.data_sha256, `benchmark[${index}].data_sha256`);
    map.set(id, benchmark);
  }
  return map;
}

function validateQuestionManifest(
  manifest,
  benchmarkId,
  tier,
  declaration,
  name,
) {
  record(manifest, name);
  exact(
    manifest.schema_version,
    "public-question-manifest/1",
    `${name}.schema_version`,
  );
  exact(manifest.benchmark_id, benchmarkId, `${name}.benchmark_id`);
  exact(manifest.tier, tier, `${name}.tier`);
  if (manifest.official !== true) fail(`${name}.official must be true`);
  string(manifest.source, `${name}.source`);
  exact(
    manifest.source,
    benchmarkId === PUBLIC_POLICY.primary_benchmark.id
      ? PUBLIC_POLICY.primary_benchmark.manifest_source
      : PUBLIC_POLICY.secondary_benchmark.manifest_source,
    `${name}.source`,
  );
  string(manifest.data_revision, `${name}.data_revision`);
  exact(
    manifest.data_revision,
    declaration.data_revision,
    `${name}.data_revision`,
  );
  exact(manifest.data_sha256, declaration.data_sha256, `${name}.data_sha256`);
  const catalog = officialCatalog(benchmarkId);
  const officialRows = new Map(catalog.map((row) => [row.id, row]));
  if (
    !Array.isArray(manifest.question_ids) ||
    manifest.question_ids.length === 0
  )
    fail(`${name}.question_ids must be non-empty`);
  const ids = manifest.question_ids;
  if (new Set(ids).size !== ids.length)
    fail(`${name}.question_ids contains duplicates`);
  ids.forEach((id, index) => string(id, `${name}.question_ids[${index}]`));
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(ids))
    fail(`${name}.question_ids must be sorted`);
  exact(manifest.question_count, ids.length, `${name}.question_count`);
  const catalogIds = catalog.map((row) => row.id);
  const requiresCompleteCatalog =
    tier === "full" ||
    tier === "medium" ||
    (benchmarkId === PUBLIC_POLICY.secondary_benchmark.id && tier === "small");
  if (requiresCompleteCatalog) {
    if (JSON.stringify(ids) !== JSON.stringify(catalogIds))
      fail(
        `${name}.question_ids must exactly match the pinned official catalog`,
      );
  } else if (ids.some((id) => !officialRows.has(id))) {
    fail(
      `${name}.question_ids contains IDs outside the pinned official catalog`,
    );
  }
  if (benchmarkId === PUBLIC_POLICY.primary_benchmark.id) {
    if (!CLEANED_TIERS.has(tier))
      fail(`${name}.tier is invalid for longmemeval-cleaned`);
    if (tier === "full")
      exact(
        ids.length,
        PUBLIC_POLICY.primary_benchmark.full_question_count,
        `${name}.question_count`,
      );
    if (tier === "small" && ids.length > 100)
      fail(`${name}.small sample is too large`);
    if (
      tier === "stratified" &&
      ids.length >= PUBLIC_POLICY.primary_benchmark.full_question_count
    )
      fail(`${name}.stratified sample must be smaller than full`);
  } else {
    if (!V2_TIERS.has(tier)) fail(`${name}.tier is invalid for longmemeval-v2`);
    if (tier === "small" || tier === "medium")
      exact(
        ids.length,
        PUBLIC_POLICY.secondary_benchmark.medium_question_count,
        `${name}.question_count`,
      );
    if (!manifest.domains || typeof manifest.domains !== "object")
      fail(`${name}.domains is required for longmemeval-v2`);
    const domains = new Set();
    for (const id of ids) {
      const domain = manifest.domains[id];
      if (!DOMAINS.has(domain))
        fail(`${name}.domains.${id} must be web or enterprise`);
      exact(domain, officialRows.get(id).domain, `${name}.domains.${id}`);
      domains.add(domain);
    }
    if ((tier === "small" || tier === "medium") && domains.size !== 2)
      fail(`${name}.${tier} must cover web and enterprise`);
  }
  return {
    ids: new Set(ids),
    domains: Object.fromEntries(
      ids.map((id) => [id, officialRows.get(id).domain]),
    ),
    abilities: Object.fromEntries(
      ids.map((id) => [id, officialRows.get(id)?.ability]),
    ),
  };
}

function validateProtocol(
  protocol,
  benchmarkId,
  tier,
  manifestSha,
  declaration,
  name,
) {
  record(protocol, name);
  exact(
    protocol.schema_version,
    "public-run-protocol/1",
    `${name}.schema_version`,
  );
  exact(protocol.benchmark_id, benchmarkId, `${name}.benchmark_id`);
  exact(protocol.tier, tier, `${name}.tier`);
  exact(
    protocol.question_manifest_sha256,
    manifestSha,
    `${name}.question_manifest_sha256`,
    "not-comparable",
  );
  record(protocol.model, `${name}.model`);
  string(protocol.model.name, `${name}.model.name`);
  string(protocol.model.revision, `${name}.model.revision`);
  record(protocol.data, `${name}.data`);
  string(protocol.data.revision, `${name}.data.revision`);
  exact(
    protocol.data.sha256,
    declaration.data_sha256,
    `${name}.data.sha256`,
    "not-comparable",
  );
  exact(
    protocol.data.revision,
    declaration.data_revision,
    `${name}.data.revision`,
    "not-comparable",
  );
  digest(protocol.prompt_sha256, `${name}.prompt_sha256`);
  record(protocol.budget, `${name}.budget`);
  if (Object.keys(protocol.budget).length === 0)
    fail(`${name}.budget must not be empty`);
  record(protocol.harness, `${name}.harness`);
  string(protocol.harness.name, `${name}.harness.name`);
  string(protocol.harness.revision, `${name}.harness.revision`);
  record(protocol.environment, `${name}.environment`);
  exact(protocol.environment.host, "1302-1", `${name}.environment.host`);
  string(protocol.environment.os, `${name}.environment.os`);
  string(protocol.environment.toolchain, `${name}.environment.toolchain`);
  if (protocol.subject !== undefined || protocol.arm !== undefined)
    fail(`${name} contains subject-specific fields`);
}

function deriveTraceMeasurements(
  trace,
  questionId,
  arm,
  results,
  predictionSha256,
  name,
) {
  record(trace, name);
  exact(trace.schema_version, "public-trace/1", `${name}.schema_version`);
  exact(trace.question_id, questionId, `${name}.question_id`);
  exact(trace.arm, arm, `${name}.arm`);
  exact(
    trace.subject_sha256,
    results.subject_sha256,
    `${name}.subject_sha256`,
    "not-comparable",
  );
  exact(
    trace.protocol_sha256,
    results.protocol_sha256,
    `${name}.protocol_sha256`,
    "not-comparable",
  );
  exact(
    trace.prediction_sha256,
    predictionSha256,
    `${name}.prediction_sha256`,
    "not-comparable",
  );
  string(trace.started_at, `${name}.started_at`);
  string(trace.ended_at, `${name}.ended_at`);
  const started = Date.parse(trace.started_at);
  const ended = Date.parse(trace.ended_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started)
    fail(`${name}.started_at and ended_at must be valid ordered timestamps`);
  if (!Array.isArray(trace.selected_context))
    fail(`${name}.selected_context must be an array`);
  let contextBytes = 0;
  for (const [index, item] of trace.selected_context.entries()) {
    record(item, `${name}.selected_context[${index}]`);
    string(item.id, `${name}.selected_context[${index}].id`);
    string(item.text, `${name}.selected_context[${index}].text`);
    contextBytes += Buffer.byteLength(item.text, "utf8");
  }
  return { latency_ms: ended - started, context_bytes: contextBytes };
}

function validateSubject(subject, arm, options, name) {
  record(subject, name);
  if (arm === "baseline") {
    exact(subject.commit, BASELINE_COMMIT, `${name}.commit`, "not-comparable");
    digest(subject.sha256, `${name}.sha256`);
    digest(options.baselineSubjectSha256, "options.baselineSubjectSha256");
    exact(
      subject.sha256,
      options.baselineSubjectSha256,
      `${name}.sha256`,
      "not-comparable",
    );
  } else {
    digest(subject.sha256, `${name}.sha256`);
    digest(options.subjectSha256, "options.subjectSha256");
    exact(
      subject.sha256,
      options.subjectSha256,
      `${name}.sha256`,
      "not-comparable",
    );
  }
}

async function deriveMetrics(results, manifest, benchmarkId, arm, root, name) {
  record(results, name);
  exact(
    results.schema_version,
    "public-run-results/1",
    `${name}.schema_version`,
  );
  exact(results.arm, arm, `${name}.arm`);
  exact(results.benchmark_id, benchmarkId, `${name}.benchmark_id`);
  exact(
    results.question_manifest_sha256,
    manifest.sha256,
    `${name}.question_manifest_sha256`,
    "not-comparable",
  );
  digest(results.protocol_sha256, `${name}.protocol_sha256`);
  digest(results.subject_sha256, `${name}.subject_sha256`);
  for (const field of DERIVED_RESULT_FIELDS) {
    if (results[field] !== undefined)
      fail(
        `${name}.${field} must be omitted; derived metrics come from raw artifacts`,
      );
  }
  record(results.evaluator, `${name}.evaluator`);
  string(results.evaluator.name, `${name}.evaluator.name`);
  string(results.evaluator.revision, `${name}.evaluator.revision`);
  digest(results.evaluator.config_sha256, `${name}.evaluator.config_sha256`);
  if (!Array.isArray(results.questions) || results.questions.length === 0)
    fail(`${name}.questions must be non-empty`);
  const expected = manifest.info.ids;
  const seen = new Set();
  const rows = [];
  for (const [index, row] of results.questions.entries()) {
    record(row, `${name}.questions[${index}]`);
    const id = string(
      row.question_id,
      `${name}.questions[${index}].question_id`,
    );
    if (!expected.has(id))
      fail(`${name}.questions contains unknown question ${id}`);
    if (seen.has(id))
      fail(`${name}.questions contains duplicate question ${id}`);
    seen.add(id);
    for (const field of [
      "correct",
      "ability",
      "domain",
      "latency_ms",
      "context_bytes",
    ])
      if (row[field] !== undefined)
        fail(
          `${name}.questions[${index}].${field} must be derived from raw artifacts or the pinned manifest`,
        );
    const prediction = await readArtifactRef(
      row.prediction,
      root,
      `${name}.questions[${index}].prediction`,
    );
    const judge = await readArtifactRef(
      row.judge,
      root,
      `${name}.questions[${index}].judge`,
    );
    const trace = await readArtifactRef(
      row.trace,
      root,
      `${name}.questions[${index}].trace`,
    );
    exact(
      prediction.content.schema_version,
      "public-prediction/1",
      `${name}.questions[${index}].prediction.content.schema_version`,
    );
    exact(
      prediction.content.question_id,
      id,
      `${name}.questions[${index}].prediction.content.question_id`,
    );
    string(
      prediction.content.answer,
      `${name}.questions[${index}].prediction.content.answer`,
    );
    exact(
      prediction.content.arm,
      arm,
      `${name}.questions[${index}].prediction.content.arm`,
    );
    exact(
      prediction.content.subject_sha256,
      results.subject_sha256,
      `${name}.questions[${index}].prediction.content.subject_sha256`,
      "not-comparable",
    );
    exact(
      prediction.content.protocol_sha256,
      results.protocol_sha256,
      `${name}.questions[${index}].prediction.content.protocol_sha256`,
      "not-comparable",
    );
    exact(
      judge.content.schema_version,
      "public-judge/1",
      `${name}.questions[${index}].judge.content.schema_version`,
    );
    exact(
      judge.content.question_id,
      id,
      `${name}.questions[${index}].judge.content.question_id`,
    );
    exact(
      judge.content.arm,
      arm,
      `${name}.questions[${index}].judge.content.arm`,
    );
    exact(
      judge.content.subject_sha256,
      results.subject_sha256,
      `${name}.questions[${index}].judge.content.subject_sha256`,
      "not-comparable",
    );
    exact(
      judge.content.protocol_sha256,
      results.protocol_sha256,
      `${name}.questions[${index}].judge.content.protocol_sha256`,
      "not-comparable",
    );
    exact(
      judge.content.prediction_sha256,
      row.prediction.sha256,
      `${name}.questions[${index}].judge.content.prediction_sha256`,
      "not-comparable",
    );
    exact(
      judge.content.evaluator?.name,
      results.evaluator.name,
      `${name}.questions[${index}].judge.content.evaluator.name`,
      "not-comparable",
    );
    exact(
      judge.content.evaluator?.revision,
      results.evaluator.revision,
      `${name}.questions[${index}].judge.content.evaluator.revision`,
      "not-comparable",
    );
    digest(
      judge.content.evaluator?.config_sha256,
      `${name}.questions[${index}].judge.content.evaluator.config_sha256`,
    );
    if (!["correct", "incorrect"].includes(judge.content.verdict))
      fail(
        `${name}.questions[${index}].judge.content.verdict must be correct or incorrect`,
      );
    exact(
      judge.content.evaluator.config_sha256,
      results.evaluator.config_sha256,
      `${name}.questions[${index}].judge.content.evaluator.config_sha256`,
      "not-comparable",
    );
    for (const [kind, artifact] of Object.entries({ prediction, judge, trace }))
      for (const field of ["correct", "latency_ms", ...DERIVED_RESULT_FIELDS])
        if (artifact.content[field] !== undefined)
          fail(
            `${name}.questions[${index}].${kind}.content.${field} must be omitted; metrics are evaluator-derived`,
          );
    const measurements = deriveTraceMeasurements(
      trace.content,
      id,
      arm,
      results,
      row.prediction.sha256,
      `${name}.questions[${index}].trace.content`,
    );
    rows.push({
      question_id: id,
      ability: manifest.info.abilities[id],
      domain: manifest.info.domains[id],
      correct: judge.content.verdict === "correct",
      ...measurements,
      prediction_sha256: row.prediction.sha256,
      judge_sha256: row.judge.sha256,
      trace_sha256: row.trace.sha256,
    });
  }
  if (seen.size !== expected.size || [...expected].some((id) => !seen.has(id)))
    fail(`${name}.questions must exactly match official manifest IDs`);
  return metricsFromRows(rows);
}

function metricsFromRows(rows) {
  const byAbility = {};
  for (const row of rows) {
    const bucket = byAbility[row.ability] ?? { correct: 0, total: 0 };
    bucket.correct += row.correct ? 1 : 0;
    bucket.total += 1;
    byAbility[row.ability] = bucket;
  }
  const abilityAccuracy = Object.fromEntries(
    Object.entries(byAbility).map(([ability, value]) => [
      ability,
      value.correct / value.total,
    ]),
  );
  const latency = rows.map((row) => row.latency_ms).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(latency.length * 0.95) - 1);
  return {
    rows,
    overall_accuracy: rows.filter((row) => row.correct).length / rows.length,
    ability_accuracy: abilityAccuracy,
    p95_latency_ms: latency[p95Index],
    context_bytes:
      rows.reduce((sum, row) => sum + row.context_bytes, 0) / rows.length,
    question_count: rows.length,
  };
}

export function aggregateMetrics(pairs, arm) {
  const rows = pairs.flatMap((item) =>
    arm === "baseline" ? item.baselineMetrics.rows : item.candidateMetrics.rows,
  );
  const grouped = new Map();
  for (const row of rows) {
    const values = grouped.get(row.question_id) ?? [];
    values.push(row);
    grouped.set(row.question_id, values);
  }
  if ([...grouped.values()].every((values) => values.length === 1))
    return metricsFromRows(rows);
  const collapsed = [...grouped.entries()].map(([questionId, values]) => {
    const first = values[0];
    if (
      values.some(
        (row) => row.ability !== first.ability || row.domain !== first.domain,
      )
    )
      fail(`aggregate metadata changes across runs for ${questionId}`);
    const latencies = values.map((row) => row.latency_ms).sort((a, b) => a - b);
    return {
      question_id: questionId,
      ability: first.ability,
      domain: first.domain,
      correct: values.filter((row) => row.correct).length > values.length / 2,
      latency_ms: latencies[Math.floor(latencies.length / 2)],
      context_bytes:
        values.reduce((sum, row) => sum + row.context_bytes, 0) / values.length,
      observation_count: values.length,
    };
  });
  return metricsFromRows(collapsed);
}

function comparePair(pair, baselineMetrics, candidateMetrics, threshold) {
  const failures = [];
  const overallDrop =
    candidateMetrics.overall_accuracy - baselineMetrics.overall_accuracy;
  if (overallDrop < -threshold.max_overall_accuracy_drop)
    failures.push(`overall accuracy drop ${(-overallDrop).toFixed(4)}`);
  const abilities = new Set([
    ...Object.keys(baselineMetrics.ability_accuracy),
    ...Object.keys(candidateMetrics.ability_accuracy),
  ]);
  let abilityDrop = Infinity;
  for (const ability of abilities) {
    const before = baselineMetrics.ability_accuracy[ability];
    const after = candidateMetrics.ability_accuracy[ability];
    if (before === undefined || after === undefined) {
      failures.push(`ability bucket missing: ${ability}`);
      continue;
    }
    abilityDrop = Math.min(abilityDrop, after - before);
  }
  if (abilityDrop < -threshold.max_ability_drop)
    failures.push(`ability drop ${(-abilityDrop).toFixed(4)}`);
  const p95Ratio =
    baselineMetrics.p95_latency_ms === 0
      ? candidateMetrics.p95_latency_ms === 0
        ? 1
        : Infinity
      : candidateMetrics.p95_latency_ms / baselineMetrics.p95_latency_ms;
  if (p95Ratio > threshold.max_p95_latency_ratio)
    failures.push(`p95 latency ratio ${p95Ratio.toFixed(4)}`);
  const contextRatio =
    baselineMetrics.context_bytes === 0
      ? candidateMetrics.context_bytes === 0
        ? 1
        : Infinity
      : candidateMetrics.context_bytes / baselineMetrics.context_bytes;
  if (
    threshold.max_context_bytes_ratio !== undefined &&
    contextRatio > threshold.max_context_bytes_ratio
  )
    failures.push(`context bytes ratio ${contextRatio.toFixed(4)}`);
  return {
    pair_id: pair.pair_id,
    overallDrop,
    abilityDrop,
    p95Ratio,
    contextRatio,
    failures,
    baseline: baselineMetrics,
    candidate: candidateMetrics,
  };
}

async function validatePair(pair, declarations, root, options) {
  record(pair, "runs[]");
  string(pair.pair_id, "runs[].pair_id");
  const benchmarkId = string(
    pair.benchmark_id,
    `runs.${pair.pair_id}.benchmark_id`,
  );
  const declaration = declarations.get(benchmarkId);
  if (!declaration)
    fail(`runs.${pair.pair_id} references undeclared benchmark`);
  const tier = string(pair.tier, `runs.${pair.pair_id}.tier`);
  const manifestArtifact = await readArtifactRef(
    pair.question_manifest,
    root,
    `runs.${pair.pair_id}.question_manifest`,
  );
  const manifestInfo = validateQuestionManifest(
    manifestArtifact.content,
    benchmarkId,
    tier,
    declaration,
    `runs.${pair.pair_id}.question_manifest.content`,
  );
  const manifest = {
    ...manifestArtifact,
    info: manifestInfo,
    sha256: pair.question_manifest.sha256,
  };
  const protocolArtifact = await readArtifactRef(
    pair.protocol,
    root,
    `runs.${pair.pair_id}.protocol`,
  );
  validateProtocol(
    protocolArtifact.content,
    benchmarkId,
    tier,
    pair.question_manifest.sha256,
    declaration,
    `runs.${pair.pair_id}.protocol.content`,
  );
  const baseline = record(pair.baseline, `runs.${pair.pair_id}.baseline`);
  const candidate = record(pair.candidate, `runs.${pair.pair_id}.candidate`);
  validateSubject(
    baseline.subject,
    "baseline",
    options,
    `runs.${pair.pair_id}.baseline.subject`,
  );
  validateSubject(
    candidate.subject,
    "candidate",
    options,
    `runs.${pair.pair_id}.candidate.subject`,
  );
  const baselineResults = await readArtifactRef(
    baseline.results,
    root,
    `runs.${pair.pair_id}.baseline.results`,
  );
  const candidateResults = await readArtifactRef(
    candidate.results,
    root,
    `runs.${pair.pair_id}.candidate.results`,
  );
  exact(
    baselineResults.content.arm,
    "baseline",
    `runs.${pair.pair_id}.baseline.results.content.arm`,
  );
  exact(
    candidateResults.content.arm,
    "candidate",
    `runs.${pair.pair_id}.candidate.results.content.arm`,
  );
  exact(
    baselineResults.content.protocol_sha256,
    pair.protocol.sha256,
    `runs.${pair.pair_id}.baseline.results.content.protocol_sha256`,
    "not-comparable",
  );
  exact(
    candidateResults.content.protocol_sha256,
    pair.protocol.sha256,
    `runs.${pair.pair_id}.candidate.results.content.protocol_sha256`,
    "not-comparable",
  );
  exact(
    baselineResults.content.subject_sha256,
    baseline.subject.sha256,
    `runs.${pair.pair_id}.baseline.results.content.subject_sha256`,
    "not-comparable",
  );
  exact(
    candidateResults.content.subject_sha256,
    candidate.subject.sha256,
    `runs.${pair.pair_id}.candidate.results.content.subject_sha256`,
    "not-comparable",
  );
  for (const field of ["name", "revision", "config_sha256"])
    exact(
      candidateResults.content.evaluator?.[field],
      baselineResults.content.evaluator?.[field],
      `runs.${pair.pair_id}.candidate.results.content.evaluator.${field}`,
      "not-comparable",
    );
  const baselineMetrics = await deriveMetrics(
    baselineResults.content,
    manifest,
    benchmarkId,
    "baseline",
    root,
    `runs.${pair.pair_id}.baseline.results.content`,
  );
  const candidateMetrics = await deriveMetrics(
    candidateResults.content,
    manifest,
    benchmarkId,
    "candidate",
    root,
    `runs.${pair.pair_id}.candidate.results.content`,
  );
  return {
    pair,
    benchmark_id: benchmarkId,
    tier,
    protocol_sha256: pair.protocol.sha256,
    manifest_sha256: pair.question_manifest.sha256,
    baselineMetrics,
    candidateMetrics,
  };
}

function validateExecutionReceipt(receipt, campaignId, options, name) {
  record(receipt, name);
  exact(
    receipt.schema_version,
    "public-engineering-execution/1",
    `${name}.schema_version`,
  );
  exact(receipt.status, "completed", `${name}.status`);
  exact(receipt.host, "1302-1", `${name}.host`);
  exact(receipt.exit_code, 0, `${name}.exit_code`);
  exact(
    receipt.campaign_id,
    campaignId,
    `${name}.campaign_id`,
    "not-comparable",
  );
  string(receipt.task_id, `${name}.task_id`);
  record(receipt.harness, `${name}.harness`);
  if (!REQUIRED_HARNESSES.has(receipt.harness.name))
    fail(`${name}.harness.name must name a supported harness`);
  string(receipt.harness.revision, `${name}.harness.revision`);
  string(receipt.executor_id, `${name}.executor_id`);
  string(receipt.command, `${name}.command`);
  if (!Array.isArray(receipt.events) || receipt.events.length === 0)
    fail(`${name}.events must be non-empty`);
  if (options.subjectSha256)
    exact(
      receipt.subject_sha256,
      options.subjectSha256,
      `${name}.subject_sha256`,
      "not-comparable",
    );
}

function validateReviewReceipt(receipt, campaignId, options, name) {
  record(receipt, name);
  exact(
    receipt.schema_version,
    "public-engineering-review/1",
    `${name}.schema_version`,
  );
  if (!["pass", "fail"].includes(receipt.verdict))
    fail(`${name}.verdict must be pass or fail`);
  exact(receipt.host, "1302-1", `${name}.host`);
  exact(
    receipt.campaign_id,
    campaignId,
    `${name}.campaign_id`,
    "not-comparable",
  );
  string(receipt.task_id, `${name}.task_id`);
  string(receipt.harness, `${name}.harness`);
  string(receipt.reviewer_id, `${name}.reviewer_id`);
  if (receipt.reviewer_id === campaignId)
    fail(`${name}.reviewer_id must differ from campaign_id`);
  string(receipt.rationale, `${name}.rationale`);
  if (
    !Array.isArray(receipt.evidence_refs) ||
    receipt.evidence_refs.length === 0
  )
    fail(`${name}.evidence_refs must be non-empty`);
  if (options.subjectSha256)
    exact(
      receipt.subject_sha256,
      options.subjectSha256,
      `${name}.subject_sha256`,
      "not-comparable",
    );
}

async function validateEngineering(engineering, root, campaignId, options) {
  record(engineering, "engineering");
  const engineeringCampaignId = string(
    engineering.campaign_id,
    "engineering.campaign_id",
  );
  if (
    !Array.isArray(engineering.harnesses) ||
    engineering.harnesses.length < REQUIRED_HARNESSES.size
  )
    fail("engineering.harnesses must cover three harnesses");
  const names = new Set();
  const failedReviews = [];
  const executionDigests = new Set();
  const reviewDigests = new Set();
  const taskIds = new Set();
  function bindReceipts(execution, review, harnessName, taskId, label) {
    exact(
      execution.content.harness.name,
      harnessName,
      `${label}.execution.content.harness.name`,
      "not-comparable",
    );
    exact(
      execution.content.task_id,
      taskId,
      `${label}.execution.content.task_id`,
      "not-comparable",
    );
    exact(
      review.content.harness,
      harnessName,
      `${label}.review.content.harness`,
      "not-comparable",
    );
    exact(
      review.content.task_id,
      taskId,
      `${label}.review.content.task_id`,
      "not-comparable",
    );
    if (review.content.reviewer_id === execution.content.executor_id)
      fail(`${label}.review must have a separate reviewer from its executor`);
    if (
      executionDigests.has(execution.ref.sha256) ||
      reviewDigests.has(review.ref.sha256)
    )
      fail(`${label} reuses an execution or review receipt`);
    if (taskIds.has(taskId)) fail(`${label} reuses task ${taskId}`);
    executionDigests.add(execution.ref.sha256);
    reviewDigests.add(review.ref.sha256);
    taskIds.add(taskId);
    if (review.content.verdict === "fail") failedReviews.push(label);
  }
  for (const [index, item] of engineering.harnesses.entries()) {
    record(item, `engineering.harnesses[${index}]`);
    const name = string(item.name, `engineering.harnesses[${index}].name`);
    if (!REQUIRED_HARNESSES.has(name)) fail(`unsupported harness ${name}`);
    if (names.has(name)) fail(`duplicate harness ${name}`);
    names.add(name);
    const execution = await readArtifactRef(
      item.execution,
      root,
      `engineering.harnesses[${index}].execution`,
    );
    const review = await readArtifactRef(
      item.review,
      root,
      `engineering.harnesses[${index}].review`,
    );
    validateExecutionReceipt(
      execution.content,
      engineeringCampaignId,
      options,
      `engineering.harnesses[${index}].execution.content`,
    );
    validateReviewReceipt(
      review.content,
      engineeringCampaignId,
      options,
      `engineering.harnesses[${index}].review.content`,
    );
    for (const [refIndex, evidenceRef] of (
      review.content.evidence_refs ?? []
    ).entries())
      await readArtifactRef(
        evidenceRef,
        root,
        `engineering.harnesses[${index}].review.content.evidence_refs[${refIndex}]`,
      );
    exact(
      review.content.execution_sha256,
      item.execution.sha256,
      `engineering.harnesses[${index}].review.content.execution_sha256`,
      "not-comparable",
    );
    bindReceipts(
      execution,
      review,
      name,
      execution.content.task_id,
      `engineering.harnesses[${index}]`,
    );
  }
  if (names.size !== REQUIRED_HARNESSES.size)
    fail("engineering.harnesses must include codex, claude-code, and opencode");
  if (!Array.isArray(engineering.samples) || engineering.samples.length < 3)
    fail(
      "engineering.samples must contain at least three execution/review pairs",
    );
  const sampleIds = new Set();
  for (const [index, item] of engineering.samples.entries()) {
    record(item, `engineering.samples[${index}]`);
    const id = string(item.id, `engineering.samples[${index}].id`);
    const harnessName = string(
      item.harness,
      `engineering.samples[${index}].harness`,
    );
    if (!REQUIRED_HARNESSES.has(harnessName))
      fail(`unsupported sample harness ${harnessName}`);
    if (sampleIds.has(id)) fail(`duplicate engineering sample ${id}`);
    sampleIds.add(id);
    const execution = await readArtifactRef(
      item.execution,
      root,
      `engineering.samples[${index}].execution`,
    );
    const review = await readArtifactRef(
      item.review,
      root,
      `engineering.samples[${index}].review`,
    );
    validateExecutionReceipt(
      execution.content,
      engineeringCampaignId,
      options,
      `engineering.samples[${index}].execution.content`,
    );
    validateReviewReceipt(
      review.content,
      engineeringCampaignId,
      options,
      `engineering.samples[${index}].review.content`,
    );
    for (const [refIndex, evidenceRef] of (
      review.content.evidence_refs ?? []
    ).entries())
      await readArtifactRef(
        evidenceRef,
        root,
        `engineering.samples[${index}].review.content.evidence_refs[${refIndex}]`,
      );
    exact(
      review.content.execution_sha256,
      item.execution.sha256,
      `engineering.samples[${index}].review.content.execution_sha256`,
      "not-comparable",
    );
    bindReceipts(
      execution,
      review,
      harnessName,
      id,
      `engineering.samples[${index}]`,
    );
  }
  return {
    status: failedReviews.length > 0 ? "fail" : "pass",
    reason:
      failedReviews.length > 0
        ? `measured review failures: ${failedReviews.join(", ")}`
        : "all engineering executions and reviews pass",
    harnesses: [...names],
    sample_count: sampleIds.size,
    failed_reviews: failedReviews,
  };
}

export function validatePublicEvidence(evidence, options = {}) {
  record(evidence, "evidence");
  exact(
    evidence.schema_version,
    PUBLIC_POLICY.schema_version,
    "schema_version",
  );
  string(evidence.campaign_id, "campaign_id");
  string(evidence.change_class, "change_class");
  if (!CHANGE_CLASSES.has(evidence.change_class))
    fail(`change_class must be one of ${[...CHANGE_CLASSES].join(", ")}`);
  if (options.changeClass)
    exact(evidence.change_class, options.changeClass, "change_class");
  exact(evidence.host, "1302-1", "host");
  string(evidence.artifact_root, "artifact_root");
  const declarations = validateBenchmarkDeclarations(evidence);
  if (!Array.isArray(evidence.runs) || evidence.runs.length === 0)
    fail("runs must be a non-empty array");
  const ids = new Set();
  for (const pair of evidence.runs) {
    string(pair.pair_id, "runs[].pair_id");
    if (ids.has(pair.pair_id)) fail(`duplicate pair_id ${pair.pair_id}`);
    ids.add(pair.pair_id);
  }
  return { declarations };
}

export function evaluatePublicEvidence(evidence) {
  const validatedRuns = evidence && validatedRunsByEvidence.get(evidence);
  if (!Array.isArray(validatedRuns))
    return {
      status: "blocked",
      reason: "public evidence has not been loaded and validated",
    };
  const requirements = benchmarkRequirements(evidence.change_class);
  const threshold = PUBLIC_POLICY.thresholds[evidence.change_class];
  const evaluations = [];
  const blocked = [];
  const failures = [];
  for (const requirement of requirements) {
    const pairs = validatedRuns.filter(
      (item) =>
        item.benchmark_id === requirement.id && item.tier === requirement.tier,
    );
    if (pairs.length < requirement.min_runs) {
      blocked.push(
        `${requirement.id}/${requirement.tier} requires ${requirement.min_runs} complete paired run`,
      );
      continue;
    }
    if (requirement.domains) {
      const domains = new Set(
        pairs.flatMap((item) =>
          item.candidateMetrics.rows.map((row) => row.domain),
        ),
      );
      if (requirement.domains.some((domain) => !domains.has(domain))) {
        blocked.push(
          `${requirement.id}/${requirement.tier} requires domains ${requirement.domains.join(", ")}`,
        );
        continue;
      }
    }
    const runDiagnostics = pairs.map((item) => ({
      pair_id: item.pair.pair_id,
      baseline: item.baselineMetrics,
      candidate: item.candidateMetrics,
    }));
    const aggregate = comparePair(
      { pair_id: `aggregate:${requirement.id}/${requirement.tier}` },
      aggregateMetrics(pairs, "baseline"),
      aggregateMetrics(pairs, "candidate"),
      threshold,
    );
    aggregate.run_ids = pairs.map((item) => item.pair.pair_id);
    evaluations.push({
      benchmark_id: requirement.id,
      tier: requirement.tier,
      run_diagnostics: runDiagnostics,
      results: [aggregate],
    });
    failures.push(...aggregate.failures);
  }
  const status =
    blocked.length > 0 ? "blocked" : failures.length > 0 ? "fail" : "pass";
  return {
    status,
    reason:
      blocked.length > 0
        ? blocked.join("; ")
        : failures.length > 0
          ? failures.join("; ")
          : "all public benchmark requirements pass",
    requirements,
    evaluations,
  };
}

export function evaluateEngineeringSample(evidence) {
  return (
    (evidence && engineeringByEvidence.get(evidence)) ?? {
      status: "blocked",
      reason: "engineering evidence is missing",
    }
  );
}

export async function loadPublicEvidence(path, options = {}) {
  if (!(await exists(path)))
    return {
      evidence: null,
      evaluation: { status: "blocked", reason: "evidence file is missing" },
      sample: { status: "blocked", reason: "evidence file is missing" },
    };
  let evidence;
  try {
    evidence = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return {
      evidence: null,
      evaluation: {
        status: "blocked",
        reason: `invalid JSON: ${error.message}`,
      },
      sample: { status: "blocked", reason: "invalid JSON" },
    };
  }
  try {
    rejectInternalEvidenceFields(evidence);
    const { declarations } = validatePublicEvidence(evidence, options);
    const root = resolveArtifactRoot(evidence, path);
    const validatedRuns = [];
    const protocolByTuple = new Map();
    for (const pair of evidence.runs) {
      const item = await validatePair(pair, declarations, root, options);
      const tuple = `${item.benchmark_id}/${item.tier}`;
      const prior = protocolByTuple.get(tuple);
      if (prior && prior !== item.protocol_sha256)
        fail(`${tuple} changes protocol between paired runs`, "not-comparable");
      protocolByTuple.set(tuple, item.protocol_sha256);
      validatedRuns.push(item);
    }
    validatedRunsByEvidence.set(evidence, validatedRuns);
    let engineering = {
      status: "blocked",
      reason: "engineering evidence is missing",
    };
    if (evidence.engineering) {
      try {
        engineering = await validateEngineering(
          evidence.engineering,
          root,
          evidence.campaign_id,
          options,
        );
      } catch (error) {
        engineering = {
          status: error?.status ?? "blocked",
          reason: error.message,
        };
      }
    }
    engineeringByEvidence.set(evidence, engineering);
    return {
      evidence,
      evaluation: evaluatePublicEvidence(evidence),
      sample: engineering,
    };
  } catch (error) {
    const status = error?.status ?? "blocked";
    return {
      evidence,
      evaluation: { status, reason: error.message },
      sample: { status, reason: error.message },
    };
  }
}
