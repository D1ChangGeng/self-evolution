import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { stableJson } from "../contract.mjs";
import { executeEpisode } from "./runner.mjs";
import { loadEpisodes } from "./contracts.mjs";
import { runPlan, policyDigest, evaluateEngineeringGate } from "./policy.mjs";
import { deriveAttempt, aggregateAttempts } from "./evidence.mjs";
import { digest } from "./workspace.mjs";
import { authorizeModelRun } from "./harness.mjs";

const [command, output, configPath] = process.argv.slice(2);
if (command === "plan") console.log(stableJson(runPlan({ diagnostic: true })));
else if (command === "gate") {
  const result = await evaluateEngineeringGate();
  console.log(stableJson(result));
  process.exitCode = result.release_ready ? 0 : 1;
} else if (command === "offline" || command === "model") {
  if (!output)
    throw new Error(
      "Usage: campaign.mjs offline <new-output-root> | model <new-output-root> <authorized-config.json>",
    );
  const root = resolve(output);
  await mkdir(root, { recursive: false });
  const started = performance.now(),
    catalog = await loadEpisodes();
  const config =
    command === "model" ? JSON.parse(await readFile(configPath, "utf8")) : null;
  if (config) authorizeModelRun(config);
  const plan =
    command === "model"
      ? runPlan({ diagnostic: true })
      : {
          schema: "engineering-offline-plan/1",
          units: catalog.episodes.map((e) => ({
            episode_id: e.id,
            arm: "B5",
            attempt: 1,
          })),
          max_attempts: 24,
          limits: {
            session_timeout_ms: 20000,
            total_timeout_ms: 30 * 60 * 1000,
          },
          purpose: "fake CLI orchestration and catalog regression",
        };
  await writeFile(resolve(root, "plan.json"), stableJson(plan));
  const policy = await policyDigest();
  await writeFile(resolve(root, "policy.json"), stableJson(policy));
  const results = [];
  for (const unit of plan.units) {
    if (performance.now() - started > plan.limits.total_timeout_ms)
      throw new Error(
        "Campaign total time limit reached; preserve incomplete attempt coverage",
      );
    if (config && performance.now() - started > config.budget.total_timeout_ms)
      throw new Error("Authorized model campaign total time budget exhausted");
    const result = await executeEpisode({
      episodeId: unit.episode_id,
      arm: unit.arm,
      attemptNumber: unit.attempt,
      outputRoot: resolve(
        root,
        `${unit.episode_id}-${unit.arm}-${unit.attempt}`,
      ),
      modelConfig: config,
    });
    const evidence = resolve(result.attempt_root, "evidence");
    const derived = await deriveAttempt(evidence);
    results.push({
      ...derived,
      evidence_manifest_sha256: digest(
        await readFile(resolve(evidence, "manifest.json")),
      ),
      evidence_path: `${unit.episode_id}-${unit.arm}-${unit.attempt}/evidence`,
    });
    console.log(
      `${unit.episode_id} ${unit.arm} ${result.status}${result.error ? " " + result.error : ""}`,
    );
  }
  const report = {
    schema: "engineering-campaign/1",
    evidence_class:
      command === "model"
        ? "real-harness-diagnostic"
        : "fake-cli-orchestration",
    policy_sha256: policy.sha256,
    plan_sha256: digest(stableJson(plan)),
    results,
    aggregate: aggregateAttempts(results),
    release_ready: false,
  };
  await writeFile(resolve(root, "results.json"), stableJson(report));
  process.exitCode = results.every((r) => r.status === "pass") ? 0 : 1;
} else if (command === "report") {
  const report = JSON.parse(
    await readFile(resolve(output, "results.json"), "utf8"),
  );
  const results = [];
  for (const old of report.results) {
    const path = resolve(output, old.evidence_path);
    if (
      digest(await readFile(resolve(path, "manifest.json"))) !==
      old.evidence_manifest_sha256
    )
      throw new Error("Campaign attempt manifest changed");
    results.push(await deriveAttempt(path));
  }
  console.log(stableJson(aggregateAttempts(results)));
} else {
  console.error(
    "Usage: campaign.mjs plan | offline <new-root> | model <new-root> <config.json> | report <root> | gate",
  );
  process.exitCode = 2;
}
