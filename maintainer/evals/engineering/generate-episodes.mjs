import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "prettier";
import { fixtureContractDigest, stableJson } from "../contract.mjs";
import { ENGINEERING_SCHEMA, POLICY_VERSION, sha256 } from "./contracts.mjs";
import { scenarioFor, SCENARIOS } from "./scenarios.mjs";

const root = resolve(import.meta.dirname, "..");
const dirs = [
  "07-context-recovery",
  "02-decision-constrained-feature",
  "03-migration-runbook",
  "01-cross-module-defect",
  "05-docs-reality-conflict",
  "06-source-changing-refactor",
  "07-context-recovery",
  "08-uncovered-scope",
  "09-wrong-knowledge",
  "12-no-capture",
  "11-optional-adapters",
  "10-brownfield-onboarding",
];
const classes = [
  "session-continuation",
  "architecture-constraint",
  "failed-attempt",
  "bug-recurrence",
  "design-evolution",
  "long-refactor",
  "cross-harness-handoff",
  "cold-warm",
  "wrong-untrusted-memory",
  "capture-choice",
  "branch-concurrency",
  "brownfield-onboarding",
];
const episodes = [];
for (let i = 0; i < dirs.length; i++) {
  const dir = dirs[i],
    fr = resolve(root, "fixtures", dir),
    fixture = JSON.parse(await readFile(resolve(fr, "fixture.json"), "utf8")),
    readme = await readFile(resolve(fr, "README.md"), "utf8");
  for (const variant of ["A", "B"]) {
    const id = `C${String(i + 1).padStart(2, "0")}-${variant}`,
      s = scenarioFor(id);
    const episode = {
      id,
      class: classes[i],
      variant,
      level: [5, 6].includes(i) ? "L1+L3" : "L1",
      fixture: {
        id: fixture.id,
        directory: dir,
        contract_sha256: fixtureContractDigest(dir, fixture, readme),
      },
      task: s.sessions.at(-1).objective,
      setup: s.setup,
      verifier: {
        kind: "node-test",
        entry: "initial-check.mjs",
        expected_initial_status: s.checks.initial.expected,
      },
      action_rubric: fixture.action_rubric,
      sessions: s.sessions.map((session, index) => ({
        id: index + 1,
        actor: `process-${index + 1}`,
        must_leave: ["workspace patch", "session receipt"],
        ...session,
        offline_patch: session.offline_patch ?? [],
      })),
      transfer: {
        required: s.sessions.length > 1,
        allowed: ["continuation.md", "workspace.patch", "session-receipt.json"],
        reject: [
          "chat-history",
          "hidden-tests",
          "verifier-contract",
          "other-arm-state",
        ],
        mismatch_probe:
          id === "C01-B" ? "required-reject-then-revalidate" : "none",
      },
      protected_verifiers: [
        {
          outcome: "function",
          kind: "scenario-script",
          expected: s.checks.function.script,
        },
        {
          outcome: "regression",
          kind: "scenario-script",
          expected: s.checks.regression.script,
        },
        {
          outcome: "architecture",
          kind: "scenario-script",
          expected: s.checks.architecture.script,
        },
        {
          outcome: "permission",
          kind: "changed-path-allowlist",
          expected: s.writable_paths,
        },
        { outcome: "scope", kind: "capture-policy", expected: s.capture },
      ],
      collection: {
        raw: [
          "prompt",
          "session-events",
          "stdout",
          "stderr",
          "before-tree",
          "after-tree",
          "patch",
          "test-receipt",
          "handoff",
        ],
        derived: [
          "outcomes",
          "duration-ms",
          "tool-calls",
          "token-usage",
          "knowledge-bytes",
          "attempt-cost",
        ],
        evidence_status: "fixture-synthetic",
        provenance:
          s.sessions.length > 1
            ? "real-subprocess-session-boundary"
            : "injected-fixture-context",
      },
      scenario: s,
    };
    episode.contract_sha256 = sha256(stableJson(episode));
    episodes.push(episode);
  }
}
await writeFile(
  resolve(import.meta.dirname, "episodes.json"),
  await format(
    stableJson({
      schema: ENGINEERING_SCHEMA,
      policy_version: POLICY_VERSION,
      status: "offline-executable-catalog-results-pending",
      episodes,
      campaign: {
        fixture_runs: "required-offline",
        model_runs: "pending-authorization",
      },
    }),
    { parser: "json" },
  ),
);
