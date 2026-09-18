import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { stableJson } from "../contract.mjs";
import { distribution, restoreFrozen } from "./subject.mjs";
import { materialize } from "./workspace.mjs";
const exec = promisify(execFile);

export const ARMS = Object.freeze({
  B0: { name: "no-memory", history: "none" },
  B1: { name: "minimal-instructions", history: "minimal" },
  B2: { name: "plain-markdown", history: "equal-information" },
  B3: { name: "harness-native", history: "native" },
  B4: { name: "self-evolution-current", history: "self-evolution" },
  B5: { name: "self-evolution-candidate", history: "self-evolution" },
});
const routing =
  "\n## Task knowledge\nUse .agents/knowledge/index.yaml to choose the smallest relevant active Guide or accepted Decision. Verify material claims against source and tests; preserve adopted intent. Capture only future-action value.\n";

export async function prepareArm({
  arm,
  workspace,
  repoRoot,
  history = [],
  experiment = "equal-information",
  native,
  harness = "codex",
  project,
}) {
  if (!Object.hasOwn(ARMS, arm)) throw new Error(`Unknown arm ${arm}`);
  await mkdir(workspace, { recursive: false });
  project ??= resolve(workspace, "project");
  await mkdir(project, { recursive: true });
  for (const name of ["host-home", "host-cache", "subject"])
    await mkdir(resolve(workspace, name));
  let capability = "available",
    subject = null,
    reference = null;
  const offered = experiment === "equal-information" ? history : [];
  if (arm === "B1") {
    let agents = "";
    try {
      agents = await readFile(resolve(project, "AGENTS.md"), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await writeFile(
      resolve(project, "AGENTS.md"),
      agents +
        "\nRead project instructions and current source/tests; preserve architecture and unrelated work, then validate the requested change.\n",
    );
  }
  if (arm === "B2" && offered.length) {
    await writeFile(
      resolve(project, "ENGINEERING-HISTORY.md"),
      offered.map((f) => `# ${f.path}\n\n${f.content}`).join("\n\n"),
    );
    reference = "ENGINEERING-HISTORY.md";
    let agents = "";
    try {
      agents = await readFile(resolve(project, "AGENTS.md"), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await writeFile(
      resolve(project, "AGENTS.md"),
      agents +
        "\nConsult ENGINEERING-HISTORY.md when its topic matches the task; verify important claims against current sources.\n",
    );
  }
  if (arm === "B3") {
    if (
      !native?.prepare ||
      !native?.capability_evidence?.version ||
      !native?.capability_evidence?.mechanism
    )
      capability = "unavailable";
    else
      await native.prepare({
        project,
        history: offered,
        home: resolve(workspace, "host-home"),
      });
  }
  if (["B4", "B5"].includes(arm)) {
    let source =
      arm === "B4"
        ? resolve(repoRoot, ".cache/engineering-current/skill")
        : resolve(repoRoot, "skills/self-evolution");
    let frozen;
    if (arm === "B4") {
      try {
        frozen = JSON.parse(
          await readFile(
            resolve(repoRoot, ".cache/engineering-current/manifest.json"),
            "utf8",
          ),
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        source = await restoreFrozen(
          import.meta.dirname,
          resolve(workspace, "frozen-baseline"),
        );
        frozen = JSON.parse(
          await readFile(
            resolve(workspace, "frozen-baseline/manifest.json"),
            "utf8",
          ),
        );
      }
    }
    const before = await distribution(source);
    if (arm === "B4") {
      if (frozen.sha256 !== before.sha256)
        throw new Error(
          "B4 frozen subject mismatch; never refreeze from candidate",
        );
    }
    const destination = resolve(workspace, "subject/skill");
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    subject = await distribution(destination);
    if (subject.sha256 !== before.sha256)
      throw new Error("Subject changed while copying");
    const skillRoot =
      harness === "codex"
        ? resolve(workspace, "host-home/skills/self-evolution")
        : resolve(
            project,
            harness === "claude-code"
              ? ".claude/skills/self-evolution"
              : ".opencode/skills/self-evolution",
          );
    await cp(destination, skillRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await materialize(project, offered);
    let agents = "";
    try {
      agents = await readFile(resolve(project, "AGENTS.md"), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await writeFile(resolve(project, "AGENTS.md"), agents + routing);
    await exec(
      process.execPath,
      [
        resolve(destination, "references/bin/kb.mjs"),
        "init",
        "--project-root",
        project,
      ],
      { windowsHide: true, timeout: 15000 },
    );
    await exec(
      process.execPath,
      [
        resolve(destination, "references/bin/kb.mjs"),
        "index",
        "--project-root",
        project,
      ],
      { windowsHide: true, timeout: 15000 },
    );
    reference = ".agents/knowledge/index.yaml";
  }
  if (harness === "claude-code") {
    // Existing native rules remain canonical; append an owned bridge if needed.
    let claude = "";
    try {
      claude = await readFile(resolve(project, "CLAUDE.md"), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (!claude.includes("@AGENTS.md"))
      await writeFile(resolve(project, "CLAUDE.md"), claude + "\n@AGENTS.md\n");
  }
  const manifest = {
    schema: "engineering-arm/2",
    arm,
    name: ARMS[arm].name,
    capability,
    subject_sha256: subject?.sha256 ?? null,
    experiment,
    history_files_offered:
      arm === "B0" || arm === "B1" ? [] : offered.map((f) => f.path),
    reference,
    isolation: {
      project: "per-attempt",
      host_home: "per-session",
      host_cache: "per-session",
      sandbox: "requires-harness-probe",
      memory: "real CLI support must be verified before model use",
    },
  };
  await writeFile(resolve(workspace, "arm.json"), stableJson(manifest));
  return {
    ...manifest,
    project,
    home: resolve(workspace, "host-home"),
    cache: resolve(workspace, "host-cache"),
  };
}
