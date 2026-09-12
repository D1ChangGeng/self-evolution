import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { loadPublicEvidence } from "./public.mjs";

const exec = promisify(execFile);
const bundleName = "evidence.bundle.tar.gz";

function blocked(reason) {
  return {
    evidence: null,
    evaluation: { status: "blocked", reason },
    sample: { status: "blocked", reason },
  };
}

export async function loadBundledPublicEvidence(manifestPath, options = {}) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return blocked("evidence bundle is missing");
    return blocked(`evidence bundle manifest is unreadable: ${error.message}`);
  }
  if (
    manifest.schema_version !== "public-evidence-bundle/1" ||
    manifest.archive !== bundleName ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256)
  )
    return blocked("evidence bundle manifest is invalid");
  const archive = resolve(dirname(manifestPath), bundleName);
  let directory;
  try {
    const bytes = await readFile(archive);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== manifest.sha256)
      return blocked("evidence bundle archive hash mismatch");
    const { stdout: listing } = await exec("tar", ["-tzf", archive], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    const entries = listing.split(/\r?\n/).filter(Boolean);
    if (
      entries.length === 0 ||
      entries.some(
        (entry) =>
          entry.startsWith("/") ||
          entry.startsWith("\\") ||
          /^[A-Za-z]:/.test(entry) ||
          entry.split(/[\\/]/).includes(".."),
      )
    )
      return blocked("evidence bundle has an unsafe or empty entry list");
    directory = await mkdtemp(resolve(tmpdir(), "self-evolution-public-"));
    await exec("tar", ["-xzf", archive, "-C", directory], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    const evidencePath = resolve(directory, "evidence.json");
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (evidence.artifact_root !== ".")
      return blocked("bundled evidence must use a relative artifact root");
    return await loadPublicEvidence(evidencePath, options);
  } catch (error) {
    return blocked(`evidence bundle validation failed: ${error.message}`);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
