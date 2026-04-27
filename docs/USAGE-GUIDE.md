# Self-Evolution Skill Usage Guide

Practical how-to guide for the `self-evolution` skill. This file is about usage. Design rationale belongs in `docs/philosophy.md`.

## 1. Installation

```bash
npx skills add D1ChangGeng/self-evolution-skill --skill self-evolution -g -y
```

Use the skill from the project root.

## 2. Mode 1: Initialize, Empty Project

### When to use

Use this for a new project with no source code yet.

### What to say

```text
Initialize the knowledge base.
```

### What happens

The skill creates the scaffold and writes `AGENTS.md` with safe defaults. It does not invent project specific facts.

### What you get

```text
AGENTS.md
.agents/
├── knowledge/
│   ├── README.md
│   ├── manifest.json
│   ├── inbox/
│   ├── domains/
│   ├── reference/
│   ├── decisions/
│   ├── patterns/
│   ├── crystallized/
│   └── archive/
├── rules/
└── hooks/
    ├── session-end.sh
    ├── stop.sh
    └── compact-recovery.sh
```

### Example output

```text
Initialized self-evolution knowledge base for an empty project.
Created AGENTS.md and .agents/knowledge/ scaffold.
Capture: none, initialization only.
```

## 3. Mode 2: Initialize, Existing Project

### When to use

Use this when the project already has code, tests, config, docs, deployment files, or an existing `AGENTS.md`.

### What to say

```text
Set up knowledge base for this project.
```

### What happens

1. Step 0 pre-validation runs.
2. Scaffold is created.
3. Project structure is scanned.
4. Key files are read.
5. Domain files are written.
6. Reference files are written.
7. `AGENTS.md` is created or augmented.
8. `manifest.json` is updated.

### The scanning process

**Pass 1, structural:** package manifests, build files, source directories, tests, routes, commands, config, deployment files, docs.

**Pass 2, targeted reads:** entry points, top modules, auth, API routes, migrations, deploy scripts, test helpers, existing agent docs.

The goal is useful navigation, not a complete code encyclopedia.

### Example domain file output

```markdown
# Backend Domain

confidence: observed
sources:
  - src/server.ts
  - src/routes/users.ts
  - tests/api/users.test.ts

## Purpose

Handles HTTP routing, validation, and response formatting.

## Where to Start

| Task | Start Here |
|------|------------|
| Add endpoint | src/server.ts |
| Change user routes | src/routes/users.ts |

## Invariants

- Route handlers return typed response objects. [source: src/routes/users.ts]
- API tests use the shared request helper. [source: tests/api/users.test.ts]

## Open Questions

- Which validation rules are public API guarantees?
```

### Handling existing AGENTS.md

Existing `AGENTS.md` is augmented, not overwritten. The skill should preserve current instructions, add knowledge routing, keep human rules, and report conflicts.

```text
Found existing AGENTS.md.
Preserved current instructions and added knowledge routing.
No conflicting rules detected.
```

## 4. Mode 3: Capture, Ambient

Capture is not a mode you trigger. It happens automatically after meaningful work.

### The 5 capture conditions

Capture when:

1. You discovered non-obvious behavior.
2. You fixed a bug that revealed a hidden assumption.
3. You made a decision that constrains future work.
4. You noticed a pattern across files.
5. You found existing knowledge was wrong or incomplete.

### Write-first protocol

The agent must write first, then report.

1. Write to `.agents/knowledge/inbox/YYYY-MM.md` now.
2. Include date, context, observation, and source.
3. Add `[DOMAIN-FIX: domains/name.md]` when a domain file needs later correction.
4. State `Capture:` after writing.

```markdown
## 2026-04-27 14:20, auth refresh retry behavior

- Token refresh retries only happen after a 401 from upstream, not before every request.
- [source: src/accounts/manager.rs:214]
```

```text
Capture: inbox (auth refresh retry behavior)
```

### [DOMAIN-FIX] tagging

Use `[DOMAIN-FIX]` when the current task should finish before editing domain knowledge.

```markdown
## 2026-04-27 15:05, deployment restart rule

- Service restarts must use systemctl because systemd owns process lifecycle.
- [DOMAIN-FIX: domains/deployment.md]
- [source: deploy/runbook.md:32]
```

Before final completion, the agent should apply this session's `[DOMAIN-FIX]` entries.

### Example capture interaction

```text
User: I fixed the test by moving the mock setup before importing the module.

Agent: Wrote .agents/knowledge/inbox/2026-04.md:
- Test mocks for the payment client must be registered before importing checkout.ts.
- [source: tests/checkout.test.ts:18]

Capture: inbox (payment client import time mock requirement)
```

## 5. Mode 4: Evolve

### When to use

Use this when the inbox is accumulating or knowledge feels scattered.

### What to say

```text
Evolve the knowledge base.
```

### The 9-step process

1. Read `manifest.json` and inbox files.
2. Group related entries.
3. Merge duplicates while preserving sources.
4. Verify claims against code or docs.
5. Promote stable knowledge to domain, reference, pattern, or decision files.
6. Archive stale entries.
7. Apply `[DOMAIN-FIX]` corrections.
8. Update `manifest.json`.
9. Report changes and review needs.

### What to expect in the report

```text
Evolution complete.
Processed: 18 inbox entries, 5 duplicates merged, 6 claims promoted.
Archived: 2 stale entries.
Confidence changes: observed to verified, 4. Verified to canonical, 0.
Needs review: API timeout behavior has one source only.
```

### How often to run

Session start should suggest evolution when `inbox_count > 10` or `days_since_evolution > 14`.

## 6. Mode 5: Health Check

### Quick vs deep health checks

Quick:

```text
Check knowledge base health.
```

Deep:

```text
Run a deep knowledge base health check.
```

Quick checks read `manifest.json` and counts. Deep checks sample domain files, citations, links, stale claims, and promotion candidates.

### The 8 metrics

1. **Inbox count:** Raw entries waiting for evolution.
2. **Days since evolution:** How stale organized knowledge may be.
3. **Domain coverage:** Major areas with domain files.
4. **Citation coverage:** Claims with source evidence.
5. **Confidence mix:** Observed, verified, and canonical ratios.
6. **Staleness risk:** Claims likely out of date.
7. **Duplication:** Repeated entries to merge.
8. **Crystallization candidates:** Repeated workflows worth formalizing.

### Example health report output

```text
Knowledge health: needs attention
- inbox_count: 23, high
- days_since_evolution: 19, overdue
- domain_coverage: 7 of 9 major areas covered
- citation_coverage: 68%, needs improvement
- confidence_mix: 41 observed, 16 verified, 3 canonical
- staleness_risk: medium
- duplication: 6 likely duplicates
- crystallization_candidates: 2
Recommended next action: Evolve the knowledge base.
```

### Triage priority order

1. Wrong knowledge that could cause bad actions.
2. Missing deployment, security, or data loss rules.
3. Large inbox backlog.
4. Domain files with weak citations.
5. Repeated workflows ready for crystallization.
6. Cosmetic cleanup.

## 7. Mode 6: Crystallize

### When workflows should be crystallized

Crystallize a workflow when it has been refined three or more times, or when the same mistakes keep recurring.

### What to say

```text
Crystallize this workflow.
```

Or:

```text
Crystallize the release workflow into a reusable checklist.
```

### The refinement process

1. Gather examples from inbox, docs, commits, and current work.
2. Name the trigger.
3. Extract mandatory steps.
4. Separate optional checks.
5. Add verification points.
6. Add common failure cases.
7. Save under `.agents/knowledge/crystallized/`.
8. Link it where future agents will find it.

### Skill graduation path

A workflow can graduate to a standalone skill when it is reused across projects, stable after real runs, executable without extra context, and valuable outside the original repo.

## 8. AGENTS.md Governance

`AGENTS.md` is the front door, not the whole knowledge base.

### The 80% rule

Put something in `AGENTS.md` only if removing it would hurt 80% or more of sessions.

| AGENTS.md | Knowledge system |
|-----------|------------------|
| Project identity | Module notes |
| Build and test commands | Rare debugging flows |
| Top invariants | Full domain rules |
| Top anti-patterns | Incident notes |
| Where to start table | Full file inventory |

### Coding discipline rules and activation

| Rule | Activates when |
|------|----------------|
| Think before coding | The request has ambiguity or risk |
| Simplicity first | The solution starts growing branches |
| Surgical changes | Editing existing code |
| Goal driven execution | Fixing bugs or adding features |
| Context familiarity | Entering a new subsystem |
| Infrastructure verification | Touching external systems |

### The activation sentence

```text
If you cannot cite the specific file or line that governs the behavior you're about to change, you don't know enough yet.
```

Daily meaning: read the relevant domain file or source before editing.

## 9. Knowledge Writing Rules

### Confidence requirements

All AI generated knowledge starts as `observed`.

```text
observed: seen once
verified: supported by two or more sources
canonical: stable and human approved
```

### Evidence requirements

Every non-trivial claim needs a source.

```markdown
- API tokens use constant time comparison. [source: src/auth/token.rs:88]
```

Avoid unsupported claims like `The auth system is secure.`

### Scope requirements

Write the narrowest true claim. Prefer `this module`, `this route`, or `this workflow` unless the whole project was checked.

### Open Questions requirement

Domain and reference files need open questions.

```markdown
## Open Questions

- Is the retry limit public API behavior or an implementation detail?
```

## 10. Common Scenarios

### I fixed a bug and learned something

Write an inbox entry, cite the source, then state `Capture: inbox (...)`.

### I'm working in a module I've never touched

Read `AGENTS.md`, read the domain file, read the governing source, then edit.

### The inbox has 20 entries

Say:

```text
Evolve the knowledge base.
```

Expect grouping, promotion, archiving, manifest updates, and unresolved questions.

### A convention is used in 5+ files

Capture the pattern, verify it in at least two files, promote it during evolution, and add it to `AGENTS.md` only if most sessions need it.

### I keep doing the same 6-step process

Say:

```text
Crystallize this workflow.
```

The result should become a checklist under `.agents/knowledge/crystallized/`, then graduate to a skill only after repeated successful use.
