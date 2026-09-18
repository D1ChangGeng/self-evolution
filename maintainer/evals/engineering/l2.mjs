import { readFile, mkdir, cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stableJson } from "../contract.mjs";
import { normalizeTaskSpec, loadTaskSpecs } from "../external/lib/core.mjs";
import { safe, digest } from "./workspace.mjs";

export async function loadPairs(
  path = resolve(import.meta.dirname, "l2-pairs.json"),
) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (
    value.schema !== "engineering-l2-pairs/2" ||
    value.pairs.length < 8 ||
    value.pairs.length > 12
  )
    throw new Error("L2 requires 8-12 selected historical pairs");
  const seen = new Set();
  for (const pair of value.pairs) {
    if (seen.has(pair.id)) throw new Error("Duplicate L2 pair");
    seen.add(pair.id);
    if (!["MIT", "BSD-3-Clause"].includes(pair.license.spdx))
      throw new Error("L2 license requires review");
    for (const task of [pair.experience, pair.followup]) {
      for (const key of ["base_commit", "fix_commit"])
        if (!/^[a-f0-9]{40}$/.test(task[key]))
          throw new Error("Invalid real task commit");
      if (
        !task.changed_files.length ||
        !/^https:\/\/github.com\//.test(task.url)
      )
        throw new Error("Missing task provenance");
    }
    if (
      pair.experience.fix_commit === pair.followup.fix_commit ||
      !["ahead", "identical"].includes(pair.ancestry.status) ||
      pair.ancestry.behind_by !== 0 ||
      pair.ancestry.merge_base_commit !== pair.experience.fix_commit
    )
      throw new Error("Not a distinct ancestral task pair");
    if (Date.parse(pair.experience.date) > Date.parse(pair.followup.date))
      throw new Error("Temporal leak in L2 pair");
  }
  return value;
}

/** Bind curated histories to the existing external harness rather than a new
 * task executor. Only already materialized and verified task adapters export. */
export async function integrationPlan(
  pairsPath,
  taskRoot = resolve(import.meta.dirname, "../external/tasks"),
) {
  const manifest = await loadPairs(pairsPath),
    tasks = await loadTaskSpecs(taskRoot);
  return manifest.pairs.map((pair) => ({
    id: pair.id,
    repository: pair.repository,
    stages: ["experience", "followup"].map((stage) => {
      const history = pair[stage];
      const adapter = tasks.find(
        (t) =>
          t.repository.url === pair.repository &&
          t.repository.oracle_sha === history.fix_commit &&
          t.repository.base_sha === history.base_commit,
      );
      return {
        stage,
        base_commit: history.base_commit,
        fix_commit: history.fix_commit,
        adapter_id: adapter?.id ?? null,
        status: adapter ? "adapter-available" : "curated-needs-task-adapter",
        reason: adapter
          ? "Existing materialization, base-fail/oracle-pass and protected regression adapter."
          : "Commit provenance selected; turn its upstream regression into a task adapter before execution.",
      };
    }),
    transfer:
      "Forward only allowed durable experience. Materialize followup at its own exact base; never stack cumulative patches on unrelated Git states.",
  }));
}

export async function exportExistingAdapter({
  pairId,
  stage,
  output,
  taskRoot,
}) {
  const plan = await integrationPlan(undefined, taskRoot);
  const entry = plan
    .find((p) => p.id === pairId)
    ?.stages.find((s) => s.stage === stage);
  if (!entry?.adapter_id)
    throw new Error(
      "Selected task has provenance but no validated external task adapter",
    );
  const root = taskRoot ?? resolve(import.meta.dirname, "../external/tasks");
  const source = safe(root, entry.adapter_id);
  const task = normalizeTaskSpec(
    JSON.parse(await readFile(resolve(source, "task.json"), "utf8")),
    entry.adapter_id,
  );
  await mkdir(output, { recursive: false });
  await cp(source, resolve(output, task.id), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await writeFile(
    resolve(output, "binding.json"),
    stableJson({
      schema: "engineering-l2-adapter/1",
      pair_id: pairId,
      stage,
      task_id: task.id,
      base_commit: entry.base_commit,
      fix_commit: entry.fix_commit,
      task_sha256: digest(stableJson(task)),
      execution: "not-tested-in-this-upgrade",
    }),
  );
  return task;
}

if (process.argv[2] === "plan")
  console.log(stableJson(await integrationPlan()));
if (process.argv[2] === "export") {
  await exportExistingAdapter({
    pairId: process.argv[3],
    stage: process.argv[4],
    output: resolve(process.argv[5]),
  });
}
