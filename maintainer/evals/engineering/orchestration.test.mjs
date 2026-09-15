import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  chmod,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeEpisode } from "./runner.mjs";
import { exampleEpisode } from "./runner-tests-helper.mjs";
import {
  deriveAttempt,
  aggregateAttempts,
  verifyEvidence,
} from "./evidence.mjs";
import {
  exportContinuation,
  receiveContinuation,
  initGit,
  materialize,
  snapshot,
} from "./workspace.mjs";
import { launch } from "./process.mjs";

test("A fixes an actual bug; B independently restores patch and completes related behavior", async () => {
  const result = await executeEpisode({ episode: exampleEpisode(), arm: "B0" });
  try {
    assert.equal(
      result.status,
      "pass",
      result.error ?? JSON.stringify(result.outcomes),
    );
    assert.equal(result.session_count, 2);
    assert.equal(result.evidence_class, "fake-cli-orchestration");
    const a = JSON.parse(
        await readFile(resolve(result.attempt_root, "evidence/session-1.json")),
      ),
      b = JSON.parse(
        await readFile(resolve(result.attempt_root, "evidence/session-2.json")),
      );
    assert.notEqual(a.pid, b.pid);
    assert.equal(a.after.sha256, b.before.sha256);
    assert.ok(
      (
        await readFile(
          resolve(result.attempt_root, "evidence/transfer-1/workspace.patch"),
        )
      ).length,
    );
    const derived = await deriveAttempt(
      resolve(result.attempt_root, "evidence"),
    );
    assert.equal(derived.cost.input_tokens.status, "not-measured");
    assert.ok(derived.cost.duration_ms.value > 0);
    assert.equal(aggregateAttempts([derived]).arms.B0.successes, 1);
  } finally {
    await rm(result.attempt_root, { recursive: true, force: true });
  }
});
test("real forced process interruption releases execution and transfer preserves completed writes", async () => {
  const result = await executeEpisode({
    episode: exampleEpisode({ interrupt: true }),
    arm: "B0",
  });
  try {
    assert.equal(
      result.status,
      "pass",
      result.error ?? JSON.stringify(result.outcomes),
    );
    const receipt = JSON.parse(
      await readFile(resolve(result.attempt_root, "evidence/session-1.json")),
    );
    assert.equal(receipt.stop_reason, "forced-interruption");
  } finally {
    await rm(result.attempt_root, { recursive: true, force: true });
  }
});
test("failed process and unwanted capture stay failed with original artifacts", async () => {
  const failed = await executeEpisode({
    episode: exampleEpisode(),
    arm: "B0",
    failSession: 1,
  });
  const bad = exampleEpisode();
  bad.scenario.sessions[1].offline_patch.push({
    path: ".agents/knowledge/unwanted.md",
    content: "bad",
  });
  const capture = await executeEpisode({ episode: bad, arm: "B0" });
  try {
    assert.equal(failed.status, "fail");
    assert.equal(failed.session_count, 1);
    assert.equal(capture.status, "fail");
    assert.equal(capture.outcomes.scope, false);
    await verifyEvidence(resolve(failed.attempt_root, "evidence"));
  } finally {
    for (const r of [failed, capture])
      await rm(r.attempt_root, { recursive: true, force: true });
  }
});
test("binary and untracked bytes transfer; wrong branch, altered patch and private files reject", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "engineering-transfer-")),
    initial = resolve(root, "initial"),
    source = resolve(root, "source"),
    packet = resolve(root, "packet");
  try {
    await mkdir(initial);
    await materialize(initial, [
      { path: "src/a.mjs", content: "export const a=1;" },
    ]);
    const base = await initGit(initial);
    await cp(initial, source, { recursive: true });
    await writeFile(resolve(source, "binary.bin"), Buffer.from([0, 1, 2, 255]));
    await writeFile(resolve(source, "src/a.mjs"), "export const a=2;");
    await exportContinuation({
      project: source,
      destination: packet,
      repo: "test-repo",
      base,
      objective: "Continue",
      next: "Verify",
      verified: [
        {
          claim: "prior validation",
          evidence: "npm test at an older revision",
        },
      ],
    });
    await assert.rejects(
      receiveContinuation({
        initial,
        destination: resolve(root, "bad-branch"),
        packet,
        repo: "test-repo",
        expectedBase: base,
        expectedBranch: "other",
      }),
      /branch mismatch/,
    );
    await writeFile(resolve(packet, "chat-history"), "private");
    await assert.rejects(
      receiveContinuation({
        initial,
        destination: resolve(root, "private"),
        packet,
        repo: "test-repo",
        expectedBase: base,
      }),
      /Forbidden/,
    );
    await rm(resolve(packet, "chat-history"));
    const receiver = resolve(root, "receiver");
    const received = await receiveContinuation({
      initial,
      destination: receiver,
      packet,
      repo: "test-repo",
      expectedBase: base,
    });
    assert.equal(received.evidence_status, "recheck-required");
    assert.deepEqual(received.stale_evidence, [0]);
    assert.equal(
      (await snapshot(receiver)).sha256,
      (await snapshot(source)).sha256,
    );
    await writeFile(resolve(packet, "workspace.patch"), "bad");
    await assert.rejects(
      receiveContinuation({
        initial,
        destination: resolve(root, "bad-patch"),
        packet,
        repo: "test-repo",
        expectedBase: base,
      }),
      /changed patch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("timeout and launch failure are explicit process receipts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "engineering-process-"));
  try {
    const timeout = await launch({
      binary: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: root,
      env: process.env,
      timeoutMs: 100,
      artifactRoot: resolve(root, "timeout"),
    });
    assert.equal(timeout.stop_reason, "timeout");
    const bad = await launch({
      binary: resolve(root, "missing.exe"),
      cwd: root,
      env: process.env,
      timeoutMs: 100,
      artifactRoot: resolve(root, "missing"),
    });
    assert.equal(bad.stop_reason, "launch-failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
