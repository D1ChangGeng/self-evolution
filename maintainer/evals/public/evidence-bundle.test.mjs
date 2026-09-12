import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { loadBundledPublicEvidence } from "./evidence-bundle.mjs";

const exec = promisify(execFile);

test("bundle verifies archive bytes and extracts evidence for validation", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "self-evolution-bundle-test-"));
  const source = resolve(root, "source");
  await mkdir(source);
  await writeFile(
    resolve(source, "evidence.json"),
    JSON.stringify({ artifact_root: ".", schema_version: "invalid" }),
  );
  const archive = resolve(root, "evidence.bundle.tar.gz");
  await exec("tar", ["-czf", archive, "-C", source, "evidence.json"]);
  const bytes = await readFile(archive);
  const manifest = resolve(root, "evidence.bundle.json");
  await writeFile(
    manifest,
    JSON.stringify({
      schema_version: "public-evidence-bundle/1",
      archive: "evidence.bundle.tar.gz",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  const loaded = await loadBundledPublicEvidence(manifest);
  assert.equal(loaded.evaluation.status, "blocked");
  assert.match(loaded.evaluation.reason, /schema_version/);

  await writeFile(archive, Buffer.concat([bytes, Buffer.from("tampered")]));
  const tampered = await loadBundledPublicEvidence(manifest);
  assert.equal(tampered.evaluation.status, "blocked");
  assert.match(tampered.evaluation.reason, /hash mismatch/);
});
