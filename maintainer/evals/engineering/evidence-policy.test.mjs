import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { restoreFrozen, distribution } from "./subject.mjs";
import { prepareArm } from "./arms.mjs";
import { usageFromTrace, authorizeModelRun, modelCommand } from "./harness.mjs";
import { aggregateAttempts, deriveCost, deriveAttempt } from "./evidence.mjs";
import { evaluateEngineeringGate, runPlan } from "./policy.mjs";
import { exampleEpisode } from "./runner-tests-helper.mjs";
import { executeEpisode } from "./runner.mjs";
import { digest } from "./workspace.mjs";
import { stableJson } from "../contract.mjs";

test("frozen B4 bytes restore exactly without Git/network or current candidate", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "engineering-baseline-"));
  try {
    const subject = await restoreFrozen(
      import.meta.dirname,
      resolve(root, "frozen"),
    );
    const expected = JSON.parse(
      await readFile(resolve(import.meta.dirname, "baseline/manifest.json")),
    );
    assert.equal((await distribution(subject)).sha256, expected.subject_sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("B0 retains common project state while B2/B5 receive identical offered historical facts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "engineering-arms-"));
  const history = [
    {
      path: ".agents/knowledge/guides/example.md",
      content:
        "---\nkind: guide\nstatus: active\nscope: [src/a.mjs]\nuse_when: [editing a]\n---\n# A\nPreserve the empty-input identity.\n",
    },
  ];
  try {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    for (const arm of ["B0", "B2", "B5"]) {
      const state = await prepareArm({
        arm,
        workspace: resolve(root, arm),
        repoRoot,
        history,
      });
      if (arm === "B0") assert.equal(state.reference, null);
      if (arm === "B2")
        assert.ok(
          (
            await readFile(
              resolve(state.project, "ENGINEERING-HISTORY.md"),
              "utf8",
            )
          ).includes(history[0].content),
        );
      if (arm === "B5")
        assert.equal(
          await readFile(resolve(state.project, history[0].path), "utf8"),
          history[0].content,
        );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("provider usage derives exact reported tokens; absent values remain unavailable", () => {
  const usage = usageFromTrace(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 500, output_tokens: 30, cached_input_tokens: 400 },
    }),
    "codex",
  );
  assert.equal(usage.input_tokens.value, 500);
  assert.equal(usage.cached_input_tokens.value, 400);
  assert.equal(
    usageFromTrace("{}", "codex").input_tokens.status,
    "not-measured",
  );
  assert.equal(deriveCost([]).input_tokens.status, "not-measured");
  const record = (arm, status, ms) => ({
    arm,
    status,
    episode_id: "C01-A",
    binding: { attempt: 1 },
    cost: {
      end_to_end_ms: { status: "measured", value: ms },
      input_tokens: { status: "not-measured", value: null },
    },
  });
  const result = aggregateAttempts([
    record("B4", "fail", 10),
    record("B4", "pass", 100),
    record("B5", "pass", 80),
  ]);
  assert.equal(result.arms.B4.all_attempts.elapsed_ms.value, 110);
  assert.equal(result.arms.B4.amortized_per_success_ms.value, 110);
  assert.equal(result.paired_both_successful.length, 1);
});
test("model calls require authorization and formal isolation; commands retain separate harness contracts", () => {
  assert.throws(() => authorizeModelRun({}), /authorization/);
  const config = {
    authorized: true,
    binary: process.execPath,
    model: "configured-alias",
    budget: {
      max_sessions: 3,
      session_timeout_ms: 1000,
      total_timeout_ms: 3000,
    },
  };
  assert.throws(() => authorizeModelRun(config), /isolation/);
  assert.equal(authorizeModelRun({ ...config, profile: "diagnostic" }), true);
  assert.ok(
    modelCommand({
      name: "codex",
      binary: "codex",
      model: "alias",
      prompt: "build",
      output: "out",
    }).args.includes("--ephemeral"),
  );
  assert.ok(
    modelCommand({
      name: "claude-code",
      binary: "claude",
      model: "alias",
      prompt: "build",
      output: "out",
    }).args.includes("--no-session-persistence"),
  );
});
test("release evidence is pending when absent and rejects malformed manifests", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "engineering-gate-"));
  try {
    assert.equal(
      (
        await evaluateEngineeringGate({
          evidencePath: resolve(root, "missing"),
        })
      ).status,
      "pending",
    );
    await writeFile(resolve(root, "invalid"), "{}");
    assert.equal(
      (
        await evaluateEngineeringGate({
          evidencePath: resolve(root, "invalid"),
        })
      ).status,
      "blocked",
    );
    assert.equal(runPlan().units.length, 24);
    assert.equal(runPlan({ diagnostic: false }).units.length, 72);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("resealing a claimed pass cannot override failing raw verifier evidence", async () => {
  const result = await executeEpisode({ episode: exampleEpisode(), arm: "B0" });
  const root = resolve(result.attempt_root, "evidence");
  try {
    assert.equal(result.status, "pass");
    const path = resolve(root, "final-checks.json"),
      checks = JSON.parse(await readFile(path));
    checks.function.exit_code = 1;
    await chmod(path, 0o644);
    await writeFile(path, stableJson(checks));
    const manifestPath = resolve(root, "manifest.json"),
      manifest = JSON.parse(await readFile(manifestPath));
    const item = manifest.artifacts.find((a) => a.path === "final-checks.json"),
      bytes = await readFile(path);
    item.bytes = bytes.length;
    item.sha256 = digest(bytes);
    manifest.artifacts_sha256 = digest(stableJson(manifest.artifacts));
    await chmod(manifestPath, 0o644);
    await writeFile(manifestPath, stableJson(manifest));
    await assert.rejects(deriveAttempt(root), /contradicts raw verifier/);
  } finally {
    await rm(result.attempt_root, { recursive: true, force: true });
  }
});
