# Integrated Evaluation Evidence

`run.mjs` leaves outcome gates pending until `integrated-gates.json` and all of
its referenced artifacts are checked in. Missing evidence is honest and keeps
the release candidate blocked.

## Binding

The root manifest uses `schema_version: "2.0"` and binds evidence to:

- the suite version;
- the normalized frozen v1 baseline;
- the distributed v2 `SKILL.md` and CLI bundle;
- all fixture contracts and READMEs;
- the evaluator policy, including `SPEC.md`, schemas, gate-to-fixture mapping,
  aggregation logic, and this document.

Changing any binding invalidates the campaign.

## Campaign and run identity

`campaign_id` is a declared execution-campaign identifier in each run protocol;
`run_id` identifies one suite version, evaluated version, fixture, and attempt
tuple. Paired v1/v2 attempts share their campaign protocol while using distinct
opaque arm labels.

Identity checks are scoped to the loaded `integrated-gates.json`. A run ID
cannot identify different tuples anywhere in that manifest. If one tuple is
needed by multiple gates, each gate may reference the same run artifact only
when its bytes are identical; the loader freezes that tuple globally for the
manifest. This cross-gate reuse represents one execution and must not be
reported as another attempt. Run artifacts or raw artifact paths cannot be
repurposed for a different tuple or owner.

There is no append-only campaign registry in the current suite. Consequently,
the loader does not prove that an identifier was never used in an older,
external, or uncommitted campaign. The root manifest also has no single
campaign field, so unrelated tuples are not required to declare one common
campaign ID. Maintainers must allocate identifiers and preserve campaign
history so accidental reuse remains auditable.

## Run records

Every required fixture has attempts 1-3 for both v1 and v2. A run reference
points to a hashed JSON record containing:

- immutable tuple: suite, version, fixture, fixture digest, and attempt;
- unique run ID;
- evaluated-subject digest: the complete frozen v1 archive tree for v1, or the
  stable digest of the distributed v2 skill and bundle for v2;
- execution status, exit code, and stdout/stderr hashes;
- campaign, model, prompt hash, tool budget, task-input repository hash,
  stopping-rule
  hash, toolchain hash, and blind label;
- measurement availability, units, derivation methods, source references, and
  derived duration, input/output tokens, metadata writes, low-value Capture,
  and irrelevant-context volume when available;
- hashed raw artifacts grouped by evidence kind.

Every run includes exactly one `execution-stdout` and one
`execution-stderr` artifact. Their verified file hashes must equal the hashes
in the execution record, so a completed run cannot cite unbound stream values.
Every run also includes one `measurements` JSON artifact. Its top-level
`source_refs` identify raw model responses, execution timing, filesystem trace,
selected-context and Capture manifests, and the item-level label artifact. Its
`cache` records each metric as `status` (`measured`, `not-measured`, or
`not-applicable`), `unit`, and `value`. Evaluator code recomputes every cached
value from the referenced raw artifacts and rejects a difference. Missing or
malformed source evidence becomes `not-measured`, never numeric zero.

`repository_sha256` covers the identical materialized task input before the
version-specific skill/runtime is injected; the root manifest separately binds
the frozen v1 baseline and distributed v2 artifacts. Paired v1/v2 attempts must
use the same protocol except for their blind label and evaluated-subject digest.
The prompt, repository input, stopping rule, and toolchain hashes each bind
exactly one raw artifact of the same name; free-form hashes without those bytes
are rejected. The toolchain artifact identifies the run harness, measurement
collector, and any tokenizer and vocabulary used by a derivation.

`input_tokens` is the sum of provider-reported input-token usage in referenced
raw model-response artifacts. If provider usage is absent, it may be computed
only from the exact input bytes with a tokenizer and vocabulary pinned by the
toolchain artifact. Character ratios, word ratios, and unversioned tokenizer
estimates leave the metric `not-measured`.
Except for the identical cross-gate reference described above, artifact paths
and run IDs cannot be reused. `failed` or `unavailable` v2 execution blocks the
gate. `completed` requires exit code zero. v1 attempts remain comparison
baselines and are not required to satisfy the v2 action rubric for absolute
outcome gates.

## Review records

The gate review is a separately hashed JSON artifact. It covers every run
exactly once, binds each review to that run's fixture, and records:

- every required rubric item as `satisfied` or `not-satisfied`;
- every forbidden rubric item as `triggered` or `not-triggered`;
- one or more references to hashed raw artifacts whose kinds are allowed by the
  fixture rubric;
- a rationale for every verdict and for the overall review.
- one gate-level verdict for every `expected_retrieval` route, referencing v2
  runs in which it was or was not retrieved;
- one gate-level `verified`, `refuted`, or `unresolved` verdict for every
  `material_claims` item, referencing the v2 runs used to judge it.

The loader derives the run and gate status from these verdicts. Missing expected
retrieval or any material claim that is refuted or unresolved fails the gate. A prose file
containing only `approved`, an arbitrary status in the root manifest, or an
artifact that merely exists cannot release a gate.

The current review assurance is maintainer-attested rather than independently
certified. The loader requires `blind: true`, opaque and distinct paired arm
labels, run IDs that do not expose the literal evaluated version, a reviewer
identifier distinct from the declared campaign identity, and exact structured
coverage. These checks establish consistency of the checked-in claim; they do
not establish the reviewer's real identity, prove independent assignment,
prevent access to version-bearing run records or paths, validate wall-clock
ordering, or detect disclosure through channels outside the evidence bundle.

Maintainers must therefore prepare version-neutral review material, keep the
arm mapping from the reviewer until verdicts are fixed, and record any process
deviation. A future trusted coordinator could issue and sign campaign and
assignment receipts, but the repository currently contains no such coordinator
and no cryptographic identity or timing proof.

## Gate coverage

Coverage is exact and versioned in `evidence.mjs`. Narrow gates use their
specific fixtures (for example `wrong-knowledge` and `no-capture`); the combined
retrieval/task-quality gate covers the original twelve task classes. The
thirteenth fixture is dedicated to migration semantic preservation.

Numeric gates are additionally recomputed by `run.mjs` from all complete
paired measurements:

- initialization protocol tokens: at least 40% mean reduction;
- task-time metadata writes: at least 60% mean reduction;
- blinded low-value Capture count: every paired attempt is non-worsening and
  every fixture total falls by at least 50%;
- irrelevant context volume: at least 25% median reduction, using bytes unless
  both arms share one campaign-pinned tokenizer.

The selected-context manifest lists each included item and its exact bytes.
Blinded review labels every item relevant, irrelevant, or unresolved with raw
evidence references; the evaluator totals only items labeled irrelevant. The
Capture manifest similarly lists every persisted item, and blinded review
labels each item low-value, not-low-value, or unresolved before the evaluator
counts low-value Capture. Any unresolved required item blocks its numeric gate.

Aggregation requires all three comparable v1/v2 attempt pairs for every
fixture mapped to the numeric gate. A missing run, failed execution,
`not-measured` metric, required `not-applicable` metric, or mixed unit blocks
the gate; the runner must not calculate a threshold from a smaller successful
subset.

Semantic gates still require blinded judgment; deterministic structure never
certifies relevance, Capture value, prose correctness, or task quality.
