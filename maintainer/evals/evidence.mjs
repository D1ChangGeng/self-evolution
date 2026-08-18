import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { stableJson } from "./contract.mjs";

export const integratedGateFixtures = new Map([
  ["initialization-protocol-tokens", ["brownfield-onboarding"]],
  ["metadata-writes", ["no-capture", "uncovered-scope"]],
  ["low-value-capture", ["no-capture", "uncovered-scope"]],
  ["irrelevant-context", ["context-recovery", "uncovered-scope"]],
  [
    "retrieval-and-task-quality",
    [
      "cross-module-defect",
      "decision-constrained-feature",
      "migration-runbook",
      "tests-pass-behavior-wrong",
      "docs-reality-conflict",
      "source-changing-refactor",
      "context-recovery",
      "uncovered-scope",
      "wrong-knowledge",
      "brownfield-onboarding",
      "optional-adapters",
      "no-capture",
    ],
  ],
  ["no-capture-write-free", ["no-capture"]],
  ["wrong-knowledge-detection", ["wrong-knowledge"]],
  ["high-risk-material-verification", ["migration-runbook"]],
  ["migration-semantic-preservation", ["migration-semantic-corpus"]],
]);

export const integratedGateIds = new Set(integratedGateFixtures.keys());
const comparisonGateIds = new Set([
  "initialization-protocol-tokens",
  "metadata-writes",
  "low-value-capture",
  "irrelevant-context",
  "retrieval-and-task-quality",
]);

function fail(message) {
  throw new Error(`Integrated evidence: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, expected, name) {
  if (!isRecord(value)) fail(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    fail(`${name} fields must be exactly ${wanted.join(", ")}`);
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    fail(`${name} must be a non-empty string`);
}

function sha(value, name) {
  if (!/^[0-9a-f]{64}$/.test(value))
    fail(`${name} must be a lowercase SHA-256`);
}

function safeRelativePath(value, name) {
  nonEmptyString(value, name);
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => part === "" || part === "..")
  )
    fail(`${name} must be a safe POSIX-style relative path`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileHash(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function validateArtifact(
  evalRoot,
  artifact,
  name,
  globalArtifactPaths,
  owner,
  { allowSameBytes = false } = {},
) {
  exactFields(artifact, ["path", "sha256"], name);
  safeRelativePath(artifact.path, `${name}.path`);
  sha(artifact.sha256, `${name}.sha256`);
  const path = resolve(evalRoot, artifact.path);
  if (relative(evalRoot, path).startsWith("..") || !(await exists(path)))
    fail(`${name}.path does not exist inside maintainer/evals`);
  if ((await fileHash(path)) !== artifact.sha256)
    fail(`${name}.sha256 does not match ${artifact.path}`);
  if (globalArtifactPaths) {
    const previous = globalArtifactPaths.get(artifact.path);
    if (previous && previous.owner !== owner) {
      if (!allowSameBytes || previous.sha256 !== artifact.sha256)
        fail(`${name}.path is reused by a different campaign artifact owner`);
    } else
      globalArtifactPaths.set(artifact.path, {
        owner,
        sha256: artifact.sha256,
      });
  }
  return path;
}

function validateRunProtocol(protocol, name) {
  exactFields(
    protocol,
    [
      "campaign_id",
      "model",
      "prompt_sha256",
      "tool_budget",
      "repository_sha256",
      "stopping_rule_sha256",
      "toolchain_sha256",
      "blind_label",
      "subject_sha256",
    ],
    name,
  );
  for (const field of ["campaign_id", "model", "blind_label"])
    nonEmptyString(protocol[field], `${name}.${field}`);
  for (const field of [
    "prompt_sha256",
    "repository_sha256",
    "stopping_rule_sha256",
    "toolchain_sha256",
    "subject_sha256",
  ])
    sha(protocol[field], `${name}.${field}`);
  if (!Number.isInteger(protocol.tool_budget) || protocol.tool_budget < 1)
    fail(`${name}.tool_budget must be a positive integer`);
}

const protocolArtifactFields = [
  ["prompt", "prompt_sha256"],
  ["repository-input", "repository_sha256"],
  ["stopping-rule", "stopping_rule_sha256"],
  ["toolchain", "toolchain_sha256"],
];

const measurementUnits = {
  duration_ms: "ms",
  input_tokens: "tokens",
  output_tokens: "tokens",
  metadata_writes: "writes",
  irrelevant_context_bytes: "bytes",
  low_value_captures: "items",
};

function validateMeasurements(measurements, name) {
  exactFields(measurements, Object.keys(measurementUnits), name);
  for (const [field, measurement] of Object.entries(measurements)) {
    exactFields(measurement, ["status", "unit", "value"], `${name}.${field}`);
    if (
      !["measured", "not-measured", "not-applicable"].includes(
        measurement.status,
      )
    )
      fail(`${name}.${field}.status is invalid`);
    if (measurement.unit !== measurementUnits[field])
      fail(`${name}.${field}.unit must be ${measurementUnits[field]}`);
    if (
      measurement.status === "measured" &&
      (!Number.isInteger(measurement.value) || measurement.value < 0)
    )
      fail(
        `${name}.${field}.value must be a non-negative integer when measured`,
      );
    if (measurement.status !== "measured" && measurement.value !== null)
      fail(`${name}.${field}.value must be null unless measured`);
  }
}

function derivedMeasurement(field, status, value = null) {
  return { status, unit: measurementUnits[field], value };
}

async function readJsonEvidenceRef(
  ref,
  expectedKind,
  evidenceRefs,
  evalRoot,
  name,
) {
  if (ref === null) return null;
  nonEmptyString(ref, name);
  const evidence = evidenceRefs.get(ref);
  if (!evidence || evidence.kind !== expectedKind)
    fail(`${name} must identify a ${expectedKind} artifact`);
  try {
    return JSON.parse(await readFile(resolve(evalRoot, evidence.path), "utf8"));
  } catch {
    return null;
  }
}

function metadataWritePath(path) {
  return (
    path === ".agents/settings.yaml" ||
    path === ".agents/knowledge/index.yaml" ||
    path === ".agents/knowledge/manifest.json"
  );
}

async function deriveLabeledItemMetric(
  manifestRef,
  manifestKind,
  itemKind,
  labelsRef,
  labelField,
  positiveVerdict,
  negativeVerdict,
  unit,
  evidenceRefs,
  evalRoot,
  name,
) {
  const manifest = await readJsonEvidenceRef(
    manifestRef,
    manifestKind,
    evidenceRefs,
    evalRoot,
    `${name}.${manifestKind}`,
  );
  const labels = await readJsonEvidenceRef(
    labelsRef,
    "measurement-labels",
    evidenceRefs,
    evalRoot,
    `${name}.measurement-labels`,
  );
  if (!manifest || !labels || !Array.isArray(manifest.items)) return null;
  const judgments = labels[labelField];
  if (!Array.isArray(judgments)) return null;
  const items = new Map();
  for (const [index, item] of manifest.items.entries()) {
    exactFields(item, ["artifact_ref", "id"], `${name}.items[${index}]`);
    nonEmptyString(item.id, `${name}.items[${index}].id`);
    if (items.has(item.id)) fail(`${name}.items contains duplicate IDs`);
    const evidence = evidenceRefs.get(item.artifact_ref);
    if (!evidence || evidence.kind !== itemKind)
      fail(`${name}.items[${index}].artifact_ref must identify ${itemKind}`);
    items.set(item.id, { ...item, evidence });
  }
  if (judgments.length !== items.size) return null;
  const seen = new Set();
  let total = 0;
  for (const [index, judgment] of judgments.entries()) {
    exactFields(
      judgment,
      ["evidence_refs", "id", "rationale", "verdict"],
      `${name}.judgments[${index}]`,
    );
    const item = items.get(judgment.id);
    if (!item || seen.has(judgment.id)) return null;
    seen.add(judgment.id);
    if (
      ![positiveVerdict, negativeVerdict, "unresolved"].includes(
        judgment.verdict,
      )
    )
      fail(`${name}.judgments[${index}].verdict is invalid`);
    if (
      !Array.isArray(judgment.evidence_refs) ||
      !judgment.evidence_refs.includes(item.artifact_ref)
    )
      fail(`${name}.judgments[${index}] must cite its item artifact`);
    for (const ref of judgment.evidence_refs)
      if (!evidenceRefs.has(ref))
        fail(`${name}.judgments[${index}] cites an unknown artifact`);
    nonEmptyString(judgment.rationale, `${name}.judgments[${index}].rationale`);
    if (judgment.verdict === "unresolved") return null;
    if (judgment.verdict === positiveVerdict)
      total +=
        unit === "bytes"
          ? (await readFile(resolve(evalRoot, item.evidence.path))).byteLength
          : 1;
  }
  return total;
}

async function deriveMeasurements(sourceRefs, evidenceRefs, evalRoot, name) {
  exactFields(
    sourceRefs,
    [
      "capture_manifest",
      "execution_timing",
      "filesystem_trace",
      "labels",
      "model_responses",
      "selected_context_manifest",
    ],
    name,
  );
  if (!Array.isArray(sourceRefs.model_responses))
    fail(`${name}.model_responses must be an array`);

  const timing = await readJsonEvidenceRef(
    sourceRefs.execution_timing,
    "execution-timing",
    evidenceRefs,
    evalRoot,
    `${name}.execution_timing`,
  );
  const duration =
    timing &&
    Number.isInteger(timing.started_at_ms) &&
    Number.isInteger(timing.finished_at_ms) &&
    timing.finished_at_ms >= timing.started_at_ms
      ? timing.finished_at_ms - timing.started_at_ms
      : null;

  let inputTokens = 0;
  let outputTokens = 0;
  let usageMeasured = sourceRefs.model_responses.length > 0;
  for (const [index, ref] of sourceRefs.model_responses.entries()) {
    const response = await readJsonEvidenceRef(
      ref,
      "model-response",
      evidenceRefs,
      evalRoot,
      `${name}.model_responses[${index}]`,
    );
    if (
      !response ||
      !isRecord(response.usage) ||
      !Number.isInteger(response.usage.input_tokens) ||
      response.usage.input_tokens < 0 ||
      !Number.isInteger(response.usage.output_tokens) ||
      response.usage.output_tokens < 0
    ) {
      usageMeasured = false;
      break;
    }
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
  }

  const trace = await readJsonEvidenceRef(
    sourceRefs.filesystem_trace,
    "filesystem-trace",
    evidenceRefs,
    evalRoot,
    `${name}.filesystem_trace`,
  );
  const metadataWrites =
    trace && Array.isArray(trace.writes)
      ? trace.writes.filter(
          (item) => isRecord(item) && metadataWritePath(item.path),
        ).length
      : null;

  const irrelevantContextBytes = await deriveLabeledItemMetric(
    sourceRefs.selected_context_manifest,
    "selected-context-manifest",
    "selected-context",
    sourceRefs.labels,
    "selected_context",
    "irrelevant",
    "relevant",
    "bytes",
    evidenceRefs,
    evalRoot,
    `${name}.selected_context`,
  );
  const lowValueCaptures = await deriveLabeledItemMetric(
    sourceRefs.capture_manifest,
    "capture-manifest",
    "capture-item",
    sourceRefs.labels,
    "captures",
    "low-value",
    "not-low-value",
    "items",
    evidenceRefs,
    evalRoot,
    `${name}.captures`,
  );

  return {
    duration_ms:
      duration === null
        ? derivedMeasurement("duration_ms", "not-measured")
        : derivedMeasurement("duration_ms", "measured", duration),
    input_tokens: usageMeasured
      ? derivedMeasurement("input_tokens", "measured", inputTokens)
      : derivedMeasurement("input_tokens", "not-measured"),
    output_tokens: usageMeasured
      ? derivedMeasurement("output_tokens", "measured", outputTokens)
      : derivedMeasurement("output_tokens", "not-measured"),
    metadata_writes:
      metadataWrites === null
        ? derivedMeasurement("metadata_writes", "not-measured")
        : derivedMeasurement("metadata_writes", "measured", metadataWrites),
    irrelevant_context_bytes:
      irrelevantContextBytes === null
        ? derivedMeasurement("irrelevant_context_bytes", "not-measured")
        : derivedMeasurement(
            "irrelevant_context_bytes",
            "measured",
            irrelevantContextBytes,
          ),
    low_value_captures:
      lowValueCaptures === null
        ? derivedMeasurement("low_value_captures", "not-measured")
        : derivedMeasurement(
            "low_value_captures",
            "measured",
            lowValueCaptures,
          ),
  };
}

async function validateMeasurementArtifact(
  value,
  evidenceRefs,
  evalRoot,
  name,
) {
  exactFields(value, ["cache", "schema_version", "source_refs"], name);
  if (value.schema_version !== "2.0")
    fail(`${name}.schema_version must be 2.0`);
  validateMeasurements(value.cache, `${name}.cache`);
  const derived = await deriveMeasurements(
    value.source_refs,
    evidenceRefs,
    evalRoot,
    `${name}.source_refs`,
  );
  if (stableJson(derived) !== stableJson(value.cache))
    fail(`${name}.cache does not match evaluator-derived measurements`);
  return derived;
}

async function validateRunArtifact(
  value,
  expected,
  fixture,
  evalRoot,
  name,
  globalArtifactPaths,
  subjectBindings,
) {
  const owner = `run:${expected.version}:${expected.fixtureId}:${expected.attempt}`;
  exactFields(
    value,
    [
      "schema_version",
      "run_id",
      "suite_version",
      "version",
      "fixture_id",
      "fixture_contract_sha256",
      "attempt",
      "execution",
      "protocol",
      "evidence",
      "measurements",
    ],
    name,
  );
  if (value.schema_version !== "1.0")
    fail(`${name}.schema_version must be 1.0`);
  nonEmptyString(value.run_id, `${name}.run_id`);
  if (value.suite_version !== expected.suiteVersion)
    fail(`${name}.suite_version does not match the evidence manifest`);
  if (value.version !== expected.version)
    fail(`${name}.version does not match the run reference`);
  if (value.fixture_id !== expected.fixtureId)
    fail(`${name}.fixture_id does not match the run reference`);
  if (value.fixture_contract_sha256 !== fixture.contract_sha256)
    fail(`${name}.fixture_contract_sha256 does not match the fixture`);
  if (value.attempt !== expected.attempt)
    fail(`${name}.attempt does not match the run reference`);
  exactFields(
    value.execution,
    ["status", "exit_code", "stdout_sha256", "stderr_sha256"],
    `${name}.execution`,
  );
  if (!["completed", "failed", "unavailable"].includes(value.execution.status))
    fail(`${name}.execution.status must be completed, failed, or unavailable`);
  if (!Number.isInteger(value.execution.exit_code))
    fail(`${name}.execution.exit_code must be an integer`);
  if (
    (value.execution.status === "completed") !==
    (value.execution.exit_code === 0)
  )
    fail(
      `${name}.execution completed status must have exit_code 0 and non-completed status must have a non-zero exit_code`,
    );
  sha(value.execution.stdout_sha256, `${name}.execution.stdout_sha256`);
  sha(value.execution.stderr_sha256, `${name}.execution.stderr_sha256`);
  validateRunProtocol(value.protocol, `${name}.protocol`);
  if (value.protocol.subject_sha256 !== subjectBindings[value.version])
    fail(
      `${name}.protocol.subject_sha256 does not match the evaluated subject`,
    );
  validateMeasurements(value.measurements, `${name}.measurements`);
  exactFields(value.evidence, ["artifacts"], `${name}.evidence`);
  if (!isRecord(value.evidence.artifacts))
    fail(`${name}.evidence.artifacts must be an object`);
  const evidenceRefs = new Map();
  for (const [kind, artifacts] of Object.entries(value.evidence.artifacts)) {
    if (!Array.isArray(artifacts) || artifacts.length === 0)
      fail(`${name}.evidence.artifacts.${kind} must be a non-empty array`);
    for (const [index, artifact] of artifacts.entries()) {
      const artifactName = `${name}.evidence.artifacts.${kind}[${index}]`;
      await validateArtifact(
        evalRoot,
        artifact,
        artifactName,
        globalArtifactPaths,
        owner,
      );
      const ref = `${kind}:${index + 1}`;
      evidenceRefs.set(ref, { kind, path: artifact.path });
    }
  }
  for (const [stream, hashField] of [
    ["execution-stdout", "stdout_sha256"],
    ["execution-stderr", "stderr_sha256"],
  ]) {
    const artifacts = value.evidence.artifacts[stream];
    if (!Array.isArray(artifacts) || artifacts.length !== 1)
      fail(
        `${name}.evidence.artifacts.${stream} must contain exactly one artifact`,
      );
    if (artifacts[0].sha256 !== value.execution[hashField])
      fail(
        `${name}.execution.${hashField} does not match the ${stream} artifact`,
      );
  }
  for (const [kind, hashField] of protocolArtifactFields) {
    const artifacts = value.evidence.artifacts[kind];
    if (!Array.isArray(artifacts) || artifacts.length !== 1)
      fail(
        `${name}.evidence.artifacts.${kind} must contain exactly one artifact`,
      );
    if (artifacts[0].sha256 !== value.protocol[hashField])
      fail(`${name}.protocol.${hashField} does not match the ${kind} artifact`);
  }
  const measurementArtifacts = value.evidence.artifacts["measurements"];
  if (!Array.isArray(measurementArtifacts) || measurementArtifacts.length !== 1)
    fail(
      `${name}.evidence.artifacts.measurements must contain exactly one artifact`,
    );
  const measurementPath = resolve(evalRoot, measurementArtifacts[0].path);
  const measured = await validateMeasurementArtifact(
    JSON.parse(await readFile(measurementPath, "utf8")),
    evidenceRefs,
    evalRoot,
    `${name}.evidence.artifacts.measurements[0].content`,
  );
  if (stableJson(measured) !== stableJson(value.measurements))
    fail(`${name}.measurements do not match the bound measurement artifact`);
  Object.defineProperty(value, "_evidence_refs", {
    value: evidenceRefs,
    enumerable: false,
    configurable: false,
  });
  return value;
}

function validateVerdicts(items, fixtureItems, expectedKind, run, name) {
  if (!Array.isArray(items) || items.length !== fixtureItems.length)
    fail(
      `${name} must contain exactly one verdict per ${expectedKind} rubric item`,
    );
  const expectedIds = fixtureItems.map((item) => item.id).sort();
  const actualIds = items.map((item) => item.id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds))
    fail(`${name} IDs do not match the fixture rubric`);
  const fixtureById = new Map(fixtureItems.map((item) => [item.id, item]));
  for (const [index, item] of items.entries()) {
    exactFields(
      item,
      ["id", "verdict", "evidence_refs", "rationale"],
      `${name}[${index}]`,
    );
    if (
      !["satisfied", "not-satisfied", "triggered", "not-triggered"].includes(
        item.verdict,
      )
    )
      fail(`${name}[${index}].verdict is invalid`);
    if (
      expectedKind === "required" &&
      !["satisfied", "not-satisfied"].includes(item.verdict)
    )
      fail(`${name}[${index}].verdict must judge a required item`);
    if (
      expectedKind === "forbidden" &&
      !["triggered", "not-triggered"].includes(item.verdict)
    )
      fail(`${name}[${index}].verdict must judge a forbidden item`);
    if (!Array.isArray(item.evidence_refs) || item.evidence_refs.length === 0)
      fail(`${name}[${index}].evidence_refs must be non-empty`);
    for (const [refIndex, ref] of item.evidence_refs.entries()) {
      nonEmptyString(ref, `${name}[${index}].evidence_refs[${refIndex}]`);
      if (!run._evidence_refs.has(ref))
        fail(
          `${name}[${index}].evidence_refs[${refIndex}] does not identify a run artifact`,
        );
    }
    const allowedKinds = new Set(fixtureById.get(item.id).evidence);
    if (
      !item.evidence_refs.some((ref) =>
        allowedKinds.has(run._evidence_refs.get(ref)?.kind),
      )
    )
      fail(`${name}[${index}] lacks a fixture-approved evidence kind`);
    nonEmptyString(item.rationale, `${name}[${index}].rationale`);
  }
}

function validateReviewArtifact(value, expected, fixtureMap, runsById, name) {
  exactFields(
    value,
    [
      "schema_version",
      "gate_id",
      "suite_version",
      "reviewer",
      "reviewed_at",
      "blind",
      "run_reviews",
      "gate_checks",
      "rationale",
    ],
    name,
  );
  if (value.schema_version !== "1.0")
    fail(`${name}.schema_version must be 1.0`);
  if (value.gate_id !== expected.gateId)
    fail(`${name}.gate_id does not match the gate`);
  if (value.suite_version !== expected.suiteVersion)
    fail(`${name}.suite_version does not match the evidence manifest`);
  nonEmptyString(value.reviewer, `${name}.reviewer`);
  if (
    [...runsById.values()].some(
      (run) => run.protocol.campaign_id === value.reviewer,
    )
  )
    fail(`${name}.reviewer must be independent from the run campaign identity`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.reviewed_at))
    fail(`${name}.reviewed_at must be YYYY-MM-DD`);
  if (value.blind !== true) fail(`${name}.blind must be true`);
  for (const run of runsById.values()) {
    if (!/^arm-[a-z0-9]{8,}$/.test(run.protocol.blind_label))
      fail(`${name} run blind labels must be opaque arm identifiers`);
    if (
      run.protocol.blind_label.toLowerCase().includes(run.version) ||
      run.run_id.toLowerCase().includes(run.version)
    )
      fail(`${name} exposes the evaluated version to the reviewer`);
  }
  nonEmptyString(value.rationale, `${name}.rationale`);
  exactFields(
    value.gate_checks,
    ["expected_retrieval", "material_claims"],
    `${name}.gate_checks`,
  );
  if (
    !Array.isArray(value.run_reviews) ||
    value.run_reviews.length !== runsById.size
  )
    fail(`${name}.run_reviews must cover every run exactly once`);
  const reviewed = new Set();
  for (const [index, review] of value.run_reviews.entries()) {
    const itemName = `${name}.run_reviews[${index}]`;
    exactFields(
      review,
      ["run_id", "fixture_id", "required", "forbidden", "overall"],
      itemName,
    );
    const run = runsById.get(review.run_id);
    if (!run || reviewed.has(review.run_id))
      fail(`${itemName}.run_id must identify one unreviewed run`);
    reviewed.add(review.run_id);
    if (review.fixture_id !== run.fixture_id)
      fail(`${itemName}.fixture_id does not match the reviewed run`);
    const fixture = fixtureMap.get(review.fixture_id);
    if (!fixture) fail(`${itemName}.fixture_id is not required by the gate`);
    validateVerdicts(
      review.required,
      fixture.action_rubric.required,
      "required",
      run,
      `${itemName}.required`,
    );
    validateVerdicts(
      review.forbidden,
      fixture.action_rubric.forbidden,
      "forbidden",
      run,
      `${itemName}.forbidden`,
    );
    if (!["pass", "fail", "blocked"].includes(review.overall))
      fail(`${itemName}.overall must be pass, fail, or blocked`);
    const derived =
      review.required.every((item) => item.verdict === "satisfied") &&
      review.forbidden.every((item) => item.verdict === "not-triggered")
        ? "pass"
        : "fail";
    if (review.overall !== derived)
      fail(`${itemName}.overall does not match its rubric verdicts`);
  }
  const expectedRetrieval = new Set(
    [...fixtureMap.values()].flatMap((fixture) => fixture.expected_retrieval),
  );
  if (
    !Array.isArray(value.gate_checks.expected_retrieval) ||
    value.gate_checks.expected_retrieval.length !== expectedRetrieval.size
  )
    fail(
      `${name}.gate_checks.expected_retrieval must cover every expected route`,
    );
  const seenRetrieval = new Set();
  for (const [index, item] of value.gate_checks.expected_retrieval.entries()) {
    const itemName = `${name}.gate_checks.expected_retrieval[${index}]`;
    exactFields(item, ["path", "verdict", "run_ids", "rationale"], itemName);
    nonEmptyString(item.path, `${itemName}.path`);
    if (!expectedRetrieval.has(item.path) || seenRetrieval.has(item.path))
      fail(`${itemName}.path must identify one unreviewed expected route`);
    seenRetrieval.add(item.path);
    if (!["retrieved", "not-retrieved"].includes(item.verdict))
      fail(`${itemName}.verdict must be retrieved or not-retrieved`);
    if (!Array.isArray(item.run_ids) || item.run_ids.length === 0)
      fail(`${itemName}.run_ids must be non-empty`);
    for (const runId of item.run_ids) {
      const run = runsById.get(runId);
      if (!run || run.version !== "v2")
        fail(`${itemName}.run_ids must identify v2 runs in this gate`);
    }
    nonEmptyString(item.rationale, `${itemName}.rationale`);
  }
  const materialClaims = new Set(
    [...fixtureMap.values()].flatMap((fixture) => fixture.material_claims),
  );
  if (
    !Array.isArray(value.gate_checks.material_claims) ||
    value.gate_checks.material_claims.length !== materialClaims.size
  )
    fail(`${name}.gate_checks.material_claims must cover every material claim`);
  const seenClaims = new Set();
  for (const [index, item] of value.gate_checks.material_claims.entries()) {
    const itemName = `${name}.gate_checks.material_claims[${index}]`;
    exactFields(item, ["claim", "verdict", "run_ids", "rationale"], itemName);
    nonEmptyString(item.claim, `${itemName}.claim`);
    if (!materialClaims.has(item.claim) || seenClaims.has(item.claim))
      fail(`${itemName}.claim must identify one unreviewed material claim`);
    seenClaims.add(item.claim);
    if (!["verified", "refuted", "unresolved"].includes(item.verdict))
      fail(`${itemName}.verdict must be verified, refuted, or unresolved`);
    if (!Array.isArray(item.run_ids) || item.run_ids.length === 0)
      fail(`${itemName}.run_ids must be non-empty`);
    for (const runId of item.run_ids) {
      const run = runsById.get(runId);
      if (!run || run.version !== "v2")
        fail(`${itemName}.run_ids must identify v2 runs in this gate`);
    }
    nonEmptyString(item.rationale, `${itemName}.rationale`);
  }
  return value;
}

async function validateGate(
  evalRoot,
  fixturesById,
  id,
  gate,
  suiteVersion,
  campaignState,
  subjectBindings,
) {
  const requiredFixtureIds = integratedGateFixtures.get(id);
  if (!requiredFixtureIds) fail(`unknown gate ${id}`);
  exactFields(
    gate,
    ["status", "evidence", "fixtures", "runs", "review"],
    `gates.${id}`,
  );
  if (!["pass", "fail", "blocked"].includes(gate.status))
    fail(`gates.${id}.status must be pass, fail, or blocked`);
  nonEmptyString(gate.evidence, `gates.${id}.evidence`);
  if (JSON.stringify(gate.fixtures) !== JSON.stringify(requiredFixtureIds))
    fail(
      `gates.${id}.fixtures must exactly match ${requiredFixtureIds.join(", ")}`,
    );
  if (!Array.isArray(gate.runs)) fail(`gates.${id}.runs must be an array`);

  const combinations = new Set();
  const artifactPaths = new Set();
  const runIds = new Set();
  const runsById = new Map();
  const protocols = new Map();
  const armAssignments = new Map();
  for (const [index, run] of gate.runs.entries()) {
    const name = `gates.${id}.runs[${index}]`;
    exactFields(run, ["version", "fixture_id", "attempt", "artifact"], name);
    if (!["v1", "v2"].includes(run.version))
      fail(`${name}.version must be v1 or v2`);
    if (!requiredFixtureIds.includes(run.fixture_id))
      fail(`${name}.fixture_id is not required by the gate`);
    if (!Number.isInteger(run.attempt) || run.attempt < 1 || run.attempt > 3)
      fail(`${name}.attempt must be 1, 2, or 3`);
    const key = `${run.version}:${run.fixture_id}:${run.attempt}`;
    const tuple = key;
    if (combinations.has(key)) fail(`${name} duplicates ${key}`);
    combinations.add(key);
    if (artifactPaths.has(run.artifact?.path))
      fail(`${name}.artifact.path is reused`);
    artifactPaths.add(run.artifact?.path);
    const path = await validateArtifact(
      evalRoot,
      run.artifact,
      `${name}.artifact`,
      campaignState.artifactPaths,
      `run:${tuple}`,
      { allowSameBytes: true },
    );
    const fixture = fixturesById.get(run.fixture_id);
    const value = await validateRunArtifact(
      JSON.parse(await readFile(path, "utf8")),
      {
        suiteVersion,
        version: run.version,
        fixtureId: run.fixture_id,
        attempt: run.attempt,
      },
      fixture,
      evalRoot,
      `${name}.artifact.content`,
      campaignState.artifactPaths,
      subjectBindings,
    );
    const fingerprint = stableJson(value);
    if (
      campaignState.runFingerprints.has(tuple) &&
      campaignState.runFingerprints.get(tuple) !== fingerprint
    )
      fail(`${name} conflicts with another gate's frozen run for ${tuple}`);
    campaignState.runFingerprints.set(tuple, fingerprint);
    if (
      campaignState.runIds.has(value.run_id) &&
      campaignState.runIds.get(value.run_id) !== tuple
    )
      fail(`${name}.artifact.content.run_id is reused across the campaign`);
    campaignState.runIds.set(value.run_id, tuple);
    if (runIds.has(value.run_id))
      fail(`${name}.artifact.content.run_id is reused`);
    runIds.add(value.run_id);
    runsById.set(value.run_id, value);
    Object.defineProperty(run, "_validated", {
      value,
      enumerable: false,
      configurable: false,
    });
    const protocolKey = `${run.fixture_id}:${run.attempt}`;
    const parity = stableJson({
      ...value.protocol,
      blind_label: undefined,
      subject_sha256: undefined,
    });
    if (protocols.has(protocolKey) && protocols.get(protocolKey) !== parity)
      fail(`${name}.protocol does not match the paired version run`);
    protocols.set(protocolKey, parity);
    const armKey = `${run.fixture_id}:${run.attempt}:${value.protocol.blind_label}`;
    if (
      armAssignments.has(armKey) &&
      armAssignments.get(armKey) !== run.version
    )
      fail(`${name}.protocol reuses a blind label across paired versions`);
    armAssignments.set(armKey, run.version);
  }
  for (const fixture of requiredFixtureIds)
    for (const version of ["v1", "v2"])
      for (const attempt of [1, 2, 3])
        if (!combinations.has(`${version}:${fixture}:${attempt}`))
          fail(`gates.${id} lacks ${version} ${fixture} attempt ${attempt}`);

  exactFields(gate.review, ["artifact"], `gates.${id}.review`);
  const reviewPath = await validateArtifact(
    evalRoot,
    gate.review.artifact,
    `gates.${id}.review.artifact`,
    campaignState.artifactPaths,
    `review:${id}`,
  );
  const fixtureMap = new Map(
    requiredFixtureIds.map((fixtureId) => [
      fixtureId,
      fixturesById.get(fixtureId),
    ]),
  );
  const review = validateReviewArtifact(
    JSON.parse(await readFile(reviewPath, "utf8")),
    { gateId: id, suiteVersion },
    fixtureMap,
    runsById,
    `gates.${id}.review.artifact.content`,
  );
  const reviewedRuns = review.run_reviews.map((item) => ({
    ...item,
    run: runsById.get(item.run_id),
  }));
  const incompleteComparison = comparisonGateIds.has(id)
    ? reviewedRuns.some((item) => item.run.execution.status !== "completed")
    : false;
  const pairedRubricRegression = comparisonGateIds.has(id)
    ? requiredFixtureIds.some((fixtureId) =>
        [1, 2, 3].some((attempt) => {
          const v1 = reviewedRuns.find(
            (item) =>
              item.run.version === "v1" &&
              item.run.fixture_id === fixtureId &&
              item.run.attempt === attempt,
          );
          const v2 = reviewedRuns.find(
            (item) =>
              item.run.version === "v2" &&
              item.run.fixture_id === fixtureId &&
              item.run.attempt === attempt,
          );
          if (
            v1.run.execution.status !== "completed" ||
            v2.run.execution.status !== "completed"
          )
            return false;
          const v2Required = new Map(
            v2.required.map((item) => [item.id, item.verdict]),
          );
          const v2Forbidden = new Map(
            v2.forbidden.map((item) => [item.id, item.verdict]),
          );
          return (
            v1.required.some(
              (item) =>
                item.verdict === "satisfied" &&
                v2Required.get(item.id) !== "satisfied",
            ) ||
            v1.forbidden.some(
              (item) =>
                item.verdict === "not-triggered" &&
                v2Forbidden.get(item.id) !== "not-triggered",
            )
          );
        }),
      )
    : false;
  const v2Runs = reviewedRuns.filter((item) => item.run.version === "v2");
  const incompleteV2 = v2Runs.some(
    (item) => item.run.execution.status !== "completed",
  );
  const gateCheckFailure =
    review.gate_checks.expected_retrieval.some(
      (item) => item.verdict !== "retrieved",
    ) ||
    review.gate_checks.material_claims.some(
      (item) => item.verdict !== "verified",
    );
  const derivedStatus =
    incompleteV2 || incompleteComparison
      ? "blocked"
      : gateCheckFailure ||
          pairedRubricRegression ||
          (!comparisonGateIds.has(id) &&
            v2Runs.some((item) => item.overall === "fail"))
        ? "fail"
        : !comparisonGateIds.has(id) &&
            v2Runs.some((item) => item.overall === "blocked")
          ? "blocked"
          : "pass";
  if (gate.status !== derivedStatus)
    fail(`gates.${id}.status does not match the structured review`);
  Object.defineProperty(gate, "validated_runs", {
    value: gate.runs.map((run) => run._validated),
    enumerable: false,
    configurable: false,
  });
}

export async function loadIntegratedEvidence(
  path,
  evalRoot,
  fixtures,
  expectedBindings,
) {
  if (!(await exists(path))) return { gates: {}, sha256: null };
  const evidence = JSON.parse(await readFile(path, "utf8"));
  exactFields(
    evidence,
    [
      "schema_version",
      "suite_version",
      "baseline_sha256",
      "v2_skill_sha256",
      "v2_bundle_sha256",
      "fixture_contracts_sha256",
      "eval_contract_sha256",
      "v1_subject_sha256",
      "gates",
    ],
    "root",
  );
  if (evidence.schema_version !== "2.0") fail("schema_version must be 2.0");
  nonEmptyString(evidence.suite_version, "suite_version");
  for (const field of [
    "baseline_sha256",
    "v2_skill_sha256",
    "v2_bundle_sha256",
    "fixture_contracts_sha256",
    "eval_contract_sha256",
    "v1_subject_sha256",
  ])
    sha(evidence[field], field);
  if (expectedBindings)
    for (const [field, expected] of Object.entries(expectedBindings))
      if (evidence[field] !== expected)
        fail(`${field} does not match the current evaluation inputs`);
  if (!isRecord(evidence.gates)) fail("gates must be an object");
  const fixturesById = new Map(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );
  const campaignState = {
    artifactPaths: new Map(),
    runFingerprints: new Map(),
    runIds: new Map(),
  };
  const subjectBindings = {
    v1: evidence.v1_subject_sha256,
    v2: createHash("sha256")
      .update(
        stableJson({
          skill_sha256: evidence.v2_skill_sha256,
          bundle_sha256: evidence.v2_bundle_sha256,
        }),
      )
      .digest("hex"),
  };
  for (const [id, gate] of Object.entries(evidence.gates))
    await validateGate(
      evalRoot,
      fixturesById,
      id,
      gate,
      evidence.suite_version,
      campaignState,
      subjectBindings,
    );
  return {
    gates: evidence.gates,
    sha256: createHash("sha256").update(stableJson(evidence)).digest("hex"),
  };
}
