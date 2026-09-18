import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { exportExistingAdapter, integrationPlan, loadPairs } from "./l2.mjs";

test("eight actual historical pairs retain independent patches and pinned license provenance", async () => {
  const manifest = await loadPairs();
  assert.equal(manifest.pairs.length, 8);
  assert.equal(new Set(manifest.pairs.map((p) => p.repository)).size, 3);
  for (const pair of manifest.pairs) {
    assert.equal(pair.status, "selected-provenance-verified");
    assert.equal(pair.execution, "not-tested");
  }
});
test("L2 integrates the existing exact-base external task adapter", async () => {
  const plan = await integrationPlan();
  const entry = plan.find((p) => p.id === "qs-encoding-boundaries");
  assert.equal(entry.stages[0].adapter_id, "qs-surrogate-boundary");
  const root = await mkdtemp(resolve(tmpdir(), "engineering-l2-"));
  try {
    const task = await exportExistingAdapter({
      pairId: entry.id,
      stage: "experience",
      output: resolve(root, "export"),
    });
    assert.equal(
      task.repository.oracle_sha,
      "59da434d5de8c3d2564e4d75aeedde2e8af72369",
    );
    assert.ok(
      (
        await readFile(
          resolve(
            root,
            "export/qs-surrogate-boundary/hidden/external-surrogate-boundary.test.js",
          ),
        )
      ).length,
    );
    await assert.rejects(
      exportExistingAdapter({
        pairId: entry.id,
        stage: "followup",
        output: resolve(root, "unprepared"),
      }),
      /no validated/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
