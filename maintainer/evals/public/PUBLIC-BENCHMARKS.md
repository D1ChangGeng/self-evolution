# Public memory benchmark layer

This directory contains the benchmark policy and runner contract for public
memory evaluations. It is deliberately outside the distributed skill and the
release evaluator's core fixture runner. The skill remains a project wiki
implemented through instructions, repository files, and the host harness; a
benchmark adapter may translate a benchmark haystack into that contract, but
must not add a retrieval service, vector database, or background workflow to a
user project.

## Selected benchmarks

### Primary: LongMemEval cleaned

The primary public gate is the mature `xiaowu0162/longmemeval-cleaned` release
(500 questions). Each campaign must record the exact Hugging Face dataset
revision and SHA-256. It measures information extraction, multi-session
reasoning, knowledge updates, temporal reasoning, and abstention. These
capabilities map directly to project-wiki concerns such as preserving durable
facts, reconciling updates, and declining unsupported claims. It remains
conversation-centric, so it cannot stand in for code or tool-state validation.

### Secondary pilot: LongMemEval-V2

Pinned source: `xiaowu0162/LongMemEval-V2`, commit
`2cc8c540bdb87fe6761629b585e727e1c4704520` (captured 2026-09-09).
The upstream benchmark contains 451 questions across web and enterprise
trajectories, up to 500 trajectories and 115M tokens per haystack, and scores
static state recall, dynamic state tracking, workflow knowledge, environment
gotchas, and premise awareness. It is the best available secondary pilot for
agentic engineering memory because it asks whether retrieved experience changes
an agent's next action and includes latency as an outcome.

The benchmark does not measure repository scope routing, source-change
signals, authority ownership, Capture decisions, rollback, or whether a
material engineering claim was verified against current code. Those remain
covered by this repository's deterministic checks and small, blinded engineering
tasks.

For cleaned, use a fixed stratified sample for frequent checks and all 500
questions for release evidence. For the V2 pilot, the initial core release gate
uses all 451 questions with the official `small` 100-trajectory haystacks across
web and enterprise. The official `medium` 500-trajectory haystacks are a later
scale and robustness enhancement. Pin the
benchmark commit or dataset revision, data snapshot, model(s), model endpoint,
prompt/template, context-token limit, random seed (if supported), and
toolchain. Preserve raw outputs, config, and SHA-256 manifests. Report answer
accuracy by ability, mean and p95 query latency, selected-context bytes/tokens,
and unavailable measurements as `not-measured` rather than zero.

### Diagnostic only: LoCoMo

LoCoMo is a compact long-conversation benchmark (approximately 300 turns per
conversation) with question answering and temporal/event reasoning. It is useful
for detecting an accidental regression in basic long-context handling. Its
conversation-only design and limited engineering state make it unsuitable as a
release gate by itself.

## Gate policy

The public layer uses paired comparisons against the last accepted baseline,
with identical benchmark, data, model, prompt, context budget, and toolchain.
A first run establishes a baseline and is `not-measured`; it cannot be declared
an improvement from an absolute score alone. Numeric gates are evaluated only
when all required slices are measured.

| Change class                                  | Required public runs                                                                                                                                                                  | Pass criteria                                                                                                                                                              | Frequency            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Docs or wording only                          | LongMemEval cleaned stratified sample; deterministic suite                                                                                                                            | No deterministic failure; no measured ability bucket drops >3 percentage points; overall accuracy drop ≤2 points                                                           | PR/commit            |
| Routing, metadata, index, or lifecycle change | LongMemEval cleaned stratified sample; deterministic suite                                                                                                                            | Same regression limits; p95 latency increase ≤20%; selected context bytes increase ≤15% unless an approved rationale is recorded                                           | PR and nightly       |
| Core retrieval or memory-model change         | Three paired runs of LongMemEval cleaned full 500 and all 451 LongMemEval-V2 questions with small web + enterprise haystacks; 3–5 blinded engineering fixtures covering changed paths | Pooled results meet the regression limits: overall drop ≤2 points, per-ability drop ≤3 points, p95 latency ≤20% worse, selected context ≤15% larger, and no safety failure | Release candidate    |
| Migration, adapter, or evaluator change       | Deterministic migration/adapter suite plus cleaned affected slice and at least one harness smoke per supported tool; V2 pilot when retrieval code changes                             | All structural and compatibility checks pass; benchmark metrics are comparable; no changed behavior is claimed from an unavailable run                                     | Before merge/release |

The full private 13-fixture, three-attempt-per-arm campaign remains a later
enhancement. It is required only when maintainers explicitly promote it to a
release gate; its absence must leave the relevant semantic status as
`pending`/`not-measured`, not silently pass.

A run is `not-comparable` when any paired input, model, prompt, context budget,
or toolchain differs. A run is `blocked` when the benchmark or endpoint cannot
be executed (missing data, dependency, credential, or host capability). A run
is `fail` only when a comparable measured result violates a threshold or a
required safety/task criterion. Retry transient infrastructure failures once;
if the same prerequisite is unavailable, retain `blocked` and report the exact
condition.

For the core profile, the evaluator pools all per-question observations from
three complete paired runs before applying thresholds. It also retains each
run's metrics as diagnostics. This is required when the endpoint does not expose
an immutable model revision or system fingerprint and repeated temperature-zero,
fixed-seed probes produce different outputs. A single favorable or unfavorable
run cannot decide release. Missing or non-comparable attempts keep the gate
blocked.

## Engineering complement

Public benchmarks are memory-effectiveness signals, not proof of project wiki
correctness. Every release candidate also runs the repository fixture probes,
`kb check`, bundle verification, and a small blinded sample selected from the
changed behavior. The sample must include, where applicable:

- scope routing and minimal-context selection;
- changed-source or wrong-knowledge detection;
- material-claim verification before high-risk actions;
- Capture abstention or useful correction;
- context recovery after compaction; and
- one smoke run through each supported harness adapter.

These checks remain in `maintainer/evals`; benchmark-specific code and data stay
here or in an external campaign workspace. No benchmark result changes the
skill's runtime defaults.
