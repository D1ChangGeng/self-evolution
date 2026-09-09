import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  benchmarkRequirements,
  evaluatePublicEvidence,
  officialCatalogQuestionIds,
  loadPublicEvidence,
  PUBLIC_POLICY,
  validatePublicEvidence,
} from "./public.mjs";

function shellEvidence(overrides = {}) {
  return {
    schema_version: "2.0",
    campaign_id: "public-test-20260909",
    change_class: "core",
    host: "1302-1",
    artifact_root: ".",
    benchmark: [
      {
        id: "longmemeval-cleaned",
        repository: "xiaowu0162/LongMemEval",
        dataset: "xiaowu0162/longmemeval-cleaned",
        data_revision: PUBLIC_POLICY.primary_benchmark.data_revision,
        data_sha256: "a".repeat(64),
      },
      {
        id: "longmemeval-v2",
        repository: "xiaowu0162/LongMemEval-V2",
        commit: PUBLIC_POLICY.secondary_benchmark.commit,
        data_revision: PUBLIC_POLICY.secondary_benchmark.data_revision,
        data_sha256: "b".repeat(64),
      },
    ],
    runs: [{ pair_id: "pair-1" }],
    ...overrides,
  };
}

const TEST_BASELINE_SUBJECT = "b".repeat(64);
const TEST_CANDIDATE_SUBJECT = "c".repeat(64);

function testHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeArtifact(root, relativePath, value) {
  const path = resolve(root, relativePath);
  await mkdir(resolve(path, ".."), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value));
  await writeFile(path, bytes);
  return { path: relativePath, sha256: testHash(bytes) };
}

async function validSmallEvidence(root, overrides = {}) {
  const questionId = "001be529";
  const dataSha = "a".repeat(64);
  const manifest = {
    schema_version: "public-question-manifest/1",
    benchmark_id: "longmemeval-cleaned",
    tier: "small",
    official: true,
    source: PUBLIC_POLICY.primary_benchmark.manifest_source,
    data_revision: PUBLIC_POLICY.primary_benchmark.data_revision,
    data_sha256: dataSha,
    question_ids: [questionId],
    question_count: 1,
  };
  const manifestRef = await writeArtifact(root, "manifest.json", manifest);
  const protocol = {
    schema_version: "public-run-protocol/1",
    benchmark_id: "longmemeval-cleaned",
    tier: "small",
    question_manifest_sha256: manifestRef.sha256,
    model: { name: "test-model", revision: "test-1" },
    data: { revision: manifest.data_revision, sha256: dataSha },
    prompt_sha256: "d".repeat(64),
    budget: { context_tokens: 1000 },
    harness: { name: "test", revision: "test-1" },
    environment: { host: "1302-1", os: "test", toolchain: "test" },
  };
  const protocolRef = await writeArtifact(root, "protocol.json", protocol);
  const makeRun = async (arm, subjectSha, verdict = "correct") => {
    const prediction = {
      schema_version: "public-prediction/1",
      question_id: questionId,
      arm,
      subject_sha256: subjectSha,
      protocol_sha256: protocolRef.sha256,
      answer: "answer",
    };
    const predictionRef = await writeArtifact(
      root,
      `${arm}-prediction.json`,
      prediction,
    );
    const judge = {
      schema_version: "public-judge/1",
      question_id: questionId,
      arm,
      subject_sha256: subjectSha,
      protocol_sha256: protocolRef.sha256,
      prediction_sha256: predictionRef.sha256,
      evaluator: {
        name: "test-judge",
        revision: "test-1",
        config_sha256: "e".repeat(64),
      },
      verdict,
    };
    const judgeRef = await writeArtifact(root, `${arm}-judge.json`, judge);
    const trace = {
      schema_version: "public-trace/1",
      question_id: questionId,
      arm,
      subject_sha256: subjectSha,
      protocol_sha256: protocolRef.sha256,
      prediction_sha256: predictionRef.sha256,
      started_at: "2026-09-10T00:00:00.000Z",
      ended_at: "2026-09-10T00:00:00.100Z",
      selected_context: [{ id: "guide-1", text: "wiki context" }],
    };
    const traceRef = await writeArtifact(root, `${arm}-trace.json`, trace);
    return {
      question_id: questionId,
      prediction: predictionRef,
      judge: judgeRef,
      trace: traceRef,
    };
  };
  const baselineQuestion = await makeRun("baseline", TEST_BASELINE_SUBJECT);
  const candidateQuestion = await makeRun("candidate", TEST_CANDIDATE_SUBJECT);
  const makeResults = async (arm, subjectSha, question) => {
    const results = {
      schema_version: "public-run-results/1",
      arm,
      benchmark_id: "longmemeval-cleaned",
      question_manifest_sha256: manifestRef.sha256,
      protocol_sha256: protocolRef.sha256,
      subject_sha256: subjectSha,
      evaluator: {
        name: "test-judge",
        revision: "test-1",
        config_sha256: "e".repeat(64),
      },
      questions: [question],
    };
    return writeArtifact(root, `${arm}-results.json`, results);
  };
  const baselineResults = await makeResults(
    "baseline",
    TEST_BASELINE_SUBJECT,
    baselineQuestion,
  );
  const candidateResults = await makeResults(
    "candidate",
    TEST_CANDIDATE_SUBJECT,
    candidateQuestion,
  );
  return {
    schema_version: "2.0",
    campaign_id: "public-test-valid",
    change_class: "docs",
    host: "1302-1",
    artifact_root: root,
    benchmark: [
      {
        id: "longmemeval-cleaned",
        repository: "xiaowu0162/LongMemEval",
        dataset: "xiaowu0162/longmemeval-cleaned",
        data_revision: manifest.data_revision,
        data_sha256: dataSha,
      },
    ],
    runs: [
      {
        pair_id: "pair-1",
        benchmark_id: "longmemeval-cleaned",
        tier: "small",
        question_manifest: manifestRef,
        protocol: protocolRef,
        baseline: {
          subject: {
            commit: "c998067f73620a4721367e33a31063882896d476",
            sha256: TEST_BASELINE_SUBJECT,
          },
          results: {
            ...baselineResults,
          },
        },
        candidate: {
          subject: { sha256: TEST_CANDIDATE_SUBJECT },
          results: { ...candidateResults },
        },
      },
    ],
    ...overrides,
  };
}

async function addEngineeringEvidence(evidence, root, verdict = "pass") {
  const harnesses = [];
  const samples = [];
  const harnessNames = ["codex", "claude-code", "opencode"];
  let counter = 0;
  const makePair = async (harness, id) => {
    const taskId = `${id}-task`;
    const execution = await writeArtifact(root, `${id}-execution.json`, {
      schema_version: "public-engineering-execution/1",
      status: "completed",
      host: "1302-1",
      exit_code: 0,
      campaign_id: evidence.campaign_id,
      task_id: taskId,
      harness: { name: harness, revision: "test-harness-1" },
      executor_id: `${id}-executor`,
      subject_sha256: TEST_CANDIDATE_SUBJECT,
      command: `run ${id}`,
      events: [{ type: "complete" }],
    });
    const reviewEvidence = await writeArtifact(
      root,
      `${id}-review-evidence.json`,
      {
        task_id: taskId,
        harness,
        outcome: verdict,
      },
    );
    const review = await writeArtifact(root, `${id}-review.json`, {
      schema_version: "public-engineering-review/1",
      verdict,
      host: "1302-1",
      campaign_id: evidence.campaign_id,
      task_id: taskId,
      harness,
      reviewer_id: `${id}-reviewer`,
      rationale: `review ${id}`,
      evidence_refs: [reviewEvidence],
      execution_sha256: execution.sha256,
      subject_sha256: TEST_CANDIDATE_SUBJECT,
    });
    return { execution, review, taskId };
  };
  for (const harness of harnessNames) {
    const id = `harness-${counter++}`;
    const pair = await makePair(harness, id);
    harnesses.push({
      name: harness,
      execution: pair.execution,
      review: pair.review,
    });
  }
  for (const harness of harnessNames) {
    const id = `sample-${counter++}`;
    const pair = await makePair(harness, id);
    samples.push({
      id: pair.taskId,
      harness,
      execution: pair.execution,
      review: pair.review,
    });
  }
  evidence.engineering = { harnesses, samples };
  return evidence;
}

test("core policy requires cleaned full and V2 medium", () => {
  assert.deepEqual(
    benchmarkRequirements("core").map((item) => `${item.id}/${item.tier}`),
    ["longmemeval-cleaned/full", "longmemeval-v2/medium"],
  );
});

test("the evidence shell validates only when it names the fixed host and schema", () => {
  const result = validatePublicEvidence(shellEvidence());
  assert.equal(result.declarations.size, 2);
  assert.throws(
    () => validatePublicEvidence(shellEvidence({ host: "laptop" })),
    /host must equal 1302-1/,
  );
});

test("direct evaluation without validated raw runs is blocked", () => {
  const result = evaluatePublicEvidence(shellEvidence());
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /not been loaded and validated/);
});

test("unknown benchmark declarations are rejected", () => {
  assert.throws(
    () =>
      validatePublicEvidence(
        shellEvidence({
          benchmark: [
            {
              id: "invented-benchmark",
              repository: "attacker/repo",
              data_sha256: "c".repeat(64),
            },
          ],
        }),
      ),
    /unsupported benchmark invented-benchmark/,
  );
});

test("missing or malformed raw references remain blocked", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-public-test-"));
  const evidencePath = resolve(root, "evidence.json");
  await writeFile(
    evidencePath,
    JSON.stringify(shellEvidence({ artifact_root: root })),
    "utf8",
  );
  const result = await loadPublicEvidence(evidencePath);
  assert.equal(result.evaluation.status, "blocked");
  assert.match(
    result.evaluation.reason,
    /benchmark_id|question_manifest|engineering/,
  );
});

test("duplicate pair identifiers are rejected before execution", () => {
  assert.throws(
    () =>
      validatePublicEvidence(
        shellEvidence({ runs: [{ pair_id: "same" }, { pair_id: "same" }] }),
      ),
    /duplicate pair_id same/,
  );
});

test("a complete paired run derives metrics from raw artifacts and keeps missing engineering blocked", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-public-valid-"));
  const evidencePath = resolve(root, "evidence.json");
  const evidence = await validSmallEvidence(root);
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  const result = await loadPublicEvidence(evidencePath, {
    baselineSubjectSha256: TEST_BASELINE_SUBJECT,
    subjectSha256: TEST_CANDIDATE_SUBJECT,
  });
  assert.equal(result.evaluation.status, "pass");
  assert.equal(
    result.evaluation.evaluations[0].results[0].baseline.overall_accuracy,
    1,
  );
  assert.equal(
    result.evaluation.evaluations[0].results[0].candidate.p95_latency_ms,
    100,
  );
  assert.equal(
    result.evaluation.evaluations[0].results[0].candidate.context_bytes,
    Buffer.byteLength("wiki context", "utf8"),
  );
  assert.equal(result.sample.status, "blocked");
  assert.match(result.sample.reason, /engineering evidence is missing/);
});

test("internal validation fields and aggregate or per-question self-reported metrics are rejected", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "self-evolution-public-adversarial-"),
  );
  const evidence = await validSmallEvidence(root, {
    _validatedRuns: [],
  });
  const evidencePath = resolve(root, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  const injected = await loadPublicEvidence(evidencePath, {
    baselineSubjectSha256: TEST_BASELINE_SUBJECT,
    subjectSha256: TEST_CANDIDATE_SUBJECT,
  });
  assert.equal(injected.evaluation.status, "blocked");
  assert.match(injected.evaluation.reason, /evaluator-owned/);

  const cleanRoot = await mkdtemp(
    resolve(tmpdir(), "self-evolution-public-metrics-"),
  );
  const cleanEvidence = await validSmallEvidence(cleanRoot);
  const candidateResultsPath = resolve(
    cleanRoot,
    cleanEvidence.runs[0].candidate.results.path,
  );
  const candidateResults = JSON.parse(
    await readFile(candidateResultsPath, "utf8"),
  );
  candidateResults.metrics = { overall_accuracy: 1 };
  await writeFile(
    candidateResultsPath,
    JSON.stringify(candidateResults),
    "utf8",
  );
  const metricsPath = resolve(cleanRoot, "evidence.json");
  await writeFile(metricsPath, JSON.stringify(cleanEvidence), "utf8");
  const metrics = await loadPublicEvidence(metricsPath, {
    baselineSubjectSha256: TEST_BASELINE_SUBJECT,
    subjectSha256: TEST_CANDIDATE_SUBJECT,
  });
  assert.equal(metrics.evaluation.status, "blocked");
  assert.match(metrics.evaluation.reason, /metrics|hash mismatch/);
});

test("a candidate subject mismatch is not-comparable", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "self-evolution-public-subject-"),
  );
  const evidence = await validSmallEvidence(root);
  const evidencePath = resolve(root, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  const result = await loadPublicEvidence(evidencePath, {
    baselineSubjectSha256: TEST_BASELINE_SUBJECT,
    subjectSha256: "d".repeat(64),
  });
  assert.equal(result.evaluation.status, "not-comparable");
});

test("baseline digest mismatch is not-comparable", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "self-evolution-public-baseline-"),
  );
  const evidence = await validSmallEvidence(root);
  const evidencePath = resolve(root, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  const result = await loadPublicEvidence(evidencePath, {
    baselineSubjectSha256: "d".repeat(64),
    subjectSha256: TEST_CANDIDATE_SUBJECT,
  });
  assert.equal(result.evaluation.status, "not-comparable");
  assert.match(result.evaluation.reason, /baseline\.subject/);
});

test("review fail is measured as engineering failure while benchmark remains pass", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "self-evolution-public-review-"),
  );
  const evidence = await validSmallEvidence(root);
  await addEngineeringEvidence(evidence, root, "fail");
  const evidencePath = resolve(root, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  const result = await loadPublicEvidence(evidencePath, {
    baselineSubjectSha256: TEST_BASELINE_SUBJECT,
    subjectSha256: TEST_CANDIDATE_SUBJECT,
  });
  assert.equal(result.evaluation.status, "pass");
  assert.equal(result.sample.status, "fail");
  assert.match(result.sample.reason, /measured review failures/);
});

test("trace drift and invalid timestamps remain blocked", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-public-trace-"));
  const evidence = await validSmallEvidence(root);
  const ref = evidence.runs[0].candidate.results;
  const resultJson = JSON.parse(
    await readFile(resolve(root, ref.path), "utf8"),
  );
  const traceRef = resultJson.questions[0].trace;
  const traceFile = resolve(root, traceRef.path);
  const trace = JSON.parse(await readFile(traceFile, "utf8"));
  trace.ended_at = "2026-09-09T23:59:59.000Z";
  await writeFile(traceFile, JSON.stringify(trace), "utf8");
  traceRef.sha256 = testHash(Buffer.from(JSON.stringify(trace)));
  await writeFile(resolve(root, ref.path), JSON.stringify(resultJson), "utf8");
  ref.sha256 = testHash(Buffer.from(JSON.stringify(resultJson)));
  const evidencePath = resolve(root, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  const loaded = await loadPublicEvidence(evidencePath, {
    baselineSubjectSha256: TEST_BASELINE_SUBJECT,
    subjectSha256: TEST_CANDIDATE_SUBJECT,
  });
  assert.equal(loaded.evaluation.status, "blocked");
  assert.match(loaded.evaluation.reason, /ordered timestamps/);
});

test("official catalogs retain the pinned full and medium cardinalities", () => {
  assert.equal(officialCatalogQuestionIds("longmemeval-cleaned").length, 500);
  assert.equal(officialCatalogQuestionIds("longmemeval-v2").length, 451);
});
