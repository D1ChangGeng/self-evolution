# Remote engineering work packet

The user authorizes Codex on 1302-1 to serve as the engineer, collaboration
execution environment and test environment for this upgrade. This packet is a
bounded delegation under the full user-supplied goal document (transferred
outside the repository). Read that goal and the repository AGENTS.md first.

## Work ownership

Implement the maintainer engineering evaluation system (SE-01, SE-05, SE-07,
evaluation side of SE-04 and SE-08). Own `maintainer/evals/engineering/**`, changes
to `maintainer/evals/run.mjs`, `SPEC.md`, public benchmark policy and evidence
loader needed for the new versioned engineering profile, `maintainer/evals/fixtures/**`,
package scripts/CI additions for offline engineering tests, and corresponding
maintainer docs. The coordinator owns `tools/kb/**`, skill distribution,
public smoke fixes, public workspace snapshot helpers and public documentation.
Do not modify these coordinator-owned files; report needed changes instead.

The existing engineering `episodes.json` is only a descriptive draft, despite
its premature status label. Replace it with 24 complete executable episode
contracts and real protected behavioral/architecture/permission/scope verifiers.
Reuse current fixture `setup`, `verifier`, `action_rubric`, stable hashes and
materialization semantics; add session metadata alongside them, not a second
synonymous fixture language. A/B variants must have substantive different
acceptance. C01/C04/C06/C07/C10 need A to execute, close/interrupt, transfer actual
state, then B as a new process; C06 needs three sessions. At least two L3 chains.

Implement six arms with real preparation/isolation paths; B3 unsupported host
mechanisms must be unavailable. B4 frozen original tree is `.cache/engineering-current/skill`
with its manifest. B5 uses current `skills/self-evolution`, later coordinator
updates will require rebinding/rerunning. Implement real subprocess orchestration,
bounded timeouts, stop/transfer/error handling, immutable attempt artifacts,
actual binary version/hash, metrics derivation and tamper checks. Fake CLI tests
prove orchestration only, never real model performance. Exact success requires
actual code patch plus function/regression/architecture/permission/scope checks.

Target L2 existing external real repository adapter and curate 8–12 related
public history task pairs with verified commit/time/patch/license provenance.
Network read-only research is authorized; do not invent unavailable pairs.
Use historical evidence as historical and avoid leaking oracle/hidden tests.

Before changing final evaluation policy, write the version, change rationale,
requirements and activation boundary to engineering/POLICY.md. Preserve L0,
migration rollback, default adapter and three-file gates. Require fresh subject,
protocol and fixture bound engineering evidence, keep missing results pending
or blocked, and retain historical reports before regenerating current results.
LongMemEval remains diagnostic with explicit policy treatment. Do not claim a
new engineering release ready from old read-only explicit smoke evidence.

## Current state and validation

Baseline commit `7b608e32412a50a8dcab7f37a89fce4c1ef86548`, branch main. Snapshot
contains coordinator in-progress changes, not a new clean commit. Original
bundle `96ad0fde0c34535f29115199f24440e16fa74506dea47c120e3df37bb9b84daf`.
Baseline CLI tests: 44 pass. Current coordinator tests: 52 pass before four new
real-process concurrency tests, all four also pass on Windows. External suite:
122 pass/5 skipped. Fixture/evidence contract tests: 45 pass. Eval --verify
correctly reports current recorded results stale after product modifications.
Do not simply rewrite subject hashes on historical evidence to make it pass.

## Delivery and boundaries

Use this isolated remote checkout; preserve user/global configuration and other
repositories. Do not push, publish, alter LICENSE, or start batch paid model
campaigns. Remote Codex engineering is authorized; model benchmark budget and
endpoint choices need the coordinator's predeclared plan. Inspect available
Codex/Claude/OpenCode version/help and report actual capabilities for the
coordinator. No secrets in logs, source or public artifacts.

Commit only your owned files locally with explicit allowlist when finished, and
report commit, files, commands with exit results, evidence limitations and any
remaining gaps. Return a Git bundle or patch for the coordinator to review and
import; messages do not synchronize engineering files. Continue implementing
all offline scope rather than stopping after the first sample or planning pass.
