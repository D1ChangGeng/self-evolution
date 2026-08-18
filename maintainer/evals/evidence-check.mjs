import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { stableJson } from "./contract.mjs";
import { loadIntegratedEvidence } from "./evidence.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

const fixture = {
  id: "no-capture",
  contract_sha256: "f".repeat(64),
  expected_retrieval: ["AGENTS.md"],
  material_claims: [],
  action_rubric: {
    required: [{ id: "complete-routine-edit", evidence: ["patch"] }],
    forbidden: [{ id: "create-observation", evidence: ["knowledge-diff"] }],
  },
};
const evidenceKinds = [
  ...new Set([
    ...fixture.action_rubric.required.flatMap((item) => item.evidence),
    ...fixture.action_rubric.forbidden.flatMap((item) => item.evidence),
  ]),
];

async function artifact(root, path, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const absolute = resolve(root, path);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
  return { path, sha256: digest(content) };
}

async function rawArtifact(root, path, content) {
  const absolute = resolve(root, path);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
  return { path, sha256: digest(content) };
}

function protocol(version, artifacts) {
  const v1Subject = "1".repeat(64);
  const v2Subject = digest(
    stableJson({
      bundle_sha256: "c".repeat(64),
      skill_sha256: "b".repeat(64),
    }),
  );
  return {
    campaign_id: "campaign-1",
    model: "fixed-model",
    prompt_sha256: artifacts.prompt.sha256,
    tool_budget: 20,
    repository_sha256: artifacts.repository.sha256,
    stopping_rule_sha256: artifacts.stoppingRule.sha256,
    toolchain_sha256: artifacts.toolchain.sha256,
    blind_label: version === "v1" ? "arm-4f2a91cd" : "arm-b8e73a10",
    subject_sha256: version === "v1" ? v1Subject : v2Subject,
  };
}

async function validEvidence(root, gateId = "no-capture-write-free") {
  const runs = [];
  const runIds = [];
  for (const version of ["v1", "v2"])
    for (const attempt of [1, 2, 3]) {
      const runId = `${version === "v1" ? "alpha" : "bravo"}-no-capture-${attempt}`;
      runIds.push(runId);
      const rawArtifacts = {};
      for (const kind of evidenceKinds)
        rawArtifacts[kind] = [
          await rawArtifact(
            root,
            `evidence/artifacts/${runId}-${kind}.txt`,
            `${kind} for ${runId}\n`,
          ),
        ];
      const stdout = await rawArtifact(
        root,
        `evidence/artifacts/${runId}-stdout.txt`,
        `stdout for ${runId}\n`,
      );
      const stderr = await rawArtifact(
        root,
        `evidence/artifacts/${runId}-stderr.txt`,
        `stderr for ${runId}\n`,
      );
      rawArtifacts["execution-stdout"] = [stdout];
      rawArtifacts["execution-stderr"] = [stderr];
      const protocolArtifacts = {
        prompt: await rawArtifact(
          root,
          `evidence/artifacts/${runId}-prompt.txt`,
          "fixed task prompt\n",
        ),
        repository: await rawArtifact(
          root,
          `evidence/artifacts/${runId}-repository-input.json`,
          '{"fixture":"no-capture"}\n',
        ),
        stoppingRule: await rawArtifact(
          root,
          `evidence/artifacts/${runId}-stopping-rule.txt`,
          "stop after verified task completion\n",
        ),
        toolchain: await rawArtifact(
          root,
          `evidence/artifacts/${runId}-toolchain.json`,
          '{"runner":"synthetic"}\n',
        ),
      };
      rawArtifacts.prompt = [protocolArtifacts.prompt];
      rawArtifacts["repository-input"] = [protocolArtifacts.repository];
      rawArtifacts["stopping-rule"] = [protocolArtifacts.stoppingRule];
      rawArtifacts.toolchain = [protocolArtifacts.toolchain];
      const modelResponse = await artifact(
        root,
        `evidence/artifacts/${runId}-model-response.json`,
        { usage: { input_tokens: 10, output_tokens: 5 } },
      );
      const executionTiming = await artifact(
        root,
        `evidence/artifacts/${runId}-execution-timing.json`,
        { started_at_ms: 1_000, finished_at_ms: 1_100 },
      );
      const filesystemTrace = await artifact(
        root,
        `evidence/artifacts/${runId}-filesystem-trace.json`,
        { writes: [] },
      );
      const selectedContext = await rawArtifact(
        root,
        `evidence/artifacts/${runId}-selected-context.txt`,
        "irrelevant context\n",
      );
      const captureItem = await rawArtifact(
        root,
        `evidence/artifacts/${runId}-capture-item.txt`,
        "capture item\n",
      );
      const selectedContextManifest = await artifact(
        root,
        `evidence/artifacts/${runId}-selected-context-manifest.json`,
        { items: [{ id: "context-1", artifact_ref: "selected-context:1" }] },
      );
      const captureManifest = await artifact(
        root,
        `evidence/artifacts/${runId}-capture-manifest.json`,
        { items: [{ id: "capture-1", artifact_ref: "capture-item:1" }] },
      );
      const measurementLabels = await artifact(
        root,
        `evidence/artifacts/${runId}-measurement-labels.json`,
        {
          selected_context: [
            {
              id: "context-1",
              verdict: "irrelevant",
              evidence_refs: ["selected-context:1"],
              rationale: "The selected bytes do not help the task.",
            },
          ],
          captures: [
            {
              id: "capture-1",
              verdict: "not-low-value",
              evidence_refs: ["capture-item:1"],
              rationale: "The item changes a later decision.",
            },
          ],
        },
      );
      rawArtifacts["model-response"] = [modelResponse];
      rawArtifacts["execution-timing"] = [executionTiming];
      rawArtifacts["filesystem-trace"] = [filesystemTrace];
      rawArtifacts["selected-context"] = [selectedContext];
      rawArtifacts["capture-item"] = [captureItem];
      rawArtifacts["selected-context-manifest"] = [selectedContextManifest];
      rawArtifacts["capture-manifest"] = [captureManifest];
      rawArtifacts["measurement-labels"] = [measurementLabels];
      const measurements = {
        duration_ms: { status: "measured", unit: "ms", value: 100 },
        input_tokens: { status: "measured", unit: "tokens", value: 10 },
        output_tokens: { status: "measured", unit: "tokens", value: 5 },
        metadata_writes: { status: "measured", unit: "writes", value: 0 },
        irrelevant_context_bytes: {
          status: "measured",
          unit: "bytes",
          value: Buffer.byteLength("irrelevant context\n"),
        },
        low_value_captures: {
          status: "measured",
          unit: "items",
          value: 0,
        },
      };
      rawArtifacts.measurements = [
        await artifact(root, `evidence/artifacts/${runId}-measurements.json`, {
          schema_version: "2.0",
          source_refs: {
            model_responses: ["model-response:1"],
            execution_timing: "execution-timing:1",
            filesystem_trace: "filesystem-trace:1",
            selected_context_manifest: "selected-context-manifest:1",
            capture_manifest: "capture-manifest:1",
            labels: "measurement-labels:1",
          },
          cache: measurements,
        }),
      ];
      runs.push({
        version,
        fixture_id: "no-capture",
        attempt,
        artifact: await artifact(root, `evidence/runs/${runId}.json`, {
          schema_version: "1.0",
          run_id: runId,
          suite_version: "2.0.0-rc.1",
          version,
          fixture_id: "no-capture",
          fixture_contract_sha256: fixture.contract_sha256,
          attempt,
          execution: {
            status: "completed",
            exit_code: 0,
            stdout_sha256: stdout.sha256,
            stderr_sha256: stderr.sha256,
          },
          protocol: protocol(version, protocolArtifacts),
          evidence: { artifacts: rawArtifacts },
          measurements,
        }),
      });
    }
  const review = await artifact(root, "evidence/reviews/no-capture.json", {
    schema_version: "1.0",
    gate_id: gateId,
    suite_version: "2.0.0-rc.1",
    reviewer: "blind-review-panel",
    reviewed_at: "2026-07-31",
    blind: true,
    run_reviews: runIds.map((runId) => ({
      run_id: runId,
      fixture_id: "no-capture",
      required: [
        {
          id: "complete-routine-edit",
          verdict: "satisfied",
          evidence_refs: ["patch:1"],
          rationale: "The requested edit is present.",
        },
      ],
      forbidden: [
        {
          id: "create-observation",
          verdict: "not-triggered",
          evidence_refs: ["knowledge-diff:1"],
          rationale: "The knowledge tree is unchanged.",
        },
      ],
      overall: "pass",
    })),
    gate_checks: {
      expected_retrieval: [
        {
          path: "AGENTS.md",
          verdict: "retrieved",
          run_ids: runIds.filter((runId) => runId.startsWith("bravo-")),
          rationale: "Every v2 attempt retrieved the project instructions.",
        },
      ],
      material_claims: [],
    },
    rationale: "All blinded runs satisfy the fixture rubric.",
  });
  return {
    schema_version: "2.0",
    suite_version: "2.0.0-rc.1",
    baseline_sha256: "a".repeat(64),
    v2_skill_sha256: "b".repeat(64),
    v2_bundle_sha256: "c".repeat(64),
    fixture_contracts_sha256: "d".repeat(64),
    eval_contract_sha256: "e".repeat(64),
    v1_subject_sha256: "1".repeat(64),
    gates: {
      [gateId]: {
        status: "pass",
        evidence: "All blinded routine-task runs left knowledge unchanged.",
        fixtures: ["no-capture"],
        runs,
        review: { artifact: review },
      },
    },
  };
}

async function measurementEvidence(root, runId, measurements, options = {}) {
  const artifacts = {};
  const modelResponses = options.modelResponses ?? [
    { usage: { input_tokens: 10, output_tokens: 5 } },
  ];
  artifacts["model-response"] = [];
  for (const [index, response] of modelResponses.entries())
    artifacts["model-response"].push(
      await artifact(
        root,
        `evidence/artifacts/${runId}-model-response-${index + 1}.json`,
        response,
      ),
    );
  artifacts["execution-timing"] = [
    await artifact(
      root,
      `evidence/artifacts/${runId}-execution-timing.json`,
      options.timing ?? { started_at_ms: 1_000, finished_at_ms: 1_100 },
    ),
  ];
  artifacts["filesystem-trace"] = [
    await artifact(
      root,
      `evidence/artifacts/${runId}-filesystem-trace.json`,
      options.trace ?? { writes: [] },
    ),
  ];
  artifacts["selected-context"] = [
    await rawArtifact(
      root,
      `evidence/artifacts/${runId}-selected-context.txt`,
      "irrelevant context\n",
    ),
  ];
  artifacts["capture-item"] = [
    await rawArtifact(
      root,
      `evidence/artifacts/${runId}-capture-item.txt`,
      "capture item\n",
    ),
  ];
  artifacts["selected-context-manifest"] = [
    await artifact(
      root,
      `evidence/artifacts/${runId}-selected-context-manifest.json`,
      { items: [{ id: "context-1", artifact_ref: "selected-context:1" }] },
    ),
  ];
  artifacts["capture-manifest"] = [
    await artifact(root, `evidence/artifacts/${runId}-capture-manifest.json`, {
      items: [{ id: "capture-1", artifact_ref: "capture-item:1" }],
    }),
  ];
  artifacts["measurement-labels"] = [
    await artifact(
      root,
      `evidence/artifacts/${runId}-measurement-labels.json`,
      options.labels ?? {
        selected_context: [
          {
            id: "context-1",
            verdict: "irrelevant",
            evidence_refs: ["selected-context:1"],
            rationale: "The selected bytes do not help the task.",
          },
        ],
        captures: [
          {
            id: "capture-1",
            verdict: "not-low-value",
            evidence_refs: ["capture-item:1"],
            rationale: "The item changes a later decision.",
          },
        ],
      },
    ),
  ];
  artifacts.measurements = [
    await artifact(root, `evidence/artifacts/${runId}-measurements.json`, {
      schema_version: "2.0",
      source_refs: {
        model_responses: artifacts["model-response"].map(
          (_, index) => `model-response:${index + 1}`,
        ),
        execution_timing: "execution-timing:1",
        filesystem_trace: "filesystem-trace:1",
        selected_context_manifest: "selected-context-manifest:1",
        capture_manifest: "capture-manifest:1",
        labels: "measurement-labels:1",
      },
      cache: measurements,
    }),
  ];
  return artifacts;
}

test("missing integrated evidence leaves all model gates pending", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  assert.deepEqual(
    await loadIntegratedEvidence(
      resolve(root, "evidence/integrated-gates.json"),
      root,
      [fixture],
    ),
    { gates: {}, sha256: null },
  );
});

test("accepts structured paired runs and per-rubric blind review", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const loaded = await loadIntegratedEvidence(path, root, [fixture]);
  assert.equal(loaded.gates["no-capture-write-free"].status, "pass");
  assert.match(loaded.sha256, /^[0-9a-f]{64}$/);
});

test("rejects the wrong fixture, reused artifacts, and tuple drift", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const wrongFixture = await validEvidence(root);
  wrongFixture.gates["no-capture-write-free"].fixtures = ["wrong-knowledge"];
  let path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(wrongFixture, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /must exactly match/,
  );

  const reused = await validEvidence(root);
  reused.gates["no-capture-write-free"].runs[1].artifact =
    reused.gates["no-capture-write-free"].runs[0].artifact;
  await writeFile(path, `${JSON.stringify(reused, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /artifact\.path is reused/,
  );

  const drifted = await validEvidence(root);
  const run = drifted.gates["no-capture-write-free"].runs[0];
  run.attempt = 2;
  await writeFile(path, `${JSON.stringify(drifted, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /attempt does not match|duplicates v1:no-capture:2/,
  );
});

test("rejects conflicting frozen run content for the same tuple across gates", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const firstGate = evidence.gates["no-capture-write-free"];
  const firstReviewContent = await readFile(
    resolve(root, firstGate.review.artifact.path),
    "utf8",
  );
  const second = await validEvidence(root, "low-value-capture");
  firstGate.review.artifact = await rawArtifact(
    root,
    "evidence/reviews/no-capture-write-free.json",
    firstReviewContent,
  );
  const secondGate = second.gates["low-value-capture"];
  secondGate.fixtures = ["no-capture", "uncovered-scope"];

  const conflictingRun = secondGate.runs.find(
    (item) =>
      item.version === "v2" &&
      item.fixture_id === "no-capture" &&
      item.attempt === 1,
  );
  const sourceRunPath = resolve(root, conflictingRun.artifact.path);
  const conflictingValue = JSON.parse(await readFile(sourceRunPath, "utf8"));
  conflictingValue.measurements.duration_ms.value += 1;
  Object.assign(
    conflictingValue.evidence.artifacts,
    await measurementEvidence(
      root,
      "bravo-no-capture-1-conflicting",
      conflictingValue.measurements,
      { timing: { started_at_ms: 1_000, finished_at_ms: 1_101 } },
    ),
  );
  conflictingRun.artifact = await artifact(
    root,
    "evidence/runs/bravo-no-capture-1-conflicting.json",
    conflictingValue,
  );

  evidence.gates["low-value-capture"] = secondGate;
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /conflicts with another gate's frozen run for v2:no-capture:1/,
  );
});

test("rejects prose-only review, inconsistent verdicts, and protocol drift", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const reviewPath = resolve(
    root,
    evidence.gates["no-capture-write-free"].review.artifact.path,
  );
  await writeFile(reviewPath, "approved\n", "utf8");
  evidence.gates["no-capture-write-free"].review.artifact.sha256 =
    digest("approved\n");
  let path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /Unexpected token|not valid JSON/,
  );

  const inconsistent = await validEvidence(root);
  const inconsistentReviewPath = resolve(
    root,
    inconsistent.gates["no-capture-write-free"].review.artifact.path,
  );
  const review = {
    schema_version: "1.0",
    gate_id: "no-capture-write-free",
    suite_version: "2.0.0-rc.1",
    reviewer: "blind-review-panel",
    reviewed_at: "2026-07-31",
    blind: true,
    run_reviews: [],
    gate_checks: {
      expected_retrieval: [],
      material_claims: [],
    },
    rationale: "Invalid aggregate.",
  };
  await writeFile(
    inconsistentReviewPath,
    `${JSON.stringify(review, null, 2)}\n`,
    "utf8",
  );
  inconsistent.gates["no-capture-write-free"].review.artifact.sha256 = digest(
    `${JSON.stringify(review, null, 2)}\n`,
  );
  await writeFile(path, `${JSON.stringify(inconsistent, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /must cover every run/,
  );

  const drifted = await validEvidence(root);
  const v2Run = drifted.gates["no-capture-write-free"].runs.find(
    (item) => item.version === "v2" && item.attempt === 1,
  );
  const driftPatch = await rawArtifact(
    root,
    "evidence/artifacts/v2-no-capture-1-drift.patch",
    "drifted patch\n",
  );
  const driftKnowledge = await rawArtifact(
    root,
    "evidence/artifacts/v2-no-capture-1-drift-knowledge.diff",
    "drifted knowledge diff\n",
  );
  const driftProtocolArtifacts = {
    prompt: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-drift-prompt.txt",
      "fixed task prompt\n",
    ),
    repository: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-drift-repository-input.json",
      '{"fixture":"no-capture"}\n',
    ),
    stoppingRule: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-drift-stopping-rule.txt",
      "stop after verified task completion\n",
    ),
    toolchain: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-drift-toolchain.json",
      '{"runner":"synthetic"}\n',
    ),
  };
  const value = {
    schema_version: "1.0",
    run_id: "bravo-no-capture-1",
    suite_version: "2.0.0-rc.1",
    version: "v2",
    fixture_id: "no-capture",
    fixture_contract_sha256: fixture.contract_sha256,
    attempt: 1,
    execution: {
      status: "completed",
      exit_code: 0,
      stdout_sha256: "5".repeat(64),
      stderr_sha256: "6".repeat(64),
    },
    protocol: {
      ...protocol("v2", driftProtocolArtifacts),
      model: "different-model",
    },
    evidence: {
      artifacts: {
        patch: [driftPatch],
        "knowledge-diff": [driftKnowledge],
        prompt: [driftProtocolArtifacts.prompt],
        "repository-input": [driftProtocolArtifacts.repository],
        "stopping-rule": [driftProtocolArtifacts.stoppingRule],
        toolchain: [driftProtocolArtifacts.toolchain],
        "execution-stdout": [
          await rawArtifact(
            root,
            "evidence/artifacts/v2-no-capture-1-drift-stdout.txt",
            "drift stdout\n",
          ),
        ],
        "execution-stderr": [
          await rawArtifact(
            root,
            "evidence/artifacts/v2-no-capture-1-drift-stderr.txt",
            "drift stderr\n",
          ),
        ],
      },
    },
    measurements: {
      duration_ms: { status: "measured", unit: "ms", value: 100 },
      input_tokens: { status: "measured", unit: "tokens", value: 10 },
      output_tokens: { status: "measured", unit: "tokens", value: 5 },
      metadata_writes: { status: "measured", unit: "writes", value: 0 },
      irrelevant_context_bytes: {
        status: "measured",
        unit: "bytes",
        value: Buffer.byteLength("irrelevant context\n"),
      },
      low_value_captures: { status: "measured", unit: "items", value: 0 },
    },
  };
  Object.assign(
    value.evidence.artifacts,
    await measurementEvidence(
      root,
      "v2-no-capture-1-drift",
      value.measurements,
    ),
  );
  value.execution.stdout_sha256 =
    value.evidence.artifacts["execution-stdout"][0].sha256;
  value.execution.stderr_sha256 =
    value.evidence.artifacts["execution-stderr"][0].sha256;
  v2Run.artifact = await artifact(root, v2Run.artifact.path, value);
  await writeFile(path, `${JSON.stringify(drifted, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /protocol does not match/,
  );
});

test("rejects evidence recorded for different evaluation policy", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture], {
      suite_version: evidence.suite_version,
      baseline_sha256: evidence.baseline_sha256,
      v2_skill_sha256: evidence.v2_skill_sha256,
      v2_bundle_sha256: evidence.v2_bundle_sha256,
      fixture_contracts_sha256: evidence.fixture_contracts_sha256,
      eval_contract_sha256: "0".repeat(64),
      v1_subject_sha256: evidence.v1_subject_sha256,
    }),
    /eval_contract_sha256 does not match/,
  );
});

test("requires unavailable or failed v2 runs to block the gate", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs.find(
    (item) => item.version === "v2" && item.attempt === 1,
  );
  const unavailableProtocolArtifacts = {
    prompt: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-unavailable-prompt.txt",
      "fixed task prompt\n",
    ),
    repository: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-unavailable-repository-input.json",
      '{"fixture":"no-capture"}\n',
    ),
    stoppingRule: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-unavailable-stopping-rule.txt",
      "stop after verified task completion\n",
    ),
    toolchain: await rawArtifact(
      root,
      "evidence/artifacts/v2-no-capture-1-unavailable-toolchain.json",
      '{"runner":"synthetic"}\n',
    ),
  };
  const value = {
    schema_version: "1.0",
    run_id: "bravo-no-capture-1",
    suite_version: "2.0.0-rc.1",
    version: "v2",
    fixture_id: "no-capture",
    fixture_contract_sha256: fixture.contract_sha256,
    attempt: 1,
    execution: {
      status: "unavailable",
      exit_code: 2,
      stdout_sha256: "5".repeat(64),
      stderr_sha256: "6".repeat(64),
    },
    protocol: protocol("v2", unavailableProtocolArtifacts),
    evidence: {
      artifacts: {
        patch: [
          await rawArtifact(
            root,
            "evidence/artifacts/v2-no-capture-1-unavailable.patch",
            "unavailable patch placeholder\n",
          ),
        ],
        "knowledge-diff": [
          await rawArtifact(
            root,
            "evidence/artifacts/v2-no-capture-1-unavailable-knowledge.diff",
            "unavailable knowledge diff\n",
          ),
        ],
        "tool-transcript": [
          await rawArtifact(
            root,
            "evidence/artifacts/v2-no-capture-1.txt",
            "unavailable run transcript\n",
          ),
        ],
        prompt: [unavailableProtocolArtifacts.prompt],
        "repository-input": [unavailableProtocolArtifacts.repository],
        "stopping-rule": [unavailableProtocolArtifacts.stoppingRule],
        toolchain: [unavailableProtocolArtifacts.toolchain],
        "execution-stdout": [
          await rawArtifact(
            root,
            "evidence/artifacts/v2-no-capture-1-unavailable-stdout.txt",
            "unavailable stdout\n",
          ),
        ],
        "execution-stderr": [
          await rawArtifact(
            root,
            "evidence/artifacts/v2-no-capture-1-unavailable-stderr.txt",
            "unavailable stderr\n",
          ),
        ],
      },
    },
    measurements: {
      duration_ms: { status: "not-measured", unit: "ms", value: null },
      input_tokens: { status: "not-measured", unit: "tokens", value: null },
      output_tokens: { status: "not-measured", unit: "tokens", value: null },
      metadata_writes: { status: "not-measured", unit: "writes", value: null },
      irrelevant_context_bytes: {
        status: "not-measured",
        unit: "bytes",
        value: null,
      },
      low_value_captures: {
        status: "not-measured",
        unit: "items",
        value: null,
      },
    },
  };
  Object.assign(
    value.evidence.artifacts,
    await measurementEvidence(
      root,
      "v2-no-capture-1-unavailable",
      value.measurements,
      {
        modelResponses: [{}],
        timing: {},
        trace: {},
        labels: {},
      },
    ),
  );
  value.execution.stdout_sha256 =
    value.evidence.artifacts["execution-stdout"][0].sha256;
  value.execution.stderr_sha256 =
    value.evidence.artifacts["execution-stderr"][0].sha256;
  run.artifact = await artifact(root, run.artifact.path, value);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /status does not match the structured review/,
  );
});

test("rejects completed executions with non-zero exit codes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.execution.exit_code = 2;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /completed status must have exit_code 0/,
  );
});

test("binds execution stream hashes to raw artifacts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.execution.stdout_sha256 = "0".repeat(64);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /stdout_sha256 does not match the execution-stdout artifact/,
  );
});

test("binds numeric measurements to a hashed artifact", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.measurements.input_tokens.value += 1;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /measurements do not match the bound measurement artifact|cache does not match evaluator-derived measurements/,
  );
});

test("derives measurements from raw artifacts instead of accepting matching assertions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.measurements.input_tokens.value = 99;
  const measurementPath = resolve(
    root,
    value.evidence.artifacts.measurements[0].path,
  );
  const measurementArtifact = JSON.parse(
    await readFile(measurementPath, "utf8"),
  );
  measurementArtifact.cache.input_tokens.value = 99;
  const measurementContent = `${JSON.stringify(measurementArtifact, null, 2)}\n`;
  await writeFile(measurementPath, measurementContent, "utf8");
  value.evidence.artifacts.measurements[0].sha256 = digest(measurementContent);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /cache does not match evaluator-derived measurements/,
  );
});

test("marks malformed provider usage as not measured instead of zero", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  const responsePath = resolve(
    root,
    value.evidence.artifacts["model-response"][0].path,
  );
  const responseContent = '{"status":502}\n';
  await writeFile(responsePath, responseContent, "utf8");
  value.evidence.artifacts["model-response"][0].sha256 =
    digest(responseContent);
  value.measurements.input_tokens = {
    status: "not-measured",
    unit: "tokens",
    value: null,
  };
  value.measurements.output_tokens = {
    status: "not-measured",
    unit: "tokens",
    value: null,
  };
  const measurementPath = resolve(
    root,
    value.evidence.artifacts.measurements[0].path,
  );
  const measurementArtifact = JSON.parse(
    await readFile(measurementPath, "utf8"),
  );
  measurementArtifact.cache.input_tokens = value.measurements.input_tokens;
  measurementArtifact.cache.output_tokens = value.measurements.output_tokens;
  const measurementContent = `${JSON.stringify(measurementArtifact, null, 2)}\n`;
  await writeFile(measurementPath, measurementContent, "utf8");
  value.evidence.artifacts.measurements[0].sha256 = digest(measurementContent);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const loaded = await loadIntegratedEvidence(path, root, [fixture]);
  const validated = loaded.gates["no-capture-write-free"].validated_runs;
  assert.equal(validated[0].measurements.input_tokens.status, "not-measured");
  assert.equal(validated[0].measurements.input_tokens.value, null);
  assert.equal(loaded.gates["no-capture-write-free"].status, "pass");
});

test("requires a verdict for every selected-context and Capture item", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  const labelsPath = resolve(
    root,
    value.evidence.artifacts["measurement-labels"][0].path,
  );
  const labels = JSON.parse(await readFile(labelsPath, "utf8"));
  labels.selected_context = [];
  const labelsContent = `${JSON.stringify(labels, null, 2)}\n`;
  await writeFile(labelsPath, labelsContent, "utf8");
  value.evidence.artifacts["measurement-labels"][0].sha256 =
    digest(labelsContent);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /cache does not match evaluator-derived measurements/,
  );
});

test("requires unavailable measurements to stay unavailable instead of zero", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.measurements.input_tokens = {
    status: "not-measured",
    unit: "tokens",
    value: 0,
  };
  const measurementPath = resolve(
    root,
    value.evidence.artifacts.measurements[0].path,
  );
  const measurementArtifact = JSON.parse(
    await readFile(measurementPath, "utf8"),
  );
  measurementArtifact.cache.input_tokens = value.measurements.input_tokens;
  const measurementContent = `${JSON.stringify(measurementArtifact, null, 2)}\n`;
  await writeFile(measurementPath, measurementContent, "utf8");
  value.evidence.artifacts.measurements[0].sha256 = digest(measurementContent);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /value must be null unless measured/,
  );
});

test("binds protocol hashes to raw campaign inputs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.protocol.prompt_sha256 = "0".repeat(64);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /prompt_sha256 does not match the prompt artifact/,
  );
});

test("binds each run to the frozen evaluated subject", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const run = evidence.gates["no-capture-write-free"].runs.find(
    (item) => item.version === "v1",
  );
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.protocol.subject_sha256 = "0".repeat(64);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /subject_sha256 does not match the evaluated subject/,
  );
});

test("uses v1 attempts as baselines for absolute v2 outcome gates", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const reviewPath = resolve(
    root,
    evidence.gates["no-capture-write-free"].review.artifact.path,
  );
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  const v1Review = review.run_reviews.find(
    (item) => item.run_id === "alpha-no-capture-1",
  );
  v1Review.required[0].verdict = "not-satisfied";
  v1Review.required[0].rationale =
    "The frozen v1 baseline did not complete the routine edit.";
  v1Review.overall = "fail";
  const reviewContent = `${JSON.stringify(review, null, 2)}\n`;
  await writeFile(reviewPath, reviewContent, "utf8");
  evidence.gates["no-capture-write-free"].review.artifact.sha256 =
    digest(reviewContent);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const loaded = await loadIntegratedEvidence(path, root, [fixture]);
  assert.equal(loaded.gates["no-capture-write-free"].status, "pass");
});

test("requires review coverage for expected retrieval and material claims", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const reviewPath = resolve(
    root,
    evidence.gates["no-capture-write-free"].review.artifact.path,
  );
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  review.gate_checks.expected_retrieval = [];
  const reviewContent = `${JSON.stringify(review, null, 2)}\n`;
  await writeFile(reviewPath, reviewContent, "utf8");
  evidence.gates["no-capture-write-free"].review.artifact.sha256 =
    digest(reviewContent);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /must cover every expected route/,
  );
});

test("comparison gates reject a paired rubric regression", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root, "low-value-capture");
  const gate = evidence.gates["low-value-capture"];
  gate.fixtures = ["no-capture", "uncovered-scope"];
  const uncovered = {
    ...fixture,
    id: "uncovered-scope",
    contract_sha256: "0".repeat(64),
  };

  const originalRuns = [...gate.runs];
  const originalReview = JSON.parse(
    await readFile(resolve(root, gate.review.artifact.path), "utf8"),
  );
  const uncoveredReviews = [];
  for (const sourceRun of originalRuns) {
    const version = sourceRun.version;
    const attempt = sourceRun.attempt;
    const sourceValue = JSON.parse(
      await readFile(resolve(root, sourceRun.artifact.path), "utf8"),
    );
    const runId = `${version === "v1" ? "charlie" : "delta"}-uncovered-scope-${attempt}`;
    const rawArtifacts = {};
    for (const [kind, artifacts] of Object.entries(
      sourceValue.evidence.artifacts,
    )) {
      rawArtifacts[kind] = [];
      for (const [index, raw] of artifacts.entries()) {
        const content = await readFile(resolve(root, raw.path), "utf8");
        rawArtifacts[kind].push(
          await rawArtifact(
            root,
            `evidence/artifacts/${runId}-${kind}-${index + 1}.txt`,
            content.replaceAll(sourceValue.run_id, runId),
          ),
        );
      }
    }
    const value = {
      ...sourceValue,
      run_id: runId,
      fixture_id: "uncovered-scope",
      fixture_contract_sha256: uncovered.contract_sha256,
      evidence: { artifacts: rawArtifacts },
      execution: {
        ...sourceValue.execution,
        stdout_sha256: rawArtifacts["execution-stdout"][0].sha256,
        stderr_sha256: rawArtifacts["execution-stderr"][0].sha256,
      },
    };
    gate.runs.push({
      version,
      fixture_id: "uncovered-scope",
      attempt,
      artifact: await artifact(root, `evidence/runs/${runId}.json`, value),
    });
    uncoveredReviews.push({
      ...structuredClone(originalReview.run_reviews[0]),
      run_id: runId,
      fixture_id: "uncovered-scope",
    });
  }
  originalReview.run_reviews.push(...uncoveredReviews);
  const v1Review = originalReview.run_reviews.find(
    (item) => item.run_id === "alpha-no-capture-1",
  );
  const v2Review = originalReview.run_reviews.find(
    (item) => item.run_id === "bravo-no-capture-1",
  );
  v1Review.overall = "pass";
  v2Review.required[0].verdict = "not-satisfied";
  v2Review.overall = "fail";
  const reviewContent = `${JSON.stringify(originalReview, null, 2)}\n`;
  await writeFile(
    resolve(root, gate.review.artifact.path),
    reviewContent,
    "utf8",
  );
  gate.review.artifact.sha256 = digest(reviewContent);
  gate.status = "fail";
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const loaded = await loadIntegratedEvidence(path, root, [fixture, uncovered]);
  assert.equal(loaded.gates["low-value-capture"].status, "fail");
});

test("comparison gates cannot offset a regressed attempt with another pass", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root, "low-value-capture");
  const gate = evidence.gates["low-value-capture"];
  gate.fixtures = ["no-capture", "uncovered-scope"];
  const uncovered = {
    ...fixture,
    id: "uncovered-scope",
    contract_sha256: "0".repeat(64),
  };
  const sourceRuns = [...gate.runs];
  const reviewPath = resolve(root, gate.review.artifact.path);
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  for (const sourceRun of sourceRuns) {
    const sourceValue = JSON.parse(
      await readFile(resolve(root, sourceRun.artifact.path), "utf8"),
    );
    const runId = `${sourceRun.version === "v1" ? "echo" : "foxtrot"}-uncovered-${sourceRun.attempt}`;
    const rawArtifacts = {};
    for (const [kind, artifacts] of Object.entries(
      sourceValue.evidence.artifacts,
    )) {
      rawArtifacts[kind] = [];
      for (const [index, raw] of artifacts.entries()) {
        const content = await readFile(resolve(root, raw.path), "utf8");
        rawArtifacts[kind].push(
          await rawArtifact(
            root,
            `evidence/artifacts/${runId}-${kind}-${index + 1}.txt`,
            content.replaceAll(sourceValue.run_id, runId),
          ),
        );
      }
    }
    const value = {
      ...sourceValue,
      run_id: runId,
      fixture_id: uncovered.id,
      fixture_contract_sha256: uncovered.contract_sha256,
      evidence: { artifacts: rawArtifacts },
      execution: {
        ...sourceValue.execution,
        stdout_sha256: rawArtifacts["execution-stdout"][0].sha256,
        stderr_sha256: rawArtifacts["execution-stderr"][0].sha256,
      },
    };
    gate.runs.push({
      version: sourceRun.version,
      fixture_id: uncovered.id,
      attempt: sourceRun.attempt,
      artifact: await artifact(root, `evidence/runs/${runId}.json`, value),
    });
    review.run_reviews.push({
      ...structuredClone(review.run_reviews[0]),
      run_id: runId,
      fixture_id: uncovered.id,
    });
  }
  const v1Attempt1 = review.run_reviews.find(
    (item) => item.run_id === "alpha-no-capture-1",
  );
  const v2Attempt1 = review.run_reviews.find(
    (item) => item.run_id === "bravo-no-capture-1",
  );
  const v1Attempt2 = review.run_reviews.find(
    (item) => item.run_id === "alpha-no-capture-2",
  );
  v2Attempt1.required[0].verdict = "not-satisfied";
  v2Attempt1.overall = "fail";
  v1Attempt2.required[0].verdict = "not-satisfied";
  v1Attempt2.overall = "fail";
  assert.equal(v1Attempt1.overall, "pass");
  const reviewContent = `${JSON.stringify(review, null, 2)}\n`;
  await writeFile(reviewPath, reviewContent, "utf8");
  gate.review.artifact.sha256 = digest(reviewContent);
  gate.status = "fail";
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const loaded = await loadIntegratedEvidence(path, root, [fixture, uncovered]);
  assert.equal(loaded.gates["low-value-capture"].status, "fail");
});

test("rejects review artifacts that expose version labels", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-evidence-"));
  const evidence = await validEvidence(root);
  const gate = evidence.gates["no-capture-write-free"];
  const run = gate.runs[0];
  const runPath = resolve(root, run.artifact.path);
  const value = JSON.parse(await readFile(runPath, "utf8"));
  value.run_id = "v1-exposed-run";
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(runPath, content, "utf8");
  run.artifact.sha256 = digest(content);
  const reviewPath = resolve(root, gate.review.artifact.path);
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  review.run_reviews.find(
    (item) => item.run_id === "alpha-no-capture-1",
  ).run_id = value.run_id;
  const reviewContent = `${JSON.stringify(review, null, 2)}\n`;
  await writeFile(reviewPath, reviewContent, "utf8");
  gate.review.artifact.sha256 = digest(reviewContent);
  const path = resolve(root, "evidence/integrated-gates.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadIntegratedEvidence(path, root, [fixture]),
    /exposes the evaluated version/,
  );
});
