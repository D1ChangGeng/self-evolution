import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { loadEpisodes } from "./contracts.mjs";
import { ARMS } from "./arms.mjs";
import { deriveCost, sealEvidence, verifyEvidence } from "./evidence.mjs";
import {
  executeEpisode,
  prepareAllArms,
  assertInitialStatus,
  staleWriterCheck,
  validateCapture,
  validateTransfer,
} from "./runner.mjs";

test("initial verifier status is enforced", () => {
  assert.equal(assertInitialStatus(0, "pass"), true);
  assert.equal(assertInitialStatus(1, "fail"), true);
  assert.throws(
    () => assertInitialStatus(0, "fail"),
    /initial verifier status/,
  );
});
test("episode matrix has 24 executable contracts and L3 chains", async () => {
  const manifest = await loadEpisodes();
  assert.equal(manifest.episodes.length, 24);
  assert.ok(
    manifest.episodes.filter((item) => item.level === "L1+L3").length >= 4,
  );
  assert.equal(
    manifest.episodes.find((item) => item.id === "C06-A").sessions.length,
    3,
  );
});
test("all six arms have isolated preparation and B3 is unavailable without host", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "engineering-arms-"));
  try {
    const result = await prepareAllArms(root);
    assert.deepEqual(Object.keys(result).sort(), Object.keys(ARMS).sort());
    assert.equal(result.B3.capability, "unavailable");
    assert.notEqual(result.B0, result.B1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("real subprocess episode execution records fixture-synthetic evidence", async () => {
  const result = await executeEpisode({
    episodeId: "C06-A",
    arm: "B0",
    cleanup: false,
  });
  try {
    assert.equal(result.evidence_status, "fixture-synthetic");
    assert.equal(result.session_count, 3);
    assert.equal(
      result.status,
      "pass",
      result.error ?? JSON.stringify(result.outcomes),
    );
    await verifyEvidence(resolve(result.attempt_root, "evidence"), {
      episode_id: "C06-A",
      arm: "B0",
    });
  } finally {
    await rm(result.attempt_root, { recursive: true, force: true });
  }
});
test("C01-B/C07/C10/C11 rejection contracts are explicit", async () => {
  const { episodes } = await loadEpisodes();
  assert.equal(
    episodes.find((item) => item.id === "C01-B").transfer.mismatch_probe,
    "required-reject-then-revalidate",
  );
  assert.ok(
    episodes
      .find((item) => item.id === "C07-B")
      .transfer.reject.includes("chat-history"),
  );
  assert.equal(
    episodes.find((item) => item.id === "C10-A").scenario.capture,
    "none",
  );
  assert.equal(
    episodes.find((item) => item.id === "C10-B").scenario.capture,
    "required",
  );
  assert.equal(
    episodes.find((item) => item.id === "C11-A").scenario.probe,
    "cas-conflict",
  );
});
test("transfer, capture and stale writer are protected operations", () => {
  assert.throws(
    () =>
      validateTransfer({
        expectedWorkspaceSha256: "a",
        actualWorkspaceSha256: "b",
        artifacts: [],
        allowed: [],
      }),
    /mismatch/,
  );
  assert.throws(
    () =>
      validateTransfer({
        expectedWorkspaceSha256: "a",
        actualWorkspaceSha256: "a",
        artifacts: ["chat-history"],
        allowed: ["continuation.md"],
      }),
    /forbidden/,
  );
  assert.throws(
    () =>
      validateCapture({
        changedPaths: [".agents/knowledge/x.md"],
        expectation: "none",
      }),
    /Unexpected/,
  );
  assert.throws(
    () => staleWriterCheck({ expectedDigest: "old", currentDigest: "new" }),
    /stale writer/,
  );
});
test("missing usage remains not-measured and evidence tampering is rejected", async () => {
  const cost = deriveCost([
    {
      input_tokens: null,
      output_tokens: null,
      cached_input_tokens: null,
      tool_calls: 2,
      duration_ms: 4,
      knowledge_bytes_added: 0,
      rework_events: 0,
    },
  ]);
  assert.equal(cost.input_tokens.status, "not-measured");
  const root = await mkdtemp(resolve(tmpdir(), "engineering-evidence-"));
  await writeFile(resolve(root, "raw.json"), "{}\n");
  await sealEvidence(root, { episode_id: "C01-A" });
  await chmod(resolve(root, "raw.json"), 0o644);
  await writeFile(resolve(root, "raw.json"), "tampered\n");
  await assert.rejects(() => verifyEvidence(root), /artifact mismatch/);
  await rm(root, { recursive: true, force: true });
});
