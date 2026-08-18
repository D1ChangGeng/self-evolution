# Changelog

All notable changes to the Self-Evolution skill and its project contract are
recorded here. Versions follow semantic versioning.

## [Unreleased]

No changes recorded yet.

## [2.0.0-rc.1] - 2026-08-18

The v2 implementation is available as a release candidate. Deterministic and
safety gates pass, while the outcome gates that require integrated model runs
and blinded review remain pending. See `evals/RESULTS.md` for the exact release
status.

### Added

- Deterministic Node.js CLI for initialization, indexing, checks, migration,
  and optional adapters.
- Failure-driven maintainer system with proposals and blinded task evaluations.
- Staged, reviewable, and reversible v1 migration support for the `2.x` line.
- Executable migration semantic corpus with an evidence-driven release gate.

### Changed

- Account for v1 rules and Hooks in migration hashes, traceability, semantic
  dispositions, applied-state checks, and rollback tests.
- Harden integrated evidence with zero-exit completed runs, bound stdout/stderr
  artifacts, v2-only absolute outcome derivation, and required retrieval and
  material-claim review coverage.
- Reduced runtime behavior to Onboard, Capture or Correct, Maintain, and Audit,
  with Retrieve as a standing task behavior.
- Replaced v1 knowledge maturity directories with Guides, Decisions,
  Observations, and Archive.
- Made tool integration opt-in and isolated from project knowledge.

### Removed

- Confidence levels, promotion paths, health scores, lifecycle counters,
  runtime self-review, skill queues, automatic capture hooks, and mandatory
  adapter selection.

## [1.x]

The final v1 implementation and documentation are preserved under
`legacy/v1/`. They are read-only migration evidence, not an active skill.
