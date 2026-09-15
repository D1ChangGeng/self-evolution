# Evaluation Suite

Evaluations compare real task outcomes, retrieval behavior, capture value, and
maintenance cost. They do not reward a version for producing more files or
metadata, and deterministic checks never certify semantic task quality.

## Commands

```text
node maintainer/evals/run.mjs --verify
node maintainer/evals/run.mjs --record
node maintainer/evals/run.mjs --release
# Narrow or strict release profiles
node maintainer/evals/run.mjs --release --profile=standard --change-class=docs
node maintainer/evals/run.mjs --release --profile=private
```

- `--verify` runs deterministic probes and verifies that the checked-in result
  files describe the current artifact. Pending evidence remains visible; the
  selected release profile decides whether it blocks release.
- `--record` updates `results/v2-current.json` and `RESULTS.md` after an
  intentional artifact change.
- `--release` runs the selected profile. The default `public-engineering` profile
  uses the bounded, hash-bound real SWE-bench engineering evidence scope. Use
  `--profile=standard` for the larger historical benchmark requirements and
  `--profile=private` for the strict historical v1/v2 integrated campaign.

All three modes materialize every fixture and execute its declared initial
verifier before evaluating gates. The direct release command therefore cannot
skip the executable fixture oracles that CI runs.

The runner uses the distributed bundle, not TypeScript source imports. It
checks fixture integrity, normalized archive hashes, the observed frozen v1
initializer behavior, default installation shape, source-change signals,
semantic-check boundaries, optional adapter ownership/idempotency, and complete
project snapshots before migration and after rollback.

Each fixture includes exact synthetic setup files, setup assertions, and an
action rubric tied to raw evidence types. The recorded result contains a digest
of every canonical fixture contract and README, so changing setup or judgment
criteria without re-recording fails `--verify` even when the fixture ID stays
the same.

`SOURCE_CHANGED` is a deterministic gate. Detecting and safely handling wrong
Guide prose is a separate model-plus-blinded-review gate and remains `pending`
until integrated run evidence exists; the deterministic boundary probe can
never turn it into a pass.

The thirteenth fixture is a dedicated migration corpus. It covers applied-state
semantic preservation separately from byte-identical rollback: every material
input needs a reviewed disposition, duplicate active authority must be merged,
and user-owned rule or Hook bytes must not disappear silently.

## Integrated Runs

Use three fixed project classes:

1. an empty project;
2. a documentation-rich brownfield project;
3. a multi-module project containing wrong knowledge and changed sources.

Run each integrated task three times per version with the same model, prompt,
tool budget, repository state, and stopping rule. Hide version labels from
human judges. Preserve raw prompts, selected knowledge, tool transcript,
patches, test results, capture output, timing, and token accounting.

Protocol hashes must resolve to the preserved prompt, task-input repository,
stopping-rule, and toolchain artifacts. Measurements are derived from those and
other hashed raw artifacts and record whether each value is `measured`,
`not-measured`, or `not-applicable`; unavailable evidence is never encoded as
zero. `input_tokens` uses provider-reported response usage, or an exact count
with a campaign-pinned tokenizer over the original input bytes. Heuristic token
estimates are not comparable evidence.

Each run also binds the evaluated subject. v1 uses the digest of every file and
mode in the frozen archive; v2 uses the stable digest of the complete
`skills/self-evolution/` distribution tree together with the bundled CLI. Paired
protocol equality intentionally excludes only the blind label and this
version-specific subject digest.

Blinded reviewers classify every selected-context item and every persisted
Capture item, with evidence references and rationale. The evaluator totals the
items after review. Irrelevant context is measured in bytes unless both arms
use the same pinned tokenizer; low-value Capture is a count of items explicitly
judged low-value, not a run-level impression.

Each run declares a campaign ID and a run ID. A run ID identifies one frozen
version/fixture/attempt tuple within the checked-in evidence manifest. If that
tuple contributes to more than one gate, the gates reuse the identical hashed
run record rather than counting it as another attempt. Reusing a run ID for a
different tuple, or changing the record behind a shared tuple, is rejected.
This uniqueness check does not extend to evidence manifests outside the
repository or to campaigns that were never checked in.

Until those records exist, the historical integrated gates in
`results/v2-current.json` remain `pending`; a fixture definition or
deterministic CLI signal is not a substitute for a task run. The standard
profile does not silently reinterpret those pending historical gates as a
failure, while the private profile still requires them. Public benchmark
evidence follows `public/PUBLIC-BENCHMARKS.md` and is checked through the
independent `public/public.mjs` layer. Fixture authoring rules live in
`fixtures/README.md`.

For absolute model-outcome gates, only the three v2 attempts determine pass,
fail, or blocked; v1 attempts remain the frozen comparison baseline. A run
record marked `completed` must have exit code zero.

For a numeric comparison gate, all three v1/v2 attempt pairs for every mapped
fixture must be completed, comparable, and measured. Any missing pair,
unavailable source, `not-measured` value, or required `not-applicable` value
blocks the gate rather than reducing the aggregation sample.

Task-quality comparison is also per fixture and attempt. A v2 attempt cannot
regress a rubric item that its paired v1 attempt satisfied merely because a
different attempt or fixture improves.

Here, `blinded review` means a maintainer-attested process backed by opaque arm
labels, run IDs without literal evaluated-version strings, hashed artifacts,
and complete structured verdicts. The validator detects several disclosure and
consistency errors, but
it cannot establish human identity, independently assign a reviewer, or prove
that no version-bearing material was disclosed out of band. Maintainers remain
responsible for that separation. The repository does not currently provide a
signed review-assignment or identity service.

The frozen v1 initializer is executable baseline evidence, not a presumed
success. Its archived script creates the seven recorded files and then exits 2
at a historical `printf` error. The runner verifies both the output shape and
that exit behavior so the structural file-count comparison stays reproducible
without rewriting history.

## Engineering continuity episodes

[`engineering/episodes.json`](engineering/episodes.json) is the executable offline
contract for 24 paired C01–C12 variants, six isolated baseline arms, equal-information
and end-to-end Capture experiments, and protected verifier/evidence boundaries. The
existing fixture verifier remains the L0 entry point. Real model runs require an
explicitly authorized endpoint, fixed model, host, and budget; unavailable runs stay
`pending` or `blocked` and never become scores.
