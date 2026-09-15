import { prepareArm } from "../arms.mjs";
import { distribution } from "../subject.mjs";
import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lstat } from "node:fs/promises";
const [arm, attemptRoot, repoRoot] = process.argv.slice(2);
const projectPath = resolve(attemptRoot, "project");
for (const entry of [projectPath, resolve(projectPath, "AGENTS.md")]) {
  try {
    if ((await lstat(entry)).isSymbolicLink())
      throw new Error(`symlink rejected: ${entry}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const record = await prepareArm({
  arm,
  workspace: resolve(attemptRoot, "arm"),
  project: projectPath,
  repoRoot,
  experiment: "end-to-end",
  harness: "codex",
});
if (arm === "B2") {
  const path = resolve(attemptRoot, "project/AGENTS.md");
  let before = "";
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(
    path,
    before +
      "\nUse ENGINEERING-HISTORY.md for durable project facts when useful. Preserve only verified information that changes future engineering work; skip a note when the source/tests already express it.\n",
  );
}
const { project, home, cache, ...publicRecord } = record;
publicRecord.subject_files = ["B4", "B5"].includes(arm)
  ? (await distribution(resolve(attemptRoot, "arm/subject/skill"))).files
  : {};
await writeFile(
  resolve(attemptRoot, "arm-result.json"),
  JSON.stringify(publicRecord, null, 2) + "\n",
);
