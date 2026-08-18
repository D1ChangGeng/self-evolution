# Self-Evolution v2 Design

Status: release candidate for `v2.0.0`; outcome gates remain pending

## Purpose

Self-Evolution is a lightweight project context system. It preserves only
knowledge that helps a future agent find the right context, verify material
claims against current reality, and make a better engineering decision.

The system is successful when it improves task outcomes at lower context and
maintenance cost. File counts, capture volume, promotion state, and a composite
health score are not success measures.

## Boundaries

The system has three deliberately separate parts:

1. **Project Knowledge Core** stores and retrieves project-specific knowledge.
2. **Optional Tool Integration** provides explicit, removable routing and
   reminder adapters. No adapter is installed by default.
3. **Maintainer System** uses failure cases, proposals, and evaluations to
   improve the distributed skill. It never runs inside a user project.

The core does not manage task plans, install external skills, maintain a local
fork of the distributed skill, or turn repeated notes into progressively higher
knowledge classes.

## Runtime Model

```text
task intent
  -> AGENTS.md routing
  -> smallest matching Guide or Decision
  -> current code, tests, config, docs, or runtime evidence
  -> model judgment and action
  -> correct existing knowledge, capture a valuable Observation, or save nothing
```

The layers have explicit responsibilities:

| Layer | Responsibility |
|---|---|
| Model | Relevance, value, conflict resolution, applicability, abstraction |
| Reality evidence | Facts from code, tests, config, runtime, docs, or people |
| Project knowledge | Durable Guide, Decision, and temporary Observation content |
| Retrieval | `AGENTS.md`, `scope`, `use_when`, and generated `index.yaml` |
| Deterministic CLI | Format, path, link, source-change, adapter, and migration checks |

Programs may signal that a source changed; they must not conclude that prose is
wrong. Models may decide that knowledge is wrong; they must show the evidence
used for that decision.

## Project Contract

```text
project/
|-- AGENTS.md
`-- .agents/
    |-- settings.yaml
    |-- knowledge/
    |   |-- index.yaml
    |   |-- guides/
    |   |-- decisions/
    |   |-- observations/
    |   `-- archive/
    `-- generated/
        |-- rules/
        `-- adapters/
```

`kb init` creates only the minimal files needed for the current project. Empty
knowledge directories are created on demand. `generated/` exists only when an
explicit setting or adapter requires it.

### AGENTS.md

`AGENTS.md` is a short routing and governance surface. It contains project
purpose, essential commands, critical rules, a Where to Look table, and the
instruction to verify material knowledge against present evidence. It does not
duplicate Guide content or record system health, adapter state, or skill
recommendations.

### Guides

Guides are classified by use, not maturity:

- `guide`: understanding or modifying a project area;
- `runbook`: executing a project-specific operation;
- `map`: stable navigation with limited interpretation;
- `policy`: an explicitly adopted project rule.

Required frontmatter is `kind`, `status`, non-empty `scope`, and non-empty
`use_when`. `review_when` and structured `sources` are optional. A Guide is
split when its consumers, scopes, change rates, or maintenance ownership stop
overlapping, not at a fixed line count.

### Decisions

Decisions preserve why an important choice was adopted. They require a unique
ID, status, date, scope, and supersession relationship. Authority comes from an
explicit adoption state, not a confidence label.

### Observations

Observations are a temporary monthly buffer for valuable findings whose final
home is unclear. Each entry states the finding, future action impact, evidence,
and likely destination. They are excluded from the generated retrieval index
and may be integrated, archived, or deleted when they no longer have a future
consumer.

### Index and Settings

`index.yaml` is deterministic generated output containing only retrieval data
for consumable Guides and Decisions. It is rebuilt from source documents and is
never a second hand-maintained source of truth.

`.agents/settings.yaml` records only user choices that cannot be inferred from
the filesystem: generated scope rules, and per-tool `context_recovery` and
`post_task_reminder` booleans. All optional behavior defaults to off.

## Operations

The four explicit operations are:

- **Onboard**: reuse existing docs, find high-cost understanding gaps, create a
  minimal router and at most a few high-value Guides, then verify claims.
- **Capture or Correct**: correct the known authoritative file; otherwise save
  a valuable Observation; otherwise save nothing.
- **Maintain**: address the highest-impact error, source change, retrieval gap,
  integration opportunity, duplication, or superseded content.
- **Audit**: report evidence-backed Critical/High/Medium/Low risks and actions,
  never a composite score.

**Retrieve** is a standing behavior for every engineering task, not a fifth
mode: route to the smallest relevant set and verify material claims before use.

## Compatibility and Migration

v1 projects are never silently initialized as v2. Migration is staged:

1. `prepare` reads v1 and writes a reviewable plan, candidates, input hashes,
   traceability, and semantic review items without changing the active system.
2. A model resolves merge, deletion, split, uncertainty, supersession, AGENTS,
   and adapter decisions.
3. `apply` verifies unchanged inputs, creates a hash-manifested run backup,
   switches atomically, rebuilds the index, and checks the result.
4. `rollback` restores the recorded bytes.

There is no v1/v2 dual write and no default cross-version retrieval. v1
migration compatibility remains for all `2.x` releases and is removed only in
`3.0`.

## Removed v1 Mechanisms

v2 does not contain file-level confidence, health scores, promotion pipelines,
application/refinement counters, mandatory seven-directory scaffolds, runtime
EVOLUTION-SPEC, Mode 7, skill install queues, project-local skill overrides,
session-end inbox writers, or a mandatory adapter decision during onboarding.

## Mechanism Admission

A new runtime mechanism requires a proposal that identifies an observed
failure, affected future action, why current behavior is insufficient, expected
benefit, context and maintenance cost, false-trigger harm, default state,
measurement method, and removal condition. New fields also name their producer,
consumer, read point, decision effect, lifecycle, and deletion rule.
