import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { distribution, digest } from "../subject.mjs";
import { stableJson } from "../../contract.mjs";

export async function evaluatePublicEngineeringEvidence({
  root = import.meta.dirname,
  repoRoot = resolve(root, "../../../../"),
  evidencePath = resolve(root, "evidence.json"),
} = {}) {
  const base = {
    status: "pending",
    release_ready: false,
    effect_status: "not-measured",
    reason: "Bounded public engineering evidence is not recorded.",
  };
  let evidence;
  try {
    evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    return error.code === "ENOENT"
      ? base
      : {
          ...base,
          status: "blocked",
          reason: "Invalid public engineering evidence JSON.",
        };
  }
  try {
    if (evidence.schema !== "public-engineering-evidence/2")
      throw new Error("Public engineering evidence schema mismatch");
    if (
      evidence.dataset?.name !== "SWE-bench Verified" ||
      evidence.dataset?.revision !== "c104f840cc67f8b6eec6f759ebc8b2693d585d4a"
    )
      throw new Error("Frozen public dataset identity mismatch");
    if (
      evidence.evaluator?.commit !== "726c5461e2ef52d83cf1ea2107870a8bb3328d57"
    )
      throw new Error("Pinned official evaluator mismatch");
    if (
      evidence.execution?.model !== "gpt-5.6-terra" ||
      evidence.execution?.provider !== "zeo-dev" ||
      evidence.execution?.harness !== "Codex"
    )
      throw new Error("Model/provider/harness identity mismatch");
    const scope = evidence.scope;
    if (
      !scope ||
      scope.repetitions !== 1 ||
      scope.triplets < 1 ||
      JSON.stringify(scope.arms) !== JSON.stringify(["B0", "B4", "B5"])
    )
      throw new Error("Declared public evidence scope is incomplete");
    const records = evidence.records;
    if (!Array.isArray(records) || records.length !== scope.triplets * 3)
      throw new Error("Public evidence record coverage mismatch");
    const candidate = await distribution(
      resolve(repoRoot, "skills/self-evolution"),
    );
    const candidateKeys = new Set();
    const taskGroups = new Map();
    for (const record of records) {
      if (
        record.model !== "gpt-5.6-terra" ||
        record.provider !== "zeo-dev" ||
        record.codex_version !== "0.152.1" ||
        record.session_count !== 2 ||
        record.patch_bytes <= 0
      )
        throw new Error("Record lacks complete real-model evidence");
      if (!record.task || !["B0", "B4", "B5"].includes(record.arm))
        throw new Error("Record task/arm identity invalid");
      if (record.arm === "B5" && record.subject_sha256 !== candidate.sha256)
        throw new Error("Candidate subject digest mismatch");
      const key = `${record.task}:${record.arm}:${record.attempt}`;
      if (candidateKeys.has(key))
        throw new Error("Duplicate public evidence tuple");
      candidateKeys.add(key);
      const group = taskGroups.get(record.task) ?? new Set();
      group.add(record.arm);
      taskGroups.set(record.task, group);
    }
    for (const [task, arms] of taskGroups)
      if (arms.size !== 3)
        throw new Error(`Incomplete B0/B4/B5 triplet: ${task}`);
    if (
      !evidence.review ||
      evidence.review.schema !== "public-engineering-review/1"
    )
      throw new Error("Public engineering review is missing");
    const tuples = new Set(
      records.map((r) => `${r.task}:${r.arm}:${r.attempt}`),
    );
    const reviewed = evidence.review.items;
    if (
      !Array.isArray(reviewed) ||
      reviewed.length !== tuples.size ||
      reviewed.some(
        (item) =>
          !tuples.has(item.tuple) ||
          item.verdict !== "pass" ||
          typeof item.rationale !== "string" ||
          !item.rationale.trim(),
      )
    )
      throw new Error("Public engineering review coverage is incomplete");
    const resolved = records.filter((r) => r.resolved === true).length;
    return {
      status: "pass",
      release_ready: true,
      effect_status:
        resolved === records.length
          ? "all-declared-tasks-resolved"
          : "mixed-outcomes",
      reason:
        "Declared public engineering scope has complete hash-bound Codex, official regression, architecture-scope, permission-boundary and review evidence.",
      declared_tasks: [...taskGroups.keys()],
      records: records.length,
      resolved_records: resolved,
      evidence_sha256: digest(stableJson(evidence)),
    };
  } catch (error) {
    return { ...base, status: "blocked", reason: error.message };
  }
}
