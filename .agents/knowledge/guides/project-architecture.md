---
kind: map
status: active
scope:
  - "README.md"
  - "docs/**"
  - "skills/self-evolution/**"
  - "tools/kb/**"
use_when:
  - "changing the v2 runtime contract, knowledge model, retrieval flow, or CLI"
  - "deciding where project knowledge or optional integration belongs"
review_when:
  - "the filesystem contract, data model, CLI boundary, or migration architecture changes"
sources:
  - path: "docs/ARCHITECTURE.md"
    checked_at: "git:5705b6ddfd6a16ff25f2be3fc2f307d49605f4a2"
  - path: "skills/self-evolution/references/data-model.md"
    checked_at: "git:5705b6ddfd6a16ff25f2be3fc2f307d49605f4a2"
  - path: "tools/kb/src/**"
    checked_at: "git:693a705a9a4dc663adea4d388c05633417448fd2"
---

# v2 Project Architecture

## Purpose

Use this Map to locate the three v2 surfaces and to choose the correct owner
for a change: the Project Knowledge Core, optional tool integration, or the
Maintainer System.

## Runtime Flow

Task intent is routed through `AGENTS.md` to the smallest matching Guide or
Decision, then checked against current code, tests, configuration, runtime
evidence, project documentation, or an explicit human decision. The model
interprets relevance and correctness; the CLI verifies deterministic structure,
paths, links, source signals, and atomic operations.

## Data Ownership

The root `AGENTS.md` is a short router. `.agents/settings.yaml` stores explicit
user choices. `.agents/knowledge/guides/` holds durable task guidance,
`decisions/` holds adopted rationale, `observations/` holds valuable findings
whose destination is not yet settled, and `archive/` holds material history.
`index.yaml` is generated from active Guides and accepted Decisions; it is not
an authority source.

Optional adapters are project-scoped, explicitly enabled, and off by default.
Generated rules and adapters are disposable outputs derived from settings or
knowledge rather than a second source of truth.

## CLI and Migration Boundaries

The bundled CLI owns schema parsing, index generation, local path/link/scope
checks, source-change signals, adapter state, atomic writes, and staged
migration mechanics. Semantic value, authority, conflict resolution, and
whether a claim remains correct belong to model or human review.

When v1 artifacts are detected, `kb init` leaves them unchanged and routes the
work to the repository Migration Guide. Migration uses prepare, semantic
review, apply, and rollback; exactly one knowledge system is active at a time.

## Verification

For runtime or CLI changes, run the focused tests in `tools/kb/test/`, then
`npm run ci` and `npm run check:bundle`. For migration changes, also exercise
the deterministic migration probes and inspect the input, backup, and rollback
hashes. Keep detailed migration procedure in `docs/MIGRATION.md` rather than
duplicating it in this Map.

## Uncertainties

The deterministic CLI can signal source changes and structural problems, but it
does not prove that Guide prose is semantically correct or that a model will
retrieve and apply it well. Those claims require the integrated and blinded
evaluation evidence described by the evaluation Guide.
