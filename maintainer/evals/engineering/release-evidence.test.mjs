import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, chmod, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { executeEpisode } from "./runner.mjs";
import { exampleEpisode } from "./runner-tests-helper.mjs";
import { deriveAttempt, digest } from "./evidence.mjs";
import { stableJson } from "../contract.mjs";

test("release derivation rejects relabeled arms, replayed sessions and detached snapshots", async () => {
  const result = await executeEpisode({ episode: exampleEpisode(), arm: "B0" });
  const root = resolve(result.attempt_root, "evidence");
  const originalManifest = await readFile(resolve(root, "manifest.json"));
  const originalResult = await readFile(resolve(root, "result.json"));
  const first = await readFile(resolve(root, "session-1.json"));
  const second = await readFile(resolve(root, "session-2.json"));
  async function replace(name, bytes) {
    const path = resolve(root, name);
    await chmod(path, 0o644);
    await writeFile(path, bytes);
    const manifest = JSON.parse(originalManifest);
    const ref = manifest.artifacts.find((a) => a.path === name);
    ref.sha256 = digest(bytes);
    ref.bytes = Buffer.byteLength(bytes);
    manifest.artifacts_sha256 = digest(stableJson(manifest.artifacts));
    await chmod(resolve(root, "manifest.json"), 0o644);
    await writeFile(resolve(root, "manifest.json"), stableJson(manifest));
  }
  try {
    assert.equal(result.status, "pass");
    await replace(
      "result.json",
      stableJson({ ...JSON.parse(originalResult), arm: "B3" }),
    );
    await assert.rejects(deriveAttempt(root), /identity mismatch/);
    await writeFile(resolve(root, "result.json"), originalResult);
    await replace("session-2.json", first);
    await assert.rejects(deriveAttempt(root), /Session identity/);
    await writeFile(resolve(root, "session-2.json"), second);
    const snap = JSON.parse(
      await readFile(resolve(root, "final-snapshot.json")),
    );
    snap.sha256 = "0".repeat(64);
    await replace("final-snapshot.json", stableJson(snap));
    await assert.rejects(deriveAttempt(root), /snapshot binding/);
  } finally {
    await rm(result.attempt_root, { recursive: true, force: true });
  }
});
