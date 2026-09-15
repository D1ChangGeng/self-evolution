import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { stableJson } from "../contract.mjs";
import { loadEpisodes, POLICY_VERSION } from "./contracts.mjs";
import { prepareArm, ARMS } from "./arms.mjs";
import { launch } from "./process.mjs";
import {
  authorizeModelRun,
  modelCommand,
  prepareSessionHome,
  probeBinary,
  probeCommandHelp,
  isolatedEnv,
  usageFromTrace,
} from "./harness.mjs";
import {
  snapshot,
  changes,
  substantiveChanges,
  matches,
  materialize,
  initGit,
  patch,
  exportContinuation,
  receiveContinuation,
  digest,
} from "./workspace.mjs";
import { sealEvidence } from "./evidence.mjs";
import { policyDigest } from "./policy.mjs";
import { concurrentProbe } from "./probes.mjs";

const repoRoot = resolve(import.meta.dirname, "../../..");
export function assertInitialStatus(code, expected) {
  const actual = code === 0 ? "pass" : "fail";
  if (actual !== expected)
    throw new Error(
      `initial verifier status mismatch: expected ${expected}, received ${actual}`,
    );
  return true;
}
export function validateTransfer({
  expectedWorkspaceSha256,
  actualWorkspaceSha256,
  artifacts,
  allowed,
}) {
  if (expectedWorkspaceSha256 !== actualWorkspaceSha256)
    throw new Error("transfer repository/workspace digest mismatch");
  const invalid = artifacts.filter((artifact) => !allowed.includes(artifact));
  if (invalid.length)
    throw new Error(
      `transfer contains forbidden artifacts: ${invalid.join(", ")}`,
    );
  return true;
}
export function staleWriterCheck({ expectedDigest, currentDigest }) {
  if (expectedDigest !== currentDigest)
    throw new Error("stale writer conflict");
  return true;
}
export function assertInitialVerifier(expected, receipt) {
  if (
    (receipt.stop_reason !== "normal" &&
      receipt.stop_reason !== "process-failed") ||
    (receipt.exit_code === 0 ? "pass" : "fail") !== expected
  )
    throw new Error(`Initial verifier did not match declared ${expected}`);
}
export function validateCapture({ changedPaths, expectation, durable = [] }) {
  const knowledge = changedPaths.filter(
    (p) =>
      p === "ENGINEERING-HISTORY.md" ||
      p.startsWith(".agents/knowledge/") ||
      durable.includes(p),
  );
  if (["none", "forbidden"].includes(expectation) && knowledge.length)
    throw new Error("Unexpected durable knowledge capture");
  if (expectation === "required" && !knowledge.length)
    throw new Error("Required durable knowledge capture missing");
  return true;
}
async function check(script, project, evidence, name, timeoutMs) {
  const path = resolve(evidence, name + ".mjs");
  await writeFile(path, script);
  return launch({
    binary: process.execPath,
    args: [path],
    cwd: project,
    env: { ...isolatedEnv(evidence, evidence), PROJECT_ROOT: project },
    artifactRoot: resolve(evidence, name),
    timeoutMs,
  });
}
export async function executeEpisode({
  episodeId,
  arm = "B5",
  timeoutMs = 20000,
  outputRoot,
  experiment = "equal-information",
  modelConfig,
  episode: supplied,
  failSession,
  forceInterrupt = false,
  attemptNumber = 1,
} = {}) {
  const episode =
    supplied ?? (await loadEpisodes()).episodes.find((e) => e.id === episodeId);
  if (!episode?.scenario)
    throw new Error(
      "Episode needs an executable scenario catalog; descriptions are not runnable",
    );
  episodeId = episode.id;
  const scenario = episode.scenario;
  if (modelConfig) authorizeModelRun(modelConfig);
  for (const config of modelConfig?.subsequent_harnesses ?? [])
    authorizeModelRun(config);
  const attempt = outputRoot
    ? resolve(outputRoot)
    : await mkdtemp(resolve(tmpdir(), "engineering-attempt-"));
  if (outputRoot) await mkdir(attempt, { recursive: false });
  const evidence = resolve(attempt, "evidence"),
    initial = resolve(attempt, "initial"),
    projects = resolve(attempt, "projects");
  await mkdir(evidence);
  await mkdir(initial);
  await mkdir(projects);
  const started = performance.now();
  // Only public setup is visible. Hidden checks and fake solution patches stay
  // in evidence, outside project; real runs disclose external-boundary limits.
  await materialize(initial, episode.setup.files);
  const armState = await prepareArm({
    arm,
    workspace: resolve(attempt, "arm"),
    project: initial,
    repoRoot,
    history: scenario.history,
    experiment,
    harness: modelConfig?.name ?? "codex",
  });
  const binding = {
    schema: "engineering-run-binding/1",
    episode_id: episodeId,
    arm,
    policy: POLICY_VERSION,
    policy_sha256: (await policyDigest()).sha256,
    episode_sha256: digest(stableJson(episode)),
    subject_sha256: armState.subject_sha256,
    experiment,
    evidence_class: modelConfig
      ? "real-harness-diagnostic"
      : "fake-cli-orchestration",
    model: modelConfig?.model ?? "not-measured",
    harness: modelConfig?.name ?? "fake",
    attempt: attemptNumber,
    budget: modelConfig?.budget ?? {
      max_sessions: scenario.sessions.length,
      session_timeout_ms: timeoutMs,
    },
    isolation: modelConfig
      ? "diagnostic-boundary-not-certified"
      : "controlled-fake-processes",
  };
  await writeFile(resolve(evidence, "binding.json"), stableJson(binding));
  await writeFile(resolve(evidence, "episode.json"), stableJson(episode));
  await writeFile(resolve(evidence, "arm.json"), stableJson(armState));
  const receipts = [];
  let status = "fail",
    error = null,
    outcomes = {},
    packet = null,
    project;
  try {
    if (armState.capability !== "available")
      throw new Error("Arm capability unavailable");
    const initialCheck = await check(
      scenario.checks.initial.script,
      initial,
      evidence,
      "initial-check",
      timeoutMs,
    );
    assertInitialVerifier(scenario.checks.initial.expected, initialCheck);
    const base = await initGit(initial),
      startSnapshot = await snapshot(initial);
    await writeFile(
      resolve(evidence, "initial-check.json"),
      stableJson(initialCheck),
    );
    await writeFile(
      resolve(evidence, "initial-snapshot.json"),
      stableJson(startSnapshot),
    );
    const toolchain = await probeBinary(
      modelConfig?.binary ?? process.execPath,
      resolve(evidence, "toolchain"),
    );
    await writeFile(resolve(evidence, "toolchain.json"), stableJson(toolchain));
    if (modelConfig)
      await probeCommandHelp(modelConfig, resolve(evidence, "toolchain"));
    binding.toolchain_sha256 = digest(
      stableJson({ revision: toolchain.revision, sha256: toolchain.sha256 }),
    );
    await writeFile(resolve(evidence, "binding.json"), stableJson(binding));
    for (let i = 0; i < scenario.sessions.length; i++) {
      const session = scenario.sessions[i];
      const sessionConfig =
        i > 0
          ? (modelConfig?.subsequent_harnesses?.[i - 1] ?? modelConfig)
          : modelConfig;
      const home = resolve(attempt, `home-${i}`),
        cache = resolve(attempt, `cache-${i}`);
      project = resolve(projects, `session-${i + 1}`);
      if (
        packet &&
        i === 1 &&
        ["branch-mismatch-before-restore", "public-handoff-only"].includes(
          scenario.probe,
        )
      ) {
        let rejection;
        if (scenario.probe === "public-handoff-only")
          await writeFile(
            resolve(packet, "chat-history"),
            "Untrusted local sentinel, no private data.",
          );
        try {
          await receiveContinuation({
            initial,
            destination: resolve(projects, "rejected-receiver"),
            packet,
            repo: episodeId,
            expectedBase: base,
            expectedBranch:
              scenario.probe === "branch-mismatch-before-restore"
                ? "wrong-branch"
                : "engineering-task",
          });
        } catch (e) {
          rejection = e.message;
        }
        if (scenario.probe === "public-handoff-only") {
          const { rm } = await import("node:fs/promises");
          await rm(resolve(packet, "chat-history"));
        }
        if (!rejection)
          throw new Error("Required unsafe handoff was not rejected");
        await writeFile(
          resolve(evidence, "handoff-rejection.json"),
          stableJson({ probe: scenario.probe, rejection, preserved: true }),
        );
      }
      if (packet)
        await receiveContinuation({
          initial,
          destination: project,
          packet,
          repo: episodeId,
          expectedBase: base,
        });
      else {
        await mkdir(project);
        await cp(initial, project, { recursive: true, force: false });
      }
      if (
        modelConfig?.budget &&
        (i >= modelConfig.budget.max_sessions ||
          performance.now() - started > modelConfig.budget.total_timeout_ms)
      )
        throw new Error("Campaign budget exhausted before launch");
      const env = sessionConfig
        ? await prepareSessionHome(sessionConfig, home, cache)
        : isolatedEnv(home, cache);
      await mkdir(home, { recursive: true });
      await mkdir(cache, { recursive: true });
      if (
        ["B4", "B5"].includes(arm) &&
        (!sessionConfig || sessionConfig.name === "codex")
      )
        await cp(
          resolve(attempt, "arm/subject/skill"),
          resolve(home, "skills/self-evolution"),
          { recursive: true },
        );
      if (
        sessionConfig &&
        sessionConfig.name !== "codex" &&
        ["B4", "B5"].includes(arm)
      ) {
        const skillDir = resolve(
          project,
          sessionConfig.name === "claude-code"
            ? ".claude/skills/self-evolution"
            : ".opencode/skills/self-evolution",
        );
        await cp(resolve(attempt, "arm/subject/skill"), skillDir, {
          recursive: true,
        });
      }
      const prompt = session.objective;
      await writeFile(resolve(evidence, `prompt-${i}.txt`), prompt);
      let command;
      const hanging = forceInterrupt || session.boundary === "forced-interrupt";
      if (sessionConfig)
        command = modelCommand({
          ...sessionConfig,
          prompt,
          output: resolve(evidence, `final-${i}.txt`),
        });
      else {
        const requestPath = resolve(evidence, `fake-request-${i}.json`);
        await writeFile(
          requestPath,
          stableJson({
            patch: session.offline_patch,
            fail: failSession === i + 1,
            hang: hanging,
          }),
        );
        command = {
          binary: process.execPath,
          args: [
            resolve(import.meta.dirname, "fake-cli.mjs"),
            "--request",
            requestPath,
          ],
          input: "",
        };
      }
      const before = await snapshot(project),
        sessionRoot = resolve(evidence, `session-${i + 1}`);
      const receipt = await launch({
        ...command,
        cwd: project,
        env,
        timeoutMs: modelConfig?.budget.session_timeout_ms ?? timeoutMs,
        interruptAfterMs: hanging ? 1000 : undefined,
        artifactRoot: sessionRoot,
      });
      const after = await snapshot(project),
        diff = changes(before, after);
      const usage = usageFromTrace(
        await readFile(resolve(sessionRoot, "stdout.txt"), "utf8"),
        sessionConfig?.name ?? "fake",
      );
      const full = {
        ...receipt,
        harness: sessionConfig?.name ?? "fake",
        model: sessionConfig?.model ?? "not-measured",
        session: i + 1,
        boundary_requested: session.boundary,
        boundary_observed: receipt.stop_reason,
        usage,
        before,
        after,
        diff,
      };
      receipts.push(full);
      await writeFile(
        resolve(evidence, `session-${i + 1}.json`),
        stableJson(full),
      );
      if (
        receipt.exit_code !== 0 &&
        !(hanging && receipt.stop_reason === "forced-interruption")
      )
        throw new Error(`Session ${i + 1} ${receipt.stop_reason}`);
      if (i < scenario.sessions.length - 1) {
        packet = resolve(evidence, `transfer-${i + 1}`);
        await exportContinuation({
          project,
          destination: packet,
          repo: episodeId,
          base,
          objective: scenario.sessions[i + 1].objective,
          next: scenario.sessions[i + 1].objective,
          verified: [
            {
              claim:
                "Previous session process ended; workspace snapshot recorded",
              evidence: `session-${i + 1}.json at ${after.sha256}`,
            },
          ],
          refs: scenario.durable_paths,
        });
      }
    }
    const end = await snapshot(project),
      diff = substantiveChanges(changes(startSnapshot, end));
    const checks = {};
    for (const name of ["function", "regression", "architecture"])
      checks[name] = await check(
        scenario.checks[name].script,
        project,
        evidence,
        `final-${name}`,
        timeoutMs,
      );
    outcomes = Object.fromEntries(
      Object.entries(checks).map(([name, r]) => [
        name,
        r.exit_code === 0 && r.stop_reason === "normal",
      ]),
    );
    const extra = arm === "B2" ? ["ENGINEERING-HISTORY.md"] : [];
    outcomes.permission = diff.every(
      (d) =>
        matches(d.path, [...scenario.writable_paths, ...extra]) &&
        ![d.before?.type, d.after?.type].includes("symlink") &&
        ![d.before?.type, d.after?.type].includes("special"),
    );
    try {
      validateCapture({
        changedPaths: diff.map((d) => d.path),
        expectation: scenario.capture,
        durable: scenario.durable_paths,
      });
      outcomes.scope = true;
    } catch {
      outcomes.scope = false;
    }
    outcomes.patch = diff.some(
      (d) => !d.path.startsWith(".agents/") && /\.(m?js|ts|json)$/.test(d.path),
    );
    if (["cas-conflict", "worktree-isolation"].includes(scenario.probe)) {
      const probe = await concurrentProbe({
        root: resolve(evidence, "concurrency-probe"),
        isolated: scenario.probe === "worktree-isolation",
        cli: resolve(repoRoot, "skills/self-evolution/references/bin/kb.mjs"),
      });
      await writeFile(
        resolve(evidence, "concurrency-probe.json"),
        stableJson(probe),
      );
      outcomes.concurrency = probe.status === "pass";
    }
    await writeFile(resolve(evidence, "final-checks.json"), stableJson(checks));
    await writeFile(resolve(evidence, "final-snapshot.json"), stableJson(end));
    await writeFile(resolve(evidence, "workspace-diff.json"), stableJson(diff));
    await writeFile(resolve(evidence, "workspace.patch"), await patch(project));
    status = Object.values(outcomes).every(Boolean) ? "pass" : "fail";
  } catch (e) {
    error = e.message;
    status = /unavailable|budget|isolation|capability/i.test(error)
      ? "blocked"
      : "fail";
  }
  if (modelConfig && status === "pass") status = "pending";
  const result = {
    schema: "engineering-attempt/3",
    status,
    evidence_status: modelConfig
      ? "real-harness-diagnostic"
      : "fixture-synthetic",
    evidence_class: binding.evidence_class,
    episode_id: episodeId,
    arm,
    error,
    outcomes,
    session_count: receipts.length,
    elapsed_ms: Math.round(performance.now() - started),
    attempt_root: attempt,
    binding,
  };
  await writeFile(resolve(evidence, "result.json"), stableJson(result));
  await sealEvidence(evidence, binding);
  return result;
}
export async function prepareAllArms(root, opts = {}) {
  await mkdir(root, { recursive: true });
  const result = {};
  for (const arm of Object.keys(ARMS))
    result[arm] = await prepareArm({
      arm,
      workspace: resolve(root, arm),
      repoRoot,
      ...opts,
    });
  return result;
}
if (process.argv[2] === "run") {
  const result = await executeEpisode({
    episodeId: process.argv[3],
    arm: process.argv[4] ?? "B5",
    outputRoot: process.argv[5],
  });
  console.log(stableJson(result));
  process.exitCode = result.status === "pass" ? 0 : 1;
}
