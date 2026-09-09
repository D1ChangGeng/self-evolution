# Self-Evolution v2 Design

Status: design contract for `v2.0.0`; current release evidence is recorded in
[`evals/RESULTS.md`](evals/RESULTS.md).

## Purpose

Self-Evolution is a lightweight project context system. It preserves only
knowledge that helps a future agent find the right context, verify material
claims against current reality, and make a better engineering decision.

The system is successful when it improves task outcomes at lower context and
maintenance cost. Success is judged by task outcomes, evidence quality, and
maintenance return.

## Boundaries

The system has three coordinated parts:

1. **Project Knowledge Core** stores and retrieves project-specific knowledge.
2. **Optional Tool Integration** provides explicit, removable routing and
   reminder adapters. No adapter is installed by default.
3. **Maintainer System** uses failure cases, proposals, and evaluations to
   improve the distributed skill.

The core manages project knowledge and retrieval. Task plans, external skills,
distributed-skill maintenance, and knowledge refinement remain in their own
surfaces.

## Runtime Model

```text
task intent
  -> AGENTS.md routing
  -> smallest matching Guide or Decision
  -> current code, tests, config, docs, or runtime evidence
  -> model judgment and action
  -> correct existing knowledge, capture a valuable Observation, or leave the source of truth unchanged
```

The layers have explicit responsibilities:

| Layer             | Responsibility                                                    |
| ----------------- | ----------------------------------------------------------------- |
| Model             | Relevance, value, conflict resolution, applicability, abstraction |
| Reality evidence  | Facts from code, tests, config, runtime, docs, or people          |
| Project knowledge | Durable Guide, Decision, and temporary Observation content        |
| Retrieval         | `AGENTS.md`, `scope`, `use_when`, and generated `index.yaml`      |
| Deterministic CLI | Format, path, link, source-change, adapter, and migration checks  |

Programs signal source changes. Models interpret knowledge correctness and show
the evidence used for that decision.

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
instruction to verify material knowledge against present evidence. Detailed
Guide content, system health, adapter state, and skill recommendations remain
in their authoritative locations.

### Guides

Guides are classified by use, not maturity:

- `guide`: understanding or modifying a project area;
- `runbook`: executing a project-specific operation;
- `map`: stable navigation with limited interpretation;
- `policy`: an explicitly adopted project rule.

Required frontmatter is `kind`, `status`, non-empty `scope`, and non-empty
`use_when`. `review_when` and structured `sources` are optional. A Guide is
split when its consumers, scopes, change rates, or maintenance ownership form
distinct groups.

### Decisions

Decisions preserve why an important choice was adopted. They require a unique
ID, status, date, scope, and supersession relationship. Authority comes from an
explicit adoption state.

### Observations

Observations are a temporary monthly buffer for valuable findings whose final
home is unclear. Each entry states the finding, future action impact, evidence,
and likely destination. They remain outside the generated retrieval index and
may be integrated, archived, or retired as their future consumer becomes clear.

### Index and Settings

`index.yaml` is deterministic generated output containing retrieval data for
consumable Guides and Decisions. It is rebuilt from source documents and remains
the generated retrieval view.

`.agents/settings.yaml` records user choices that are not represented in the
filesystem: generated scope rules, and per-tool `context_recovery` and
`post_task_reminder` booleans. All optional behavior defaults to off.

## Operations

The four explicit operations are:

- **Onboard**: reuse existing docs, find high-cost understanding gaps, create a
  minimal router and at most a few high-value Guides, then verify claims.
- **Capture or Correct**: correct the known authoritative file, record a valuable
  Observation, or leave the source of truth unchanged.
- **Maintain**: address the highest-impact error, source change, retrieval gap,
  integration opportunity, duplication, or superseded content.
- **Audit**: report evidence-backed Critical/High/Medium/Low risks and actions.

**Retrieve** is a standing behavior for every engineering task: route to the
smallest relevant set and verify material claims before use.

## Compatibility and Migration

Detected v1 projects enter a staged migration workflow:

1. `prepare` reads v1 and writes a reviewable plan, candidates, input hashes,
   traceability, and semantic review items while v1 remains active.
2. A model resolves merge, deletion, split, uncertainty, supersession, AGENTS,
   and adapter decisions.
3. `apply` verifies unchanged inputs, creates a hash-manifested run backup,
   switches atomically, rebuilds the index, and checks the result.
4. `rollback` restores the recorded bytes.

One knowledge system is active at a time: v1 before apply, v2 after apply, and
v1 after rollback. Migration compatibility remains part of every `2.x` release;
retiring this contract is a `3.0` change.

## v2 Knowledge Model

v2 stores durable context in Guides, Decisions, Observations, and Archive, with
routing through `AGENTS.md`, generated metadata in `index.yaml`, and optional
project-scoped adapters. Its runtime contract is Onboard, Retrieve, Capture or
Correct, Maintain, and Audit.

## Mechanism Admission

A new runtime mechanism requires a proposal that identifies an observed
failure, affected future action, why current behavior is insufficient, expected
benefit, context and maintenance cost, false-trigger harm, default state,
measurement method, and removal condition. New fields also name their producer,
consumer, read point, decision effect, lifecycle, and deletion rule.

## Release profiles

Release evidence is matched to change impact. The standard profile requires the
deterministic safety gates plus the independent public benchmark and changed
path checks selected by `docs`, `routing`, `core`, or `migration`. The private
profile preserves the original three-attempt v1/v2 integrated campaign as a
later enhancement. A missing or unavailable public run is `blocked` and keeps
the applicable standard release from becoming ready; it does not rewrite the
historical gates or claim a score.

The public benchmark adapter lives under `maintainer/evals/public/` and is not
loaded by projects. LongMemEval cleaned is the primary comparable memory
regression; pinned LongMemEval-V2 is a secondary agentic-engineering pilot for
core changes. Both are complemented by deterministic checks and small blinded
engineering tasks because public conversation or trajectory benchmarks do not
measure repository routing, source-change handling, Capture value, or harness
safety.
