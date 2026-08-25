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
  - "the integrated evidence schema, external harness, frozen baseline, or release process changes"
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
idempotency, and adapter defaults. Model behavior, retrieval quality, Capture
value, and task outcomes require the versioned multi-run and blinded-review
evidence described by `maintainer/evals/SPEC.md`.

Every numeric integrated result is derived from referenced, hashed raw
artifacts. Cached totals are checked against that derivation. Missing or
malformed measurement sources remain `not-measured`; they are never converted
to zero.

## Formal Release Gates

`maintainer/evals/results/v2-current.json` is the current machine-readable
record. `pending` is an explicit evidence state, and `release_ready` becomes
true only when every configured gate passes. Structural savings cannot offset
a correctness or task-quality regression.

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

Real v1/v2 task quality remains unresolved until the prescribed paired model
runs and blind reviews are completed for the current frozen subject.
