import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";

import { workspaceEditPhasePolicy } from "../lib/campaign.mjs";
import {
  assertWorkspaceEditReceipt,
  collectRunEvidence,
  collectWorkspaceEditReceipts,
  writeWorkspaceManifest,
} from "../lib/collector.mjs";
import { stableJson } from "../lib/core.mjs";

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function receipt(overrides = {}) {
  return {
    schema_version: "1.0",
    receipt_id: sha("receipt"),
    status: "applied",
    phase: "repair",
    operation: "apply-unified-diff",
    patch_sha256: sha("patch"),
    targets: [
      {
        path: "src/index.js",
        before_sha256: sha("before\n"),
        after_sha256: sha("after\n"),
        change: "modified",
      },
    ],
    ...overrides,
  };
}

test("workspace edit receipts reject unsafe paths, phase drift, and noncanonical artifacts", async () => {
  assert.throws(
    () =>
      assertWorkspaceEditReceipt(
        receipt({
          targets: [{ ...receipt().targets[0], path: "../oracle/x" }],
        }),
      ),
    /safe workspace-relative path/,
  );
  await assert.rejects(
    collectWorkspaceEditReceipts({
      receipts: [receipt()],
      phase: "onboarding",
    }),
    /belongs to repair/,
  );

  const root = await mkdtemp(resolve(tmpdir(), "external-receipt-test-"));
  const path = resolve(root, `${receipt().receipt_id}.json`);
  await writeFile(path, `${JSON.stringify(receipt(), null, 2)}\n`);
  await assert.rejects(
    collectWorkspaceEditReceipts({ receipts: [path], phase: "repair" }),
    /not a canonical JSON artifact/,
  );
});

test("collector merges canonical gateway receipts into filesystem trace and binds final bytes", async () => {
  const parent = await mkdtemp(resolve(tmpdir(), "external-gateway-evidence-"));
  const workspace = resolve(parent, "workspace");
  const output = resolve(parent, "evidence");
  const receipts = resolve(output, "workspace-edit-receipts");
  await mkdir(resolve(workspace, "src"), { recursive: true });
  await mkdir(receipts, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "external eval test"], {
    cwd: workspace,
  });
  execFileSync("git", ["config", "user.email", "eval@example.invalid"], {
    cwd: workspace,
  });
  await writeFile(resolve(workspace, "src/index.js"), "before\n");
  execFileSync("git", ["add", "src/index.js"], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
  await writeWorkspaceManifest(
    resolve(output, "workspace.pre.json"),
    workspace,
  );
  await writeFile(resolve(output, "knowledge.pre.json"), "[]");
  await writeFile(resolve(output, "opencode.jsonl"), "");
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify({ status: "completed", exit_code: 0 }),
  );
  await writeFile(resolve(workspace, "src/index.js"), "after\n");
  const value = receipt();
  await writeFile(
    resolve(receipts, `${value.receipt_id}.json`),
    stableJson(value),
  );

  const evidence = await collectRunEvidence({
    campaign: { campaign_id: "campaign" },
    unit: { task_id: "task", attempt: 1, blind_label: "arm-aaaaaaaaaaaa" },
    phase: "repair",
    workspaceDir: workspace,
    outputDir: output,
    gatewayReceiptDir: receipts,
    gatewayCommand: "/harness/workspace-edit",
  });

  assert.equal(evidence.workspace_edit.receipt_count, 1);
  assert.deepEqual(evidence.workspace_edit.covered_paths, ["src/index.js"]);
  assert.deepEqual(evidence.workspace_edit.unreceipted_changes, []);
  const write = evidence.filesystem_trace.find(
    (item) => item.tool === "workspace-edit",
  );
  assert.equal(write.access, "write");
  assert.equal(write.path, "src/index.js");
  assert.equal(write.before_sha256, sha("before\n"));
  assert.equal(write.after_sha256, sha("after\n"));
  assert.deepEqual(
    JSON.parse(
      await readFile(resolve(output, "filesystem-trace.json"), "utf8"),
    ),
    evidence.filesystem_trace,
  );
});

test("campaign exposes phase-scoped gateway policy without exposing the receipt spool command", () => {
  const onboarding = workspaceEditPhasePolicy(
    "onboarding",
    "D:/evidence/phase",
  );
  assert.equal(onboarding.command, "/harness/workspace-edit");
  assert.deepEqual(onboarding.write_scope.allow, ["AGENTS.md", ".agents/**"]);
  assert.equal(onboarding.git_metadata.mount, "read-only");
  assert.equal(onboarding.git_metadata.GIT_OPTIONAL_LOCKS, "0");
  assert.match(onboarding.receipt_dir, /workspace-edit-receipts$/);
  assert.throws(() => workspaceEditPhasePolicy("verification", "x"));
});
