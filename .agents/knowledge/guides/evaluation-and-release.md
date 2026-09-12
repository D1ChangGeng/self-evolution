---
kind: guide
status: active
scope:
  - "maintainer/evals/**"
  - ".github/workflows/**"
  - "legacy/v1/**"
use_when:
  - "changing evaluation contracts, evidence derivation, CI, or release gates"
  - "running or interpreting external real-task campaigns"
review_when:
  - "the public or integrated evidence schema, external harness, frozen baseline, or release process changes"
sources:
  - path: "maintainer/evals/**"
    checked_at: "git:693a705a9a4dc663adea4d388c05633417448fd2"
  - path: ".github/workflows/**"
    checked_at: "git:693a705a9a4dc663adea4d388c05633417448fd2"
  - path: "legacy/v1/**"
    checked_at: "git:693a705a9a4dc663adea4d388c05633417448fd2"
---

# Evaluation and Release Evidence

## Purpose

Use this Guide when changing evaluation code, CI, campaign execution, evidence
schemas, or release claims. It keeps structural validation, integrated outcome
evidence, and external real-task comparisons within their distinct authority
boundaries.

## Evidence Layers

The deterministic suite establishes artifact and safety facts such as file
counts, hashes, schema validity, source-change signals, migration integrity,
idempotency, and adapter defaults. The standard profile adds the public
benchmark and small cross-harness engineering campaign under
`maintainer/evals/public/`. The historical integrated campaign remains a
separate, optional private profile. Read `maintainer/evals/SPEC.md` and the
current `maintainer/evals/public/RESULTS-1302-1.md` for exact scope and status.

Every numeric integrated result is derived from referenced, hashed raw
artifacts. Cached totals are checked against that derivation. Missing or
malformed measurement sources remain `not-measured`; they are never converted
to zero.

## Formal Release Gates

`maintainer/evals/results/v2-current.json` is the current machine-readable
record. Select the actual change class and release profile before running
`node maintainer/evals/run.mjs --release`. `release_ready` becomes true only
when every gate required by that profile passes. The standard/core profile
requires deterministic safety, three paired public runs on each required
benchmark, and the six cross-harness execution/review samples. Historical
integrated gates retain their `pending` status until their evidence exists;
they are required only by the private profile. Structural savings cannot offset
a measured task-quality regression.

The checked-in `evidence.bundle.tar.gz` is bound by
`evidence.bundle.json`. The evaluator extracts it temporarily, checks raw
artifact hashes, and derives the benchmark result rather than trusting supplied
totals. The model endpoint alias is not an immutable build, so record its
observed revision and repeat paired runs as specified by the public policy.

The frozen v1 baseline is bound by `maintainer/evals/baseline/v1.json`. The
evaluator compares the archive with its source commit, so CI uses a full-history
checkout. Preserve the archive bytes, baseline hashes, and source commit
relationship together.

## External Real-Task Campaigns

The external harness under `maintainer/evals/external/` is a separate pilot
system. It freezes v1 and v2 subjects, uses opaque arms, protects coordinator
evidence from execution workspaces, records per-phase raw evidence, and creates
blind review bundles. Its report uses correctness-first aggregation and leaves
the winner unresolved when required runs or reviews are incomplete.

External summaries have `release_gate_effect: none`. Moving evidence into the
formal integrated gates requires the separate contract and artifacts defined by
the release evaluator.

## Execution and Validation Boundaries

Preparation must complete the frozen task, toolchain, subject, restricted
identity, filesystem, namespace, network, credential, and smoke checks before a
formal campaign begins. Hidden tests and validation preloads are materialized in
validation copies only and stay outside Agent-visible base workspaces.

The filesystem trace is tool-event-derived and corroborated by snapshots and
patches. Describe it at that assurance level; it is not an operating-system
syscall trace.

## Verification

For repository changes, run:

```text
npm ci
npm run ci
npm run eval:external:test
```

Before publication, inspect the exact staged tree, confirm the current Skill
and CLI bundle hashes in the evaluation result, keep unresolved gates in their
recorded states, and verify the pushed commit with both CI platforms.

## Uncertainties

The public benchmark and six engineering samples cover selected memory and
harness behaviors, not every project-wiki use case. The private integrated
v1/v2 task-quality campaign remains pending and must not be reported as a
passing standard-profile measurement.
