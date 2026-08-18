# v2 Evaluation Specification

## Task Matrix

The release suite covers:

1. cross-module defect repair;
2. feature work constrained by an architecture decision;
3. a deployment or data-migration runbook;
4. tests passing while business behavior is wrong;
5. documentation conflicting with current reality;
6. a large refactor that changes declared sources;
7. cross-session context recovery;
8. work in a scope with no knowledge document;
9. injected wrong knowledge;
10. onboarding a documentation-rich brownfield project;
11. optional `adapter install <tool>`, `status [tool]`, and `remove <tool>` behavior;
12. a routine task that should produce no Capture.
13. a reviewed v1-to-v2 migration corpus with duplicate knowledge and
    user-owned rules or Hooks.

## Recorded Measures

- Retrieval: relevant-document success, irrelevant context, time to correct
  document, AGENTS routing hit, and false scope matches.
- Correctness: action based on wrong knowledge, detected source change,
  conflict detection, authority mistakes, and material-claim verification.
- Capture: later use, changed future action, low-value or duplicate content,
  knowledge better expressed in code/tests, and capture cost.
- Task outcome: correctness, design, tests, constraint compliance, risk
  discovery, and blinded final-delivery quality.
- Maintenance: default files, initialization time and tokens, metadata writes,
  files touched per Maintain, and adapter/maintainer overhead.

## v2.0.0 Gates

Relative to the frozen v1 baseline:

- distributed `SKILL.md` is at most 450 lines;
- initialized file count falls by at least 50 percent;
- initialization protocol tokens fall by at least 40 percent;
- metadata writes fall by at least 60 percent;
- low-value Capture falls by at least 50 percent;
- irrelevant context median falls by at least 25 percent;
- relevant retrieval and blinded task quality do not regress;
- every no-Capture integrated task remains write-free;
- source changes are detected deterministically in every run;
- wrong knowledge is detected and not acted upon in every integrated model run;
- every high-risk task verifies material claims against current evidence;
- migration accounts for every supported input category and rollback restores
  identical hashes;
- applied-state semantic preservation remains a separate reviewed corpus gate;
- CLI commands and adapters are idempotent;
- zero adapters or hooks are enabled by default;
- no confidence, health-score, promotion-counter, or default v1/v2 copy
  mechanism remains.

A threshold may change only through an evidence-backed proposal approved before
release. An implementer may not relax a gate because a result is inconvenient.

## Result Rule

A failed deterministic safety gate blocks release. A task-quality regression
requires investigation and an explicit maintainer decision; structural savings
cannot offset worse engineering outcomes.

## Executable Result States

The runner records each gate as one of:

- `pass`: current evidence directly satisfies the gate;
- `fail`: current evidence directly violates the gate;
- `pending`: the required integrated or blinded evidence has not been recorded;
- `blocked`: a prerequisite failed, so the gate cannot yet be evaluated.

`pending` is not a soft pass. CI may verify that pending evidence is represented
honestly, while `node maintainer/evals/run.mjs --release` must reject every
`pending`, `blocked`, or `fail` release gate.

The deterministic suite may establish file counts, hashes, generated settings,
source-change diagnostics, idempotency, and rollback identity. It may not turn
those facts into a claim that retrieval was relevant, a material claim was
semantically verified, Capture changed a later action, or task quality did not
regress. Those claims require the three-run v1/v2 records described in
`README.md`.

## Integrated Evidence Contract

An integrated gate can leave `pending` only through a checked-in
`evidence/integrated-gates.json`. Gate-to-fixture coverage is fixed by the
evaluator, not selected by the evidence submitter. Every attempt binds a
structured run record to the current fixture, artifact, evaluator policy,
model, prompt, repository state, tool budget, stopping rule, toolchain, and
blind label. The run also binds the evaluated subject: the complete frozen v1
archive tree or the stable digest of the distributed v2 skill and bundle. Each
raw transcript, patch, test result, snapshot, or diff is a separately hashed
artifact.

The prompt, task-input repository, stopping rule, and toolchain hashes are not
free-form identifiers. Each must equal the digest of exactly one referenced raw
protocol artifact. The toolchain artifact records the run harness and any
tokenizer used for measurement, including enough version information to repeat
the derivation.

`campaign_id` identifies the declared execution campaign for a run, while
`run_id` identifies one version, fixture, and attempt tuple. Within one loaded
evidence manifest, a run ID may not identify two different tuples. When the
same tuple supports multiple gates, every gate must reference the same frozen
run record; this is evidence reuse, not an additional attempt. These checks are
manifest-scoped and do not constitute a repository-external registry of all
campaigns or runs ever executed.

The separate blinded review must judge every required and forbidden rubric item
with fixture-approved evidence references and rationale. It must also cover
every expected retrieval route and material claim declared by the fixture; those
fields are executable obligations, not descriptive metadata. The loader derives
`pass`, `fail`, or `blocked` from the v2 attempts for absolute outcome gates;
v1 attempts remain comparison baselines and do not have to pass the v2 rubric.
A completed execution must have exit code zero. Numeric thresholds such as
token, metadata-write, and irrelevant-context reductions are aggregated by the
runner rather than copied from a review verdict.

Comparison outcomes are paired by fixture and attempt. A required rubric item
satisfied by v1 may not become unsatisfied in v2, and a forbidden item avoided
by v1 may not become triggered in v2. Another attempt or fixture cannot offset
that regression.

Every numeric measure has an explicit availability state: `measured`,
`not-measured`, or `not-applicable`. A measured value is derived by evaluator
code from referenced, hashed raw artifacts; copying a submitter-provided total
into a second file is not derivation. Missing, malformed, or unavailable source
data is never represented as zero. A numeric gate is `blocked` unless every
mapped fixture has all three comparable v1/v2 attempt pairs measured.

`input_tokens` comes from provider-reported usage in the raw model-response
artifacts. Exact recomputation is allowed only when the campaign pins the
tokenizer and vocabulary in the toolchain artifact and applies them to the
exact input bytes; heuristic estimates are not evidence. Irrelevant context is
judged per selected-context item by blinded review, then totaled by the
evaluator. Without one fixed tokenizer for both arms, its unit is bytes, not
tokens. Low-value Capture is likewise judged per persisted Capture item; an
unresolved item blocks the reduction gate instead of being silently counted or
discarded.

The current blind-review contract is maintainer-attested. The loader checks the
declared blind flag, opaque arm labels, run identifiers without literal
evaluated-version strings, paired arm separation, exact review coverage, and
evidence bindings. It does not prove
the reviewer's real identity, how materials were assigned, that the reviewer
never saw version-bearing files, or that timestamps and campaign identities
were issued by an independent service. Maintainers must enforce those process
boundaries outside the manifest. A signed assignment coordinator could
strengthen this assurance in a future revision, but none is part of this suite.
