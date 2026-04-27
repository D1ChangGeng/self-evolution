# Architecture

## 1. System Overview

Self-evolution is a knowledge management system for AI coding agents. It gives each project a persistent memory that future sessions can read, update, verify, and retire.

The system exists because coding agents usually start each session without prior project context. Static docs help, but they often lag behind code and don't show which claims are trusted. Self-evolution bridges that gap with file-based knowledge, explicit confidence levels, and a lifecycle that turns raw observations into stable guidance.

The implementation is intentionally simple: a thin `AGENTS.md` router points agents to a hierarchical `.agents/knowledge/` tree. Scope rules inject relevant knowledge when files are touched. Hooks provide deterministic reminders. Evolution sessions compress, verify, promote, or retire knowledge as it ages.

## 2. Architecture Diagram

```text
AGENTS.md (thin router, ~150 lines)
    ↓ routes to
.agents/knowledge/
    ├── inbox/         ← Capture (every session)
    ├── domains/       ← Organized knowledge
    ├── reference/     ← Stable docs
    ├── decisions/     ← ADRs
    ├── patterns/      ← Verified conventions
    ├── crystallized/  ← Executable workflows
    └── archive/       ← Retired knowledge
.agents/rules/         ← Scope-triggered discovery
.agents/hooks/         ← Deterministic automation
```

## 3. Data Flow

```text
Session starts
    ↓
Read AGENTS.md
    ↓
Route to relevant domain, reference, pattern, or decision files
    ↓
Work happens
    ↓
Scope rules push relevant knowledge at point of need
    ↓
Task completes
    ↓
POST-TASK CHECKLIST decides whether capture is needed
    ↓
Capture protocol writes inbox before reporting completion
    ↓
Hooks fire on lifecycle events
    ↓
session-end reminder, stop health check, compact recovery
    ↓
User triggers evolve
    ↓
Inbox compressed, knowledge verified, items promoted or archived, health scored
```

Operational flow:

1. **Session start**: The agent reads `AGENTS.md`, checks `manifest.json`, and follows the Where to Look routing table.
2. **Scoped work**: Files touched during work match `.agents/rules/` entries. Those rules point to relevant knowledge files without loading the whole system.
3. **Task completion**: The post-task checklist checks whether the session found a fact, hidden assumption, decision, pattern, correction, or incident worth saving.
4. **Capture**: Worth-saving observations are appended to `inbox/{YYYY-MM}.md` immediately, before the agent claims completion.
5. **Hooks**: Hook scripts add deterministic reminders and health checks independent of model behavior.
6. **Evolution**: On explicit user request, raw inbox entries are grouped, deduplicated, associated with existing topics, verified where possible, promoted when mature, compressed into stable files, or archived when retired.

## 4. File Roles

| File or directory | Stores | Written by | Change frequency | Confidence level |
|---|---|---|---|---|
| `AGENTS.md` | Project identity, session protocol, high-value routing, canonical rules | Agent, with human review for canonical additions | Low to medium | Canonical only |
| `.agents/knowledge/manifest.json` | Inventory, health metrics, stale candidates, inbox counts, evolution cadence | Scaffold script, evolution process, health checks | Medium | Metadata, not factual knowledge |
| `.agents/knowledge/README.md` | Local explanation of the knowledge system and reading protocol | Scaffold script, rare manual update | Low | Canonical for system usage |
| `.agents/knowledge/inbox/` | Raw observations, corrections, incidents, session-end reminders | Every agent session and hooks | High | Observed |
| `.agents/knowledge/domains/` | Organized knowledge by project area, including invariants, mistakes, facts, open questions | Evolution sessions, agents during domain corrections | Medium | Observed or verified |
| `.agents/knowledge/reference/` | Stable reference docs, code maps, route tables, architecture notes | Agents during initialization or explicit documentation work | Low to medium | Verified preferred |
| `.agents/knowledge/decisions/` | ADRs and explicit architectural or operational choices | Agents after a decision is made, usually with human input | Low | Verified or canonical |
| `.agents/knowledge/patterns/` | Reusable conventions verified across contexts | Evolution sessions after promotion criteria pass | Low | Verified |
| `.agents/knowledge/crystallized/` | Repeatable workflows with prerequisites, steps, decision points, verification | Agents after repeated workflow refinement | Low to medium | Verified, skill candidates only after repeated use |
| `.agents/knowledge/archive/` | Superseded, retired, or compressed historical knowledge | Evolution sessions | Medium | Historical, not active guidance |
| `.agents/rules/` | Scope-triggered discovery rules keyed to file globs or task areas | Initialization and later knowledge tuning | Medium | Routing metadata |
| `.agents/hooks/` | Lifecycle automation scripts and adapter configs | Scaffold or hook installer | Low | Operational code |
| `references/EVOLUTION-SPEC.md` | Design dimensions and change triggers for the skill itself | Skill maintainers | Low | Canonical for skill meta-design |

## 5. Knowledge Lifecycle

```text
Discovery → Capture → Dedup → Association → Retrieval → Verification → Promotion → Compression → Staleness → Retirement
```

| Stage | Purpose | Output |
|---|---|---|
| Discovery | The agent notices a fact, pattern, issue, or decision during real work. | Candidate knowledge |
| Capture | The observation is written before it is lost. | Inbox entry |
| Dedup | Related entries are grouped and repeated claims are merged. | Themed cluster |
| Association | Clusters are attached to existing domains, reference files, decisions, or patterns. | Updated active knowledge file |
| Retrieval | Future sessions find the knowledge through `AGENTS.md`, rules, manifest inventory, or search. | Applied guidance |
| Verification | Claims are checked against code, tests, docs, or multiple sources. | Confidence upgrade or correction |
| Promotion | Mature knowledge moves from inbox or domain notes into patterns, decisions, crystallized workflows, or `AGENTS.md`. | Higher-trust artifact |
| Compression | Raw detail is summarized while preserving exceptions and source trails. | Smaller active knowledge set |
| Staleness | Old or source-mismatched knowledge is flagged for review. | Stale candidate or correction |
| Retirement | Superseded or wrong knowledge is moved out of the active path. | Archived historical record |

The lifecycle prevents two failure modes: losing useful observations because they were never captured, and trusting old text because it remained visible after the project changed.

## 6. Confidence Model

```text
observed → verified → canonical
```

| Level | Meaning | Evidence requirement | Allowed locations |
|---|---|---|---|
| `observed` | Seen once, inferred from one source, or captured during a session. Useful, but tentative. | One cited source or a clear session observation. | Inbox, domains, archive |
| `verified` | Checked against code, tests, authoritative docs, or two independent sources. Safe to rely on for scoped work. | Two corroborating sources, or direct verification against current source plus date. | Domains, reference, decisions, patterns, crystallized |
| `canonical` | Treated as source of truth for the project or system. Changes require explicit review. | Human approval or stable project governance decision, with sources. | `AGENTS.md`, stable governance docs, some decisions |

Rules:

1. All AI-generated knowledge starts as `observed`.
2. Promotion is based on evidence, not model confidence.
3. Every non-trivial claim needs a source trail.
4. Conflicts are surfaced explicitly. The system doesn't silently pick one side.
5. Age alone doesn't retire knowledge. Age triggers review.

## 7. Layered Attention Defense

Agents forget instructions, especially after long work or context compression. Self-evolution uses multiple layers so one missed instruction doesn't break the system.

| Layer | Mechanism | Attention problem addressed |
|---|---|---|
| 1 | `AGENTS.md` activation sentence and CODING DISCIPLINE | Primacy. The first file read sets default behavior. |
| 2 | POST-TASK CHECKLIST with write-first capture | Recency. The last step before completion forces capture while facts are fresh. |
| 3 | Scope-triggered rules | On-demand injection. Relevant knowledge appears when matching files or domains are touched. |
| 4 | Hooks | Deterministic enforcement. Scripts run even if the model forgets. |
| 5 | Compact recovery | Post-compression re-injection. The agent is reminded to re-read `AGENTS.md` after context loss. |

This defense is additive. The hooks don't replace agent discipline, and `AGENTS.md` doesn't replace scoped rules.

## 8. Script Architecture

### `init-scaffold.sh`

`init-scaffold.sh` creates the deterministic base structure:

```text
.agents/knowledge/{inbox,domains,reference,decisions,patterns,crystallized,archive}
.agents/rules/
.agents/hooks/
AGENTS.md when mode=empty
README.md, manifest.json, templates, and starter governance files
```

Design choices:

- POSIX shell for broad compatibility.
- Heredoc embedding for template content, so the scaffold is self-contained.
- Idempotent create behavior: existing directories and files are skipped rather than overwritten.
- Two modes: `empty` can create root `AGENTS.md`; `existing` creates the scaffold while leaving project-specific synthesis to the agent.
- Project name and timestamp are inserted once during scaffold creation.

### `scan-project.sh`

`scan-project.sh` collects deterministic project metadata before the LLM performs deeper analysis:

- project name and Git remote
- primary language signal
- common manifest files
- top-level directory structure
- file counts and extension counts
- test, docs, CI, build, and workflow signals
- existing agent or AI instruction files

The script has a zero-dependency design. It uses standard shell tools and tolerates missing optional commands. The report gives the agent a factual starting point without requiring broad exploratory reads.

### Hook scripts

Hook scripts use a tool-agnostic core plus adapter pattern.

| Script | Core behavior | Adapter role |
|---|---|---|
| `session-end.sh` | Reads hook payload from stdin, extracts a session id when present, appends a reminder to the monthly inbox. | Tool config decides when to run it. |
| `stop.sh` | Reads `manifest.json`, checks `inbox_count` and `days_since_evolution`, prints a warning when thresholds are exceeded. | Tool config attaches it to stop or completion events. |
| `compact-recovery.sh` | Re-injects a directive to re-read `AGENTS.md` after context compaction. | Tool support determines whether compact hooks are available. |
| `install-hooks.sh` | Detects Claude Code, Cursor, OpenCode, or Augment and installs scripts plus matching adapter config. | Adapter JSON maps lifecycle events to shell commands. |

All hook scripts are conservative. They should remind, not block. Their default posture is safe failure: print a warning, skip risky merges, and exit cleanly.

## 9. Meta-Evolution

The skill has its own evolution system. `references/EVOLUTION-SPEC.md` acts as the pre-validation index before initialization or major workflow changes.

It tracks 8 design dimensions:

1. Knowledge topology
2. Trust model
3. `AGENTS.md` boundary and routing
4. Artifact contracts
5. Initialization strategy
6. Lifecycle
7. Health and review cadence
8. Hooks and deterministic automation

Each dimension defines:

- the current design choice
- why that choice exists
- a change trigger
- a deep reference to read before changing behavior
- a last-reviewed date

The same-change rule keeps the spec synchronized with implementation. When a script, template, lifecycle doc, hook, or governance section changes, the matching dimension in `EVOLUTION-SPEC.md` must be reviewed in the same change.

Deep references point to existing files such as `philosophy.md`, `lifecycle.md`, `health-check.md`, `init-deep-reference.md`, and `hooks/README.md`. The spec indexes those files instead of duplicating their content, so the system has one place for detailed rationale and one place for change-trigger validation.
