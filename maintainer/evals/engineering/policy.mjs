import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { stableJson } from "../contract.mjs";
import { digest, safe, noLinks } from "./workspace.mjs";
import { loadEpisodes, POLICY_VERSION } from "./contracts.mjs";
import { deriveAttempt } from "./evidence.mjs";
import { distribution } from "./subject.mjs";

export const CORE_EPISODES = Object.freeze([
  "C01-A",
  "C02-A",
  "C03-B",
  "C04-A",
  "C05-B",
  "C06-A",
  "C07-A",
  "C10-B",
]);
export const CONTROL_EPISODES = Object.freeze(["C02-A", "C04-A", "C10-A"]);
export async function policyDigest(root = import.meta.dirname) {
  const names = (await readdir(root))
    .filter(
      (n) =>
        /\.(mjs|json|md)$/.test(n) &&
        !n.endsWith(".test.mjs") &&
        ![
          "RESULTS.md",
          "offline-results.json",
          "model-evidence.json",
          "l2-pairs.json",
        ].includes(n),
    )
    .sort();
  const files = {};
  for (const name of names)
    files[name] = digest(await readFile(resolve(root, name)));
  return { sha256: digest(stableJson(files)), files };
}
export function runPlan({
  diagnostic = true,
  arms = ["B0", "B4", "B5"],
  repetitions = diagnostic ? 1 : 3,
} = {}) {
  const units = [];
  for (let attempt = 1; attempt <= repetitions; attempt++)
    for (const id of CORE_EPISODES)
      for (const arm of arms) units.push({ episode_id: id, arm, attempt });
  return {
    schema: "engineering-run-plan/1",
    policy: POLICY_VERSION,
    purpose: diagnostic ? "execution-diagnostic" : "paired-core-effects",
    units,
    max_attempts: units.length,
    limits: {
      session_timeout_ms: 120000,
      total_timeout_ms: units.length * 3 * 120000,
      max_sessions_per_attempt: 3,
      max_infrastructure_retries: 0,
    },
    model: "required-before-execution",
    harness: "required-before-execution",
    budget_authorization: "required-before-execution",
    price: { status: "not-measured", value: null },
    controls: diagnostic
      ? []
      : CONTROL_EPISODES.map((episode_id) => ({
          episode_id,
          arms: ["B1", "B2", "B3"],
        })),
    interpretation:
      "Repeated attempts are paired by episode; no stable advantage or non-inferiority claim from a pilot.",
  };
}
export async function evaluateEngineeringGate({
  root = import.meta.dirname,
  repoRoot = resolve(root, "../../.."),
  evidencePath = resolve(root, "model-evidence.json"),
} = {}) {
  const base = {
    version: POLICY_VERSION,
    status: "pending",
    reason: "Fresh paired real-model engineering evidence is not recorded.",
    release_ready: false,
    required_core: CORE_EPISODES,
    required_repetitions: 3,
  };
  let manifest;
  try {
    manifest = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return base;
    return {
      ...base,
      status: "blocked",
      reason: "Invalid model evidence manifest",
    };
  }
  try {
    if (
      manifest.schema !== "engineering-model-evidence/1" ||
      !Array.isArray(manifest.attempts)
    )
      throw new Error("Invalid evidence schema");
    const policy = await policyDigest(root),
      subject = await distribution(resolve(repoRoot, "skills/self-evolution")),
      catalog = await loadEpisodes();
    if (
      manifest.policy_sha256 !== policy.sha256 ||
      manifest.subject_sha256 !== subject.sha256
    )
      throw new Error(
        "Evidence subject/policy is not comparable to current candidate",
      );
    const required = [];
    for (const id of catalog.episodes.map((e) => e.id))
      required.push(`${id}:B5:1`);
    for (let n = 1; n <= 3; n++)
      for (const id of CORE_EPISODES)
        for (const arm of ["B0", "B4", "B5"])
          required.push(`${id}:${arm}:${n}`);
    for (const id of CONTROL_EPISODES)
      for (const arm of ["B1", "B2", "B3"]) required.push(`${id}:${arm}:1`);
    const records = new Map();
    const baseline = JSON.parse(
      await readFile(resolve(root, "baseline/manifest.json"), "utf8"),
    );
    for (const ref of manifest.attempts) {
      const path = safe(root, ref.path);
      await noLinks(root, ref.path);
      if (digest(await readFile(resolve(path, "manifest.json"))) !== ref.sha256)
        throw new Error("Attempt manifest digest mismatch");
      const record = await deriveAttempt(path);
      if (
        !["pass", "fail"].includes(record.status) ||
        !record.execution_complete
      )
        throw new Error("Required arm lacks completed engineering execution");
      if (
        record.evidence_class !== "real-harness-engineering" ||
        record.binding.isolation !== "verified"
      )
        throw new Error(
          "Fake/diagnostic run cannot satisfy engineering release gate",
        );
      const episode = catalog.episodes.find((e) => e.id === record.episode_id);
      if (
        !episode ||
        record.binding.episode_sha256 !== digest(stableJson(episode))
      )
        throw new Error("Episode contract drift");
      const key = `${record.episode_id}:${record.arm}:${record.binding.attempt}`;
      if (records.has(key)) throw new Error("Duplicate attempt tuple");
      if (
        record.arm === "B5" &&
        record.binding.subject_sha256 !== subject.sha256
      )
        throw new Error("Candidate subject mismatch");
      if (
        record.arm === "B4" &&
        record.binding.subject_sha256 !== baseline.subject_sha256
      )
        throw new Error("Baseline subject mismatch");
      if (
        !record.binding.model ||
        record.binding.model === "not-measured" ||
        !record.binding.toolchain_sha256
      )
        throw new Error("Model/toolchain identity unavailable");
      if (record.binding.policy_sha256 !== policy.sha256)
        throw new Error("Attempt policy mismatch");
      records.set(key, record);
    }
    if (required.some((key) => !records.has(key)))
      return {
        ...base,
        status: "pending",
        reason: "Required B0/B4/B5 paired tuple coverage is incomplete.",
      };
    const baselineIdentities = new Set(
      [...records.values()]
        .filter((r) => r.arm === "B4")
        .map((r) => r.binding.subject_sha256),
    );
    if (baselineIdentities.size !== 1)
      throw new Error("Baseline identity inconsistent across attempts");
    if (
      [...records.values()]
        .filter((r) => r.arm === "B5")
        .some((r) => r.status !== "pass")
    )
      return {
        ...base,
        status: "fail",
        reason: "A required engineering or safety outcome failed.",
      };
    const identities = new Set(
      [...records.values()].map(
        (r) =>
          `${r.binding.model}:${r.binding.harness}:${r.binding.toolchain_sha256}:${stableJson(r.binding.budget)}`,
      ),
    );
    if (identities.size !== 1)
      throw new Error("Paired model/harness/toolchain/budget mismatch");
    for (const id of CORE_EPISODES) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const b4 = records.get(`${id}:B4:${attempt}`),
          b5 = records.get(`${id}:B5:${attempt}`);
        if (b4.binding.experiment !== b5.binding.experiment)
          throw new Error("Pair experiment mismatch");
      }
    }
    const reviewPath = safe(root, manifest.blind_review?.path);
    await noLinks(root, manifest.blind_review.path);
    const reviewBytes = await readFile(reviewPath);
    if (digest(reviewBytes) !== manifest.blind_review.sha256)
      throw new Error("Blind review digest mismatch");
    const review = JSON.parse(reviewBytes);
    if (
      review.schema !== "engineering-blind-review/1" ||
      !Array.isArray(review.items) ||
      !review.reviewer_id
    )
      throw new Error("Invalid independent review");
    const reviewed = new Set();
    for (const item of review.items) {
      if (
        !records.has(item.tuple) ||
        reviewed.has(item.tuple) ||
        !["pass", "fail"].includes(item.verdict) ||
        typeof item.rationale !== "string" ||
        !item.rationale.trim()
      )
        throw new Error("Blind review coverage invalid");
      if (item.tuple.includes(":B5:") && item.verdict !== "pass")
        return {
          ...base,
          status: "fail",
          reason: "Independent review rejected candidate engineering behavior.",
        };
      reviewed.add(item.tuple);
    }
    if (required.some((k) => !reviewed.has(k)))
      return {
        ...base,
        status: "pending",
        reason: "Independent review does not cover every required tuple.",
      };
    return {
      ...base,
      status: "pass",
      release_ready: true,
      reason:
        "Fresh paired engineering outcomes, controls, raw evidence and independent review satisfy continuity/1. Identity and blinding remain maintainer-attested.",
    };
  } catch (e) {
    return {
      ...base,
      status: /comparable|drift/.test(e.message) ? "not-comparable" : "blocked",
      reason: e.message,
    };
  }
}
