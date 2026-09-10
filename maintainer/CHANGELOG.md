# Changelog

All notable changes to the Self-Evolution skill and its project contract are
recorded here. Versions follow semantic versioning.

## [Unreleased]

## [2.0.0] - 2026-09-09

The v2 project-wiki contract now separates task continuity, durable project
knowledge, and distributed-skill evolution. Release eligibility is recorded in
`evals/RESULTS.md` under the selected release profile.

- Clarified harness-neutral task continuity, project-wiki lifecycle, conflict
  handling, stale-source review, and No-Negative-Echo writing rules.
- Added evidence-granularity guidance so bounded answers preserve verified
  conclusions without introducing unsupported causes, caveats, or alternatives.
- Added Codex, Claude Code, and OpenCode integration guidance with explicit
  adapter capability states and manual fallbacks.
- Added independent public memory evaluation profiles with LongMemEval cleaned
  as the primary benchmark and pinned LongMemEval-V2 as a core-change pilot;
  the historical private campaign is no longer an implicit prerequisite for
  every release.
- Established the root README as the v1-to-v2 migration entry point and
  `docs/MIGRATION.md` as the authoritative procedure.
- Defined the runtime Skill around Onboard, Retrieve, Capture or Correct,
  Maintain, and Audit.
- Retained v1 migration through the bundled CLI and the documented preparation,
  semantic review, apply, verification, and rollback workflow.
- Documented input freezing, hash-gated apply, SHA-256 backups, journaled atomic
  switching, automatic recovery, controlled rollback, and single-system
  activation as migration safety requirements.

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
