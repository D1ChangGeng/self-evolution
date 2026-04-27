# Self-Evolution Skill Usage Guide

Practical guide for using the `self-evolution` skill. It covers seven explicit modes plus ambient capture.

Use from the project root.

## Mode map

| Mode | Name | Use when |
|---|---|---|
| 1 | Initialize empty project | No real code exists yet |
| 2 | Initialize existing project | Code, docs, config, or tests already exist |
| 3 | Capture, ambient | Work reveals knowledge worth keeping |
| 4 | Evolve | Inbox knowledge needs sorting and promotion |
| 5 | Health Check | You need status and priorities |
| 6 | Crystallize | A repeated workflow should become executable knowledge |
| 7 | Skill Maintenance | The skill itself needs repair or improvement |

## Files created

```text
AGENTS.md
.agents/
├── knowledge/
│   ├── README.md
│   ├── manifest.json
│   ├── SKILL-LOCAL.md
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

`SKILL-LOCAL.md` appears when the project has enough evidence for local specialization.

## Mode 1, Initialize empty project

### What to say

```text
Initialize the knowledge base.
```

```text
Set up self-evolution for this new project.
```

### What happens

1. Step 0 runs before setup.
2. The skill reads `references/EVOLUTION-SPEC.md`.
3. If `references/EVOLUTION-SPEC.md` doesn't exist, it copies the root `EVOLUTION-SPEC.md` template into `references/`.
4. It evaluates 9 dimensions: knowledge topology, trust model, AGENTS boundary, artifact contracts, initialization strategy, lifecycle, health cadence, hooks, and project-local specialization.
5. If a change trigger fires, it pauses and reports what needs review.
6. If Step 0 passes, it runs `init-scaffold.sh`.
7. The script creates directories, boilerplate, starter rules, and hooks.
8. It runs `scan-project.sh` to record metadata and detected technologies.
9. It uses detected technologies with `find-skills`.
10. It writes candidates to `manifest.json` under `skills.pending_review`.
11. It creates starter domain files, reference files, and `AGENTS.md` without inventing project facts.
12. It presents the pending review list for batch confirmation.

### Example report

```text
Initialized self-evolution knowledge base.
Step 0: passed 9 dimensions.
Scaffold: created.
Scan: completed.
Pending skill review: none found.
Capture: none, initialization only.
```

If candidates exist:

```text
Pending skill review:
- vue-best-practices, detected Vue files
- vue-testing-best-practices, detected Vitest config

Reply with approved skills, or say "skip skill candidates".
```

## Mode 2, Initialize existing project

### What to say

```text
Initialize the knowledge base for this existing project.
```

```text
Set up project memory here.
```

### What happens

1. Step 0 pre-validation runs first.
2. The skill reads `references/EVOLUTION-SPEC.md`, or copies it from the root template if missing.
3. It evaluates the same 9 dimensions and pauses if a design trigger fires.
4. It runs `init-scaffold.sh` to create directories, boilerplate, hooks, and starter rules.
5. It runs `scan-project.sh` to collect metadata, languages, frameworks, package managers, tests, commands, routes, config files, docs, and deployment files.
6. It uses detected technologies with `find-skills`.
7. It writes discovered candidates to `manifest.json` under `skills.pending_review`.
8. It reads targeted files, usually entry points, manifests, route files, auth, config, migrations, test helpers, deployment files, and existing agent docs.
9. It generates domain files in `.agents/knowledge/domains/`.
10. It generates reference files in `.agents/knowledge/reference/`.
11. It creates or augments `AGENTS.md`.
12. It presents `skills.pending_review` at the end for user batch confirmation.

### Existing AGENTS.md

Existing `AGENTS.md` is augmented, not overwritten. Preserve human instructions, add knowledge routing, and report conflicts instead of hiding them.

### Example report

```text
Initialized existing project knowledge base.
Step 0: passed 9 dimensions.
Scan: Rust, Axum, SQLite, Docker detected.
Generated: 6 domain files, 3 reference files, AGENTS.md routing.

Pending skill review:
- rust-testing, detected Cargo tests
- docker-deployment, detected Dockerfile

Capture: none, initialization only.
```

## Mode 3, Capture, ambient

Capture is automatic during normal work. The agent writes the inbox entry first, then reports the capture decision.

### What to say

```text
Capture what we just learned.
```

```text
That belongs in project knowledge. Save it.
```

### Capture conditions

Capture when:

1. You discovered non-obvious behavior.
2. You fixed a bug that revealed a hidden assumption.
3. You made a decision that constrains future work.
4. You noticed a pattern across multiple files.
5. You found existing knowledge was wrong or incomplete.
6. You found a flaw, missed step, unclear instruction, or compatibility issue in the self-evolution skill.

### Tags

```text
[DOMAIN-FIX: domains/X.md]
[SKILL-FIX:self-evolution]
[SKILL-IDEA:self-evolution]
[SKILL-COMPAT:self-evolution]
```

Use `[DOMAIN-FIX: domains/X.md]` when a domain correction should be batched at task end. Use `[SKILL-FIX:self-evolution]` when the skill itself needs repair.

### Write-first protocol

1. Write to `.agents/knowledge/inbox/YYYY-MM.md` now.
2. Include date, context, observation, and source.
3. Add tags when needed.
4. Then state one capture line.
5. Before final completion, scan this session's inbox entries for `[DOMAIN-FIX]` and apply those domain corrections.

### Capture lines

```text
Capture: none
Capture: inbox (auth refresh retry behavior)
Capture: inbox + [DOMAIN-FIX: domains/deployment.md] (restart rule was wrong)
```

### Example

```markdown
## 2026-04-27 14:20, payment test mock ordering

- Payment client mocks must be registered before importing checkout.ts because the module reads the client at import time.
- [source: tests/checkout.test.ts:18]
```

```text
Capture: inbox (payment client import-time mock requirement)
```

### Skill feedback example

```markdown
## 2026-04-27 16:10, skill missed pending review

- Initialization detected Vue files but didn't add Vue skills to `manifest.json` `skills.pending_review`.
- [SKILL-FIX:self-evolution]
- [source: .agents/knowledge/manifest.json]
```

Examples are illustrative. Adapt file names and sources to the project.

## Mode 4, Evolve

### What to say

```text
Evolve the knowledge base.
```

```text
Compress the inbox and promote stable knowledge.
```

### When to use

Use this when the inbox has more than 10 entries, when the last evolution was more than 14 days ago, when domain files feel stale, or when repeated observations are piling up.

### 9-step process

1. Process inbox entries into clusters.
2. Compress clusters while preserving sources.
3. Verify spot-checks against source files, docs, tests, or commands.
4. Detect staleness in domains, reference files, patterns, and decisions.
5. Resolve conflicts by keeping both sides visible until evidence decides.
6. Evaluate promotions from observed to verified, or verified to canonical when human approval exists.
7. Run specialization detection. If `.agents/knowledge/SKILL-LOCAL.md` exists, read it.
8. Update `manifest.json`.
9. Report processed entries, promotions, conflicts, stale items, and review needs.

### Application tracking

When a pattern is applied or confirmed, increment its counters:

```text
application_count: 4
last_applied: 2026-04-27
```

This helps Mode 6 find workflows worth crystallizing and Mode 7 find local specializations.

### Specialization detection

Project-specific patterns become candidates in `.agents/knowledge/SKILL-LOCAL.md`, not separate skills.

```markdown
## Candidate Specializations

### UI page assembly rule

- Evidence: 4 inbox entries, 3 domain references
- Candidate: Always edit `ui/src/pages/*.html`, never generated `ui/dist/` files.
- Status: candidate
```

### Example report

```text
Evolution complete.
Processed: 18 inbox entries.
Compressed: 6 clusters.
Verified: 4 claims by spot-check.
Promoted: 3 observed to verified, 0 verified to canonical.
Conflicts: 1 kept for review.
Specialization candidates: 1 added to SKILL-LOCAL.md.
Manifest updated.
Capture: none, evolution only.
```

## Mode 5, Health Check

### What to say, quick

```text
Check knowledge base health.
```

### What to say, deep

```text
Run a deep knowledge base health check.
```

### Quick check

Quick checks read indicators only: `manifest.json`, inbox count, last evolution date, pending skill review, and obvious stale markers.

```text
Knowledge health: needs attention.
- inbox_count: 23, high
- days_since_evolution: 19, overdue
- pending_skill_review: 3
Recommended next action: Evolve the knowledge base.
```

### Deep check

Deep checks calculate a full numeric score from 8 weighted metrics.

| Metric | Weight | Checks |
|---|---:|---|
| Inbox load | 15 | Entries waiting for evolution |
| Evolution freshness | 15 | Days since last evolution |
| Domain coverage | 15 | Major areas with domain files |
| Citation coverage | 15 | Claims with source evidence |
| Confidence mix | 10 | Observed, verified, canonical balance |
| Staleness risk | 10 | Old claims likely to be wrong |
| Duplication and conflicts | 10 | Repeated or contradictory entries |
| Reuse pipeline | 10 | Crystallization and specialization candidates |

```text
Knowledge health score: 72/100, fair.
Priority: run Mode 4, then crystallize the release workflow.
```

## Mode 6, Crystallize

### What to say

```text
Crystallize this workflow.
```

```text
Turn the release process into a reusable checklist.
```

### What happens

1. Gather examples from inbox, patterns, domain files, commands, and recent work.
2. Name the trigger phrase.
3. Extract mandatory steps.
4. Separate optional checks.
5. Add verification points.
6. Add common failure cases.
7. Save the workflow under `.agents/knowledge/crystallized/`.
8. Link it from the relevant domain file or AGENTS.md only if future sessions need it.
9. Update `manifest.json` and application tracking.

### Refinement and graduation

Refine the crystallized doc after real use. Graduate it through `skill-creator` only when it is stable, useful outside this repo, executable without hidden context, and tested through repeated use.

```text
Crystallized: .agents/knowledge/crystallized/release-checklist.md
Application tracking: release workflow application_count 5, last_applied 2026-04-27.
Graduation: not ready, still project-specific.
Capture: none, crystallization only.
```

## Mode 7, Skill Maintenance

### What to say

```text
Improve the self-evolution skill.
```

```text
Process skill feedback from the inbox.
```

### Trigger

Run this mode when asked, or when Mode 4 detects 3 or more skill feedback tags: `[SKILL-FIX:self-evolution]`, `[SKILL-IDEA:self-evolution]`, or `[SKILL-COMPAT:self-evolution]`.

### What happens

1. Collect `[SKILL-FIX]`, `[SKILL-IDEA]`, and `[SKILL-COMPAT]` entries from inbox files.
2. Deduplicate overlapping reports.
3. Classify each item as repair, backlog, reject, or needs-evidence.
4. Apply safe, evidenced repairs.
5. Run Capability Radar.
6. Review specialization if `.agents/knowledge/SKILL-LOCAL.md` exists.
7. Update `EVOLUTION-SPEC.md` and `references/EVOLUTION-SPEC.md` when a design dimension changes.
8. Update touched docs, templates, scripts, or skill instructions.
9. Report repairs, backlog, rejected items, evidence gaps, and changed files.

### Capability Radar

Capability Radar is bounded research:

1. Run 3 focused searches.
2. Keep at most 5 candidate improvements.
3. Stop at 30 minutes.
4. Prefer fixes for observed failures.
5. Record rejected ideas briefly.

### Example classification

```text
repair: Mode 1 forgot to copy EVOLUTION-SPEC.md when references/ was missing.
backlog: Add another editor hook after more evidence.
reject: Replace inbox files with a database, conflicts with low-friction capture.
needs-evidence: Health score feels wrong, but no examples were provided.
```

### Example report

```text
Skill maintenance complete.
Collected: 7 skill feedback entries.
Deduplicated: 4 unique items.
Applied repairs: 2.
Backlog: 1.
Rejected: 1.
Needs evidence: 0.
Capability Radar: 3 searches, 5 candidates, 1 accepted.
Specialization review: 2 candidates promoted in SKILL-LOCAL.md.
Updated: EVOLUTION-SPEC.md, docs/USAGE-GUIDE.md.
Capture: inbox ([SKILL-FIX:self-evolution], maintenance results recorded)
```

## Coding discipline

Activation sentence:

```text
bias toward caution over speed, for trivial, local tasks, use judgment
```

Rules:

1. **Think before coding.** State assumptions when risk or ambiguity exists. If multiple interpretations exist, ask or present the tradeoff.
2. **Simplicity first.** Choose the minimum change that solves the task. Don't add speculative configuration, abstraction, or future-proofing.
3. **Surgical changes.** Touch only what the request requires. Match existing style. Mention unrelated issues instead of folding them into the patch.
4. **Goal-driven execution.** Turn the request into a verifiable goal. For a bug, reproduce then fix. For a feature, define expected behavior and verify it.
5. **Context familiarity.** This fires only on domain transitions. If you cannot cite the file/line that governs the behavior, you don't know enough.

## AGENTS.md governance

`AGENTS.md` is the front door, not the whole knowledge base.

### Knowledge Writing Rules

All AI-generated knowledge starts as `observed`, can become `verified` with 2 or more sources, and becomes `canonical` only after human approval. Every non-trivial claim needs evidence, usually `[source: file:line]`, and should use the narrowest true scope. Full writing rules live in `.agents/knowledge/README.md`.

### POST-TASK CHECKLIST

At task end, check the six capture conditions: non-obvious behavior, hidden assumption from a bug, constraining decision, cross-file pattern, wrong or incomplete knowledge, and skill flaw detection. If any condition fires, write the inbox entry first, then state `Capture:`. Apply current-session `[DOMAIN-FIX]` corrections before final completion.

### SELF-EVOLUTION RULES

Keep project knowledge synced with code changes.

| Change | Sync target |
|---|---|
| New endpoint | request lifecycle reference and related domain file |
| New config key | config docs, example config, domain file |
| New deployment step | deployment domain and release checklist |
| New security rule | security domain and scope rule |
| New repeated workflow | pattern file or crystallized workflow |
| New project convention | candidate in `SKILL-LOCAL.md` |

Use project-specific sync targets from `AGENTS.md` when present.

## Project-local specialization

`SKILL-LOCAL.md` lives in `.agents/knowledge/`. It is read by the global skill when present. It is not a separate skill.

### Active Overrides

Active overrides can tune capture conditions, health thresholds, promotion criteria, routing hints, and project-specific sync targets.

```markdown
## Active Overrides

### Capture Conditions
- Always capture production deployment incidents.

### Health Thresholds
- Suggest evolution when inbox_count > 6.

### Promotion Criteria
- Deployment rules need one code source and one runbook source before verified.
```

### Candidate Specializations

Candidates collect evidence until Mode 7 promotes or rejects them.

```markdown
## Candidate Specializations

### API route documentation sync
- Evidence: 5 captured endpoint changes required docs updates.
- Proposed override: New endpoint changes update `reference/request-lifecycle.md`.
- Status: candidate
```

Architectural invariants cannot be overridden. Local specialization can't remove evidence requirements, skip write-first capture, bypass confidence levels, or replace the lifecycle.

## Common scenarios

### I fixed a bug and learned something

Write the inbox entry first, cite the source, then state `Capture: inbox (...)`.

### I'm working in an unfamiliar module

Use Context Familiarity. Read `AGENTS.md`, the relevant domain file, and the governing source. If you can't cite the file or line, you don't know enough yet.

### The inbox has 20 entries

Say `Evolve the knowledge base.` Expect clustering, compression, verification, promotions, stale entry handling, specialization detection, and a manifest update.

### The skill missed a step

Capture it with `[SKILL-FIX:self-evolution]`. When 3 or more skill feedback tags accumulate, run Mode 7.

### I keep doing the same workflow

Say `Crystallize this workflow.` The result should become a checklist in `.agents/knowledge/crystallized/`, then graduate through `skill-creator` only after repeated successful use.

### I found a useful skill while working

Add it to `manifest.json` under `skills.pending_review` with the reason. Present the list at task end for batch confirmation instead of installing silently.

### This project has unique conventions

Capture examples first. During Mode 4, add a candidate to `SKILL-LOCAL.md`. During Mode 7, promote it if evidence is strong and it doesn't violate architectural invariants.
