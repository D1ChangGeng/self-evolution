import { createHash } from "node:crypto";
import { chmod, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { stableJson } from "../contract.mjs";
import {
  safe,
  noLinks,
  changes,
  substantiveChanges,
  matches,
} from "./workspace.mjs";
import { usageFromTrace } from "./harness.mjs";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

async function files(root) {
  await noLinks(root);
  const result = [];
  async function walk(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = resolve(directory, entry.name);
      const rel = relative(root, path).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) throw new Error(`evidence symlink: ${rel}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && rel !== "manifest.json") result.push(rel);
      else if (!entry.isFile())
        throw new Error(`unsupported evidence entry: ${rel}`);
    }
  }
  await walk(root);
  return result;
}

export async function sealEvidence(root, binding) {
  const artifacts = [];
  for (const path of await files(root)) {
    const bytes = await readFile(resolve(root, path));
    artifacts.push({ path, sha256: digest(bytes), bytes: bytes.length });
    await chmod(resolve(root, path), 0o444);
  }
  const manifest = {
    schema: "engineering-evidence/1",
    binding,
    artifacts,
    artifacts_sha256: digest(stableJson(artifacts)),
  };
  await writeFile(resolve(root, "manifest.json"), stableJson(manifest), {
    flag: "wx",
  });
  await chmod(resolve(root, "manifest.json"), 0o444);
  return manifest;
}

export async function verifyEvidence(root, expected = {}) {
  await noLinks(root, "manifest.json");
  const manifest = JSON.parse(
    await readFile(resolve(root, "manifest.json"), "utf8"),
  );
  if (
    manifest.schema !== "engineering-evidence/1" ||
    !Array.isArray(manifest.artifacts) ||
    !manifest.binding ||
    typeof manifest.binding !== "object"
  )
    throw new Error("Invalid evidence manifest");
  for (const item of manifest.artifacts) {
    safe(root, item.path);
    if (
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0
    )
      throw new Error("Invalid artifact reference");
  }
  for (const [key, value] of Object.entries(expected))
    if (manifest.binding?.[key] !== value)
      throw new Error(`evidence binding mismatch: ${key}`);
  if (manifest.artifacts_sha256 !== digest(stableJson(manifest.artifacts)))
    throw new Error("artifact list digest mismatch");
  const actual = await files(root);
  if (
    stableJson(actual) !==
    stableJson(manifest.artifacts.map((item) => item.path))
  )
    throw new Error("evidence file set mismatch");
  for (const item of manifest.artifacts) {
    const bytes = await readFile(resolve(root, item.path));
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256)
      throw new Error(`evidence artifact mismatch: ${item.path}`);
  }
  return manifest;
}

function measured(value, unit) {
  return Number.isInteger(value) && value >= 0
    ? { status: "measured", value, unit }
    : { status: "not-measured", value: null, unit };
}

export function deriveCost(sessionReceipts) {
  const sum = (field) => {
    const values = sessionReceipts.map((item) => item[field]);
    return values.length &&
      values.every((value) => Number.isSafeInteger(value) && value >= 0)
      ? values.reduce((total, value) => total + value, 0)
      : null;
  };
  return {
    input_tokens: measured(sum("input_tokens"), "tokens"),
    output_tokens: measured(sum("output_tokens"), "tokens"),
    cached_input_tokens: measured(sum("cached_input_tokens"), "tokens"),
    tool_calls: measured(sum("tool_calls"), "calls"),
    duration_ms: measured(sum("duration_ms"), "ms"),
    knowledge_bytes_added: measured(sum("knowledge_bytes_added"), "bytes"),
    rework_events: measured(sum("rework_events"), "events"),
  };
}

export async function deriveAttempt(root, expected = {}) {
  const manifest = await verifyEvidence(root, expected);
  const result = JSON.parse(
    await readFile(resolve(root, "result.json"), "utf8"),
  );
  if (stableJson(result.binding) !== stableJson(manifest.binding))
    throw new Error("Result and sealed binding mismatch");
  const episode = JSON.parse(
    await readFile(resolve(root, "episode.json"), "utf8"),
  );
  if (digest(stableJson(episode)) !== manifest.binding.episode_sha256)
    throw new Error("Episode bytes do not match execution binding");
  const sessions = [];
  for (const item of manifest.artifacts.filter((item) =>
    /^session-\d+\.json$/.test(item.path),
  )) {
    const raw = JSON.parse(await readFile(resolve(root, item.path), "utf8"));
    if (!Number.isSafeInteger(raw.duration_ms) || raw.duration_ms < 0)
      throw new Error("Invalid raw elapsed duration");
    for (const stream of ["stdout", "stderr"]) {
      const reference = manifest.artifacts.find(
        (a) => a.path === `session-${raw.session}/${stream}.txt`,
      );
      if (!reference || reference.sha256 !== raw[`${stream}_sha256`])
        throw new Error("Raw trace not bound to session receipt");
    }
    const usage = usageFromTrace(
      await readFile(
        resolve(root, `session-${raw.session}/stdout.txt`),
        "utf8",
      ),
      raw.harness ?? manifest.binding.harness ?? "fake",
    );
    if (
      digest(stableJson(raw.before.entries)) !== raw.before.sha256 ||
      digest(stableJson(raw.after.entries)) !== raw.after.sha256 ||
      stableJson(changes(raw.before, raw.after)) !== stableJson(raw.diff)
    )
      throw new Error("Workspace difference is not derived from snapshots");
    sessions.push({
      duration_ms: raw.duration_ms,
      input_tokens:
        usage.input_tokens?.status === "measured"
          ? usage.input_tokens.value
          : null,
      output_tokens:
        usage.output_tokens?.status === "measured"
          ? usage.output_tokens.value
          : null,
      cached_input_tokens:
        usage.cached_input_tokens?.status === "measured"
          ? usage.cached_input_tokens.value
          : null,
      tool_calls:
        usage.tool_calls?.status === "measured" ? usage.tool_calls.value : null,
      knowledge_bytes_added: raw.diff
        .filter(
          (d) =>
            d.path.startsWith(".agents/knowledge/") && d.after?.type === "file",
        )
        .reduce(
          (n, d) => n + Math.max(0, d.after.bytes - (d.before?.bytes ?? 0)),
          0,
        ),
      rework_events: null,
    });
  }
  const cost = deriveCost(sessions);
  cost.end_to_end_ms = measured(result.elapsed_ms, "ms");
  cost.price = { status: "not-measured", value: null, unit: "currency" };
  cost.exploration_repeats = {
    status: "not-measured",
    value: null,
    unit: "events",
  };
  if (result.status === "pass") {
    const checks = JSON.parse(
      await readFile(resolve(root, "final-checks.json"), "utf8"),
    );
    for (const name of ["function", "regression", "architecture"]) {
      const receipt = checks[name];
      if (
        !receipt ||
        receipt.exit_code !== 0 ||
        receipt.stop_reason !== "normal"
      )
        throw new Error("Claimed pass contradicts raw verifier result");
      if (
        digest(await readFile(resolve(root, `final-${name}.mjs`))) !==
        digest(episode.scenario.checks[name].script)
      )
        throw new Error("Protected verifier changed");
      for (const stream of ["stdout", "stderr"])
        if (
          digest(
            await readFile(resolve(root, `final-${name}/${stream}.txt`)),
          ) !== receipt[`${stream}_sha256`]
        )
          throw new Error("Verifier output not bound");
    }
    const before = JSON.parse(
        await readFile(resolve(root, "initial-snapshot.json"), "utf8"),
      ),
      after = JSON.parse(
        await readFile(resolve(root, "final-snapshot.json"), "utf8"),
      );
    const diff = substantiveChanges(changes(before, after)),
      extra = manifest.binding.arm === "B2" ? ["ENGINEERING-HISTORY.md"] : [];
    if (
      !diff.some(
        (d) =>
          !d.path.startsWith(".agents/") && /\.(m?js|ts|json)$/.test(d.path),
      ) ||
      diff.some(
        (d) => !matches(d.path, [...episode.scenario.writable_paths, ...extra]),
      )
    )
      throw new Error("Claimed pass contradicts patch/scope evidence");
    const captured = diff.filter(
      (d) =>
        d.path.startsWith(".agents/knowledge/") ||
        d.path === "ENGINEERING-HISTORY.md",
    );
    if (
      (episode.scenario.capture === "none" && captured.length) ||
      (episode.scenario.capture === "required" && !captured.length)
    )
      throw new Error("Claimed pass contradicts Capture evidence");
    if (sessions.length !== episode.scenario.sessions.length)
      throw new Error("Incomplete session coverage cannot pass");
  }
  return {
    episode_id: result.episode_id,
    arm: result.arm,
    status: result.status,
    evidence_class: result.evidence_class,
    binding: manifest.binding,
    cost,
    session_count: sessions.length,
  };
}

export function aggregateAttempts(attempts) {
  const grouped = {};
  for (const attempt of attempts) (grouped[attempt.arm] ??= []).push(attempt);
  const arms = {};
  for (const [arm, records] of Object.entries(grouped)) {
    const success = records.filter((r) => r.status === "pass").length;
    const total = (field) =>
      records.every((r) => r.cost[field]?.status === "measured")
        ? records.reduce((sum, r) => sum + r.cost[field].value, 0)
        : null;
    const elapsed = total("end_to_end_ms"),
      tokens = total("input_tokens");
    arms[arm] = {
      attempts: records.length,
      successes: success,
      all_attempts: {
        elapsed_ms: measured(elapsed, "ms"),
        input_tokens: measured(tokens, "tokens"),
      },
      amortized_per_success_ms:
        elapsed !== null && success
          ? { status: "measured", value: elapsed / success, unit: "ms/success" }
          : { status: "not-measured", value: null, unit: "ms/success" },
    };
  }
  const paired = [];
  for (const base of attempts.filter(
    (r) => r.arm === "B4" && r.status === "pass",
  )) {
    const candidate = attempts.find(
      (r) =>
        r.arm === "B5" &&
        r.episode_id === base.episode_id &&
        r.binding.attempt === base.binding.attempt &&
        r.status === "pass",
    );
    if (
      candidate &&
      base.cost.end_to_end_ms.status === "measured" &&
      candidate.cost.end_to_end_ms.status === "measured"
    )
      paired.push({
        episode_id: base.episode_id,
        attempt: base.binding.attempt ?? null,
        delta_ms:
          candidate.cost.end_to_end_ms.value - base.cost.end_to_end_ms.value,
      });
  }
  return {
    arms,
    paired_both_successful: paired,
    inference:
      "Small samples diagnose regressions; repeated attempts are not independent tasks. Aggregate by episode/pair and repository. No significance or non-inferiority claim follows from these totals.",
  };
}
