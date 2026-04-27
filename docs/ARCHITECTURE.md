# Architecture

## 1. Current Shape

Self-Evolution is a four-layer system for project memory, task guidance, skill maintenance, and project-specific adaptation. It stores what is true about a project, discovers best-practice skills when work requires them, records improvements to itself, and allows local overrides after review.

This file is factual. Design rationale belongs in `references/philosophy.md`.

## 2. Four-Layer Model

```text
+------------------------------------------------------------------+
| Layer 4: Project Specialization                                  |
| SKILL-LOCAL.md overlay -> candidate -> active override            |
| "How this system adapts to specific project types"               |
+------------------------------------------------------------------+
                               ^
+------------------------------------------------------------------+
| Layer 3: Self-Improvement                                        |
| Mode 7 -> [SKILL-FIX]/[SKILL-IDEA]/[SKILL-COMPAT] -> Radar        |
| "How this system improves itself"                                |
+------------------------------------------------------------------+
                               ^
+------------------------------------------------------------------+
| Layer 2: Task Execution Wisdom                                   |
| find-skills -> detected technologies -> skills.pending_review     |
| "What best practices exist for this type of work"                |
+------------------------------------------------------------------+
                               ^
+------------------------------------------------------------------+
| Layer 1: Project Knowledge                                       |
| AGENTS.md -> domains/ -> inbox/ -> patterns/                     |
| "What is true about this project"                                |
+------------------------------------------------------------------+
```

| Layer | Main artifacts | Main output |
|---|---|---|
| 1. Project Knowledge | `AGENTS.md`, `domains/`, `inbox/`, `patterns/` | Project facts and decisions |
| 2. Task Execution Wisdom | `find-skills`, scan output, `skills.pending_review` | Skill suggestions for current work |
| 3. Self-Improvement | Mode 7, skill tags, Capability Radar | Repairs and future skill work |
| 4. Project Specialization | `SKILL-LOCAL.md`, candidates, active overrides | Reviewed local behavior changes |

## 3. Layer 1: Project Knowledge

Layer 1 stores project-specific truth.

```text
AGENTS.md
  -> domains/
  -> inbox/
  -> patterns/
```

| Artifact | Role | Confidence posture |
|---|---|---|
| `AGENTS.md` | Thin router, project identity, high-value invariants | Canonical summaries |
| `domains/` | Organized knowledge by subsystem or work area | Observed or verified |
| `inbox/` | Raw captures, corrections, incidents, reminders | Observed |
| `patterns/` | Repeated conventions after evidence accumulates | Verified |
| `reference/` | Stable maps, inventories, route lists | Verified preferred |
| `decisions/` | Choices that constrain future work | Verified or canonical |
| `crystallized/` | Repeatable workflows | Verified |
| `archive/` | Retired or superseded material | Historical |

Layer 1 doesn't store generic framework practice. That belongs to Layer 2.

## 4. Layer 2: Task Execution Wisdom

Layer 2 discovers best-practice skills for the current task and detected technologies.

```text
scan-project.sh
  -> detected technologies
  -> find-skills
  -> manifest.json skills.pending_review
  -> user confirmation at boundary
```

Only two skills are referenced by name.

| Skill | Role |
|---|---|
| `find-skills` | Runtime discovery of task-specific skills |
| `skill-creator` | Creation or improvement of skills after repeated workflow evidence |

All other skill lookup is delegated to `find-skills`. The manifest key `skills.pending_review` is a write-ahead queue for suggestions that need user approval before install or use.

## 5. Layer 3: Self-Improvement

Layer 3 records and processes improvements to Self-Evolution itself.

```text
skill issue found during work
  -> inbox tag
  -> Mode 7 triage
  -> repair, reject, defer, or Capability Radar
```

| Tag | Meaning | Mode 7 action |
|---|---|---|
| `[SKILL-FIX]` | Current behavior is wrong or incomplete | Repair or investigate |
| `[SKILL-IDEA]` | Possible new capability | Evaluate scope and overlap |
| `[SKILL-COMPAT]` | Tool or platform compatibility issue | Update scripts, hooks, or docs |

The Capability Radar tracks gaps and deferred improvements after triage.

## 6. Layer 4: Project Specialization

Layer 4 adapts behavior for a project type without changing core invariants.

```text
patterns/ + crystallized/
  -> Mode 4 detects project-specific pattern
  -> candidate in SKILL-LOCAL.md
  -> Mode 7 review
  -> active override or rejection
```

| State | Meaning | Affects behavior? |
|---|---|---|
| Evidence | Repeated facts or workflows | No |
| Candidate | Proposed local behavior in `SKILL-LOCAL.md` | No |
| Active Override | Reviewed project-specific override | Yes |
| Rejected | Reviewed and declined | No |

| Active overrides can change | Active overrides can't change |
|---|---|
| Capture conditions | Architectural invariants |
| Health thresholds | Confidence ladder |
| Promotion criteria | Write-first capture |
| Project-type defaults | Hook independence |

## 7. Attention Defense Layers

The system protects attention with prompt placement, scope routing, and deterministic hooks.

| # | Layer | Timing | Purpose |
|---|---|---|---|
| 1 | Activation sentence, "bias toward caution over speed" | Session start | Primacy |
| 2 | Context Familiarity rule | Domain transitions only | Stop false confidence |
| 3 | Write-first capture plus `Capture:` statement | Task end | Recency |
| 4 | Scope-triggered rules | During work | On-demand injection |
| 5 | `stop.sh`, `session-end.sh` | Lifecycle events | LLM-independent checks |
| 6 | `compact-recovery.sh` | After compaction | Re-inject routing directive |

```text
SessionStart
  -> AGENTS.md activation sentence
  -> Context Familiarity check on domain changes
  -> scope-triggered rules during work
  -> write-first capture at task end
  -> hooks run outside model memory
  -> compact recovery if context is compressed
```

## 8. Main Data Flow

```text
Session starts
  -> reads AGENTS.md
  -> routes to domain files
  -> work happens
  -> scope rules push relevant knowledge
  -> task completes
  -> write-first capture
  -> inbox
  -> "Capture:" statement
```

Branches from captured entries:

```text
[DOMAIN-FIX]  -> deferred to task end -> batch apply
[SKILL-FIX]   -> deferred to Mode 7
[SKILL-IDEA]  -> deferred to Mode 7
[SKILL-COMPAT]-> deferred to Mode 7
```

Lifecycle events:

```text
Session ends     -> session-end.sh       -> inbox reminder
Stop event       -> stop.sh              -> manifest health check
Context compacted-> compact-recovery.sh  -> re-read AGENTS.md directive
```

User-triggered maintenance:

```text
User triggers evolve
  -> inbox compressed
  -> knowledge promoted
  -> health scored

User triggers skill maintenance
  -> [SKILL-FIX/IDEA/COMPAT] triaged
  -> repairs applied
  -> Capability Radar updated
```

## 9. EVOLUTION-SPEC Dual Architecture

`EVOLUTION-SPEC.md` has a distributable root copy and a local working copy.

```text
Root EVOLUTION-SPEC.md
  -> distributable template, about 130 lines
  -> copied on first use
  -> never modified after distribution

references/EVOLUTION-SPEC.md
  -> local working copy
  -> gains Backlog + Review Log
  -> gitignored and user-local
```

| File | Role | Mutation rule |
|---|---|---|
| Root `EVOLUTION-SPEC.md` | Distributed template | Never modified after distribution |
| `references/EVOLUTION-SPEC.md` | Local operating spec | May gain Backlog and Review Log |

## 10. Confidence Model

```text
observed (seen once) -> verified (2+ sources) -> canonical (human-approved)
```

| Level | Evidence | Typical location |
|---|---|---|
| `observed` | One session, one source, or one inference | `inbox/`, `domains/` |
| `verified` | Two sources or current-source verification | `domains/`, `reference/`, `patterns/` |
| `canonical` | Human-approved or governance-level decision | `AGENTS.md`, decisions |

Rules:

1. All AI-generated knowledge starts as `observed`.
2. Promotion is based on evidence.
3. Conflicts are surfaced, not silently resolved.
4. Local specialization can't override architectural invariants.

## 11. Script Architecture

| Script | Current size | Role |
|---|---:|---|
| `init-scaffold.sh` | 571 lines | Creates directories, boilerplate, hooks, and `AGENTS.md` |
| `scan-project.sh` | 325 lines | Collects structural metadata and detected technologies |

`init-scaffold.sh` creates:

```text
.agents/
  knowledge/
    inbox/
    domains/
    reference/
    decisions/
    patterns/
    crystallized/
    archive/
  rules/
  hooks/
AGENTS.md
```

`scan-project.sh` collects project name, repository metadata, language signals, framework signals, manifest files, tests, docs, CI, build signals, directory summaries, extension counts, and detected technologies for Layer 2.

## 12. Hook Architecture

Hooks use tool-agnostic scripts with tool-specific adapter JSON.

```text
tool lifecycle event
  -> adapter JSON
  -> tool-agnostic script
  -> reminder, health check, or recovery directive
```

| Script | Event | Behavior |
|---|---|---|
| `session-end.sh` | `SessionEnd` | Appends inbox reminder |
| `stop.sh` | `Stop` | Checks manifest health |
| `compact-recovery.sh` | `SessionStart`, matcher `compact` | Prints re-read directive |

Hooks remind and check. They don't make unsafe edits, and they don't replace write-first capture.

## 13. Meta-Skill Architecture

```text
Self-Evolution skill
  -> find-skills for discovery
  -> skill-creator for creation
  -> runtime-discovered task skills for everything else
```

| Concern | Mechanism |
|---|---|
| Discover task skills | `find-skills` |
| Create or improve skills | `skill-creator` |
| Avoid hard-coded skill lists | Delegate discovery at runtime |
| Avoid surprise installs | Queue in `skills.pending_review` |
| Capture skill bugs | `[SKILL-FIX]` |
| Capture skill ideas | `[SKILL-IDEA]` |
| Capture compatibility issues | `[SKILL-COMPAT]` |

## 14. Stable Invariants

| Invariant | Area |
|---|---|
| AI-generated knowledge starts as `observed` | Confidence model |
| Inbox entry is written before capture is claimed | Capture protocol |
| `Capture:` is stated after the post-task decision | Attention defense |
| Skill repair tags defer to Mode 7 | Self-improvement |
| `find-skills` handles runtime skill discovery | Task wisdom |
| `skill-creator` handles skill creation | Meta-skill architecture |
| Root `EVOLUTION-SPEC.md` is not modified after distribution | EVOLUTION-SPEC |
| `references/EVOLUTION-SPEC.md` is local and may gain logs | EVOLUTION-SPEC |
| Active overrides can't change architectural invariants | Specialization |
| Hooks stay deterministic and LLM-independent | Hook architecture |
