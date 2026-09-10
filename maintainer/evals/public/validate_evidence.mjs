#!/usr/bin/env node

import { resolve } from "node:path";
import { loadPublicEvidence } from "./public.mjs";

const [
  evidenceArg,
  baselineSubjectSha256,
  subjectSha256,
  changeClass = "core",
] = process.argv.slice(2);

if (!evidenceArg || !baselineSubjectSha256 || !subjectSha256) {
  process.stderr.write(
    "Usage: node validate_evidence.mjs <evidence.json> <baseline-subject-sha256> <candidate-subject-sha256> [change-class]\n",
  );
  process.exit(2);
}

const loaded = await loadPublicEvidence(resolve(evidenceArg), {
  baselineSubjectSha256,
  subjectSha256,
  changeClass,
});

const evaluation = {
  status: loaded.evaluation.status,
  reason: loaded.evaluation.reason,
  results: (loaded.evaluation.evaluations ?? []).flatMap((evaluationItem) =>
    evaluationItem.results.map((result) => ({
      benchmark_id: evaluationItem.benchmark_id,
      tier: evaluationItem.tier,
      pair_id: result.pair_id,
      failures: result.failures,
      overall_drop: result.overallDrop,
      ability_drop: result.abilityDrop,
      p95_latency_ratio: result.p95Ratio,
      context_bytes_ratio: result.contextRatio,
      baseline: {
        overall_accuracy: result.baseline.overall_accuracy,
        ability_accuracy: result.baseline.ability_accuracy,
        p95_latency_ms: result.baseline.p95_latency_ms,
        context_bytes: result.baseline.context_bytes,
        question_count: result.baseline.question_count,
      },
      candidate: {
        overall_accuracy: result.candidate.overall_accuracy,
        ability_accuracy: result.candidate.ability_accuracy,
        p95_latency_ms: result.candidate.p95_latency_ms,
        context_bytes: result.candidate.context_bytes,
        question_count: result.candidate.question_count,
      },
    })),
  ),
};

process.stdout.write(
  `${JSON.stringify({ evaluation, engineering: loaded.sample }, null, 2)}\n`,
);

if (loaded.evaluation.status !== "pass" || loaded.sample.status === "fail")
  process.exitCode = 1;
