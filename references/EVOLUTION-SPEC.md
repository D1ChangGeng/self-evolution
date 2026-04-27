# Self-Evolution Skill — Evolution Specification

This file is the **pre-validation index** for the skill itself. Before every Mode 1 or Mode 2 initialization, evaluate each dimension below against your current knowledge. If any dimension's change trigger fires, read the linked deep reference before proceeding.

```
version: 1.1
last_reviewed: 2026-04-25
review_cycle: Every major use OR every 60 days
```

## How to Use This File

1. Read each dimension's **Change Trigger**.
2. Ask: "Based on my current knowledge, has anything changed that fires this trigger?"
3. Ask: "Does this specific project have needs that challenge this choice?"
4. If ALL dimensions pass → proceed to initialization.
5. If ANY trigger fires → read the linked **Deep Reference**, evaluate, propose changes to user.
6. Log any changes in the Review Log at the bottom.

If a dimension's `last_reviewed` exceeds 60 days AND you have reason to believe the field has advanced, force a deep review even if no trigger explicitly fires.

---

## Dimensions

### 1. Knowledge Topology
<!-- anchor: knowledge-topology -->

**Current choice**: 7 directories (inbox, domains, reference, decisions, patterns, crystallized, archive) under `.agents/knowledge/`. Flat hierarchy — no nesting within directories.

**Rationale**: Mirrors the knowledge lifecycle stages. Flat enough to avoid taxonomy burden (philosophy.md §6 "Knowledge must be allowed to die", §2 "Delayed structuring").

**Change trigger**: A new knowledge type emerges that doesn't fit any existing directory AND causes repeated misplacement across 3+ projects.

**Deep reference**: [philosophy.md — §Low friction over perfect structure, §Delayed structuring over pre-classification](philosophy.md)

**Last reviewed**: 2026-04-25

---

### 2. Trust Model
<!-- anchor: trust-model -->

**Current choice**: 3 confidence levels (observed → verified → canonical). All AI-generated knowledge starts as `observed`. Promotion requires evidence, not confidence.

**Rationale**: Minimum viable trust ladder. More levels add complexity without proportional benefit. The Trust Gap (philosophy.md §The Three Gaps) is the most insidious gap — this model addresses it structurally rather than relying on author discipline.

**Change trigger**: Evidence that 3 levels cause harmful conflation (e.g., `verified` being used for things that should be distinguished), OR LLM self-calibration capabilities advance enough to support finer-grained trust.

**Deep reference**: [philosophy.md — §Trust Gap, §Confidence must be visible](philosophy.md)

**Last reviewed**: 2026-04-25

---

### 3. AGENTS Boundary & Routing
<!-- anchor: agents-boundary -->

**Current choice**: Thin router AGENTS.md (~150-250 lines) with the 80% rule: if removing content degrades 80%+ of sessions, it belongs in AGENTS.md. Scope-triggered rules in `.agents/rules/` push knowledge discovery to point-of-need via glob-matched frontmatter.

**Rationale**: Every session reads AGENTS.md. Bloat wastes context budget. Scope-triggered rules distribute knowledge loading across files instead of front-loading everything (philosophy.md §Structure serves retrieval).

**Change trigger**: Context windows grow so large that the 80% threshold shifts materially, OR AI tools gain native scope-aware knowledge loading that makes `.agents/rules/` redundant.

**Deep reference**: [philosophy.md — §Entry point failure, §Structure serves retrieval](philosophy.md)

**Last reviewed**: 2026-04-25

---

### 4. Artifact Contracts
<!-- anchor: artifact-contracts -->

**Current choice**: Domain files have 7 required sections (Core Invariants, Conventions, Common Mistakes, Verified Facts, Working Understanding, Open Questions, Related). AGENTS.md has 5 governance sections (SESSION START, CODING DISCIPLINE, POST-TASK CHECKLIST, SELF-EVOLUTION RULES, Knowledge Writing Rules) that are canonical from day one.

**Rationale**: Separates fact from interpretation (Verified Facts vs Working Understanding). Separates rules from observations (Core Invariants vs Conventions). The governance sections define the system itself, not project facts — they must be stable.

**Change trigger**: Sections consistently left empty across multiple projects (section is unnecessary), OR sections consistently overstuffed (section needs splitting), OR new failure modes emerge that existing governance sections don't prevent.

**Deep reference**: [philosophy.md — §The system must be self-describing](philosophy.md), [SKILL.md — §Anti-Overconfidence Rules, §Root AGENTS.md Governance](../SKILL.md)

**Last reviewed**: 2026-04-25

---

### 5. Initialization Strategy
<!-- anchor: initialization-strategy -->

**Current choice**: POSIX shell scripts create deterministic scaffold (`init-scaffold.sh` for structure + boilerplate, `scan-project.sh` for structural metadata). LLM then generates only project-specific content. Step 0 pre-validation (this file) runs before the scripts.

**Rationale**: Two-script approach separates structure creation (deterministic) from project analysis (deterministic metadata collection). Eliminates ~500 lines of predetermined content generation AND ~500 tokens of LLM tool-use overhead for basic project facts.

**Change trigger**: LLM tool-use becomes deterministic enough that scripting is unnecessary, OR the scaffold content itself needs project-specific adaptation that a static script can't handle.

**Deep reference**: [init-deep-reference.md](init-deep-reference.md)

**Last reviewed**: 2026-04-25

---

### 6. Lifecycle
<!-- anchor: lifecycle -->

**Current choice**: 6-stage lifecycle: capture → compress → verify → promote → crystallize → retire. Each stage has structural enforcement (inbox for capture, domains for compression, patterns for promotion, crystallized for crystallization, archive for retirement). Staleness thresholds: domains 60 days, reference/patterns 90 days.

**Rationale**: Models real knowledge evolution without skipping stages. Skip any stage and the system degrades (philosophy.md §Knowledge Has a Lifecycle). The lifecycle is the primary defense against zombie knowledge.

**Change trigger**: A stage proves consistently skipped or bottlenecked across multiple projects, OR new research identifies a missing lifecycle stage.

**Deep reference**: [lifecycle.md](lifecycle.md), [philosophy.md — §Knowledge Has a Lifecycle](philosophy.md)

**Last reviewed**: 2026-04-25

---

### 7. Health & Review Cadence
<!-- anchor: health-review -->

**Current choice**: 8 health metrics with weighted scoring (0-100). Quick health check reports indicators without numeric score. Deep health check computes full score. Triage priority: conflicts → stale verified/canonical → inbox compression → coverage gaps → stale observed.

**Rationale**: Health scoring makes knowledge quality measurable and actionable. Triage ordering addresses the most dangerous degradation modes first (conflicts actively mislead, stale high-confidence knowledge is worse than stale low-confidence).

**Change trigger**: Health metrics prove uncorrelated with actual knowledge quality (a high score doesn't predict useful knowledge), OR new degradation patterns emerge that no existing metric detects.

**Deep reference**: [health-check.md](health-check.md)

**Last reviewed**: 2026-04-25

---

### 8. Hooks & Deterministic Automation
<!-- anchor: hooks-automation -->

**Current choice**: POSIX sh hook scripts (`session-end.sh`, `stop.sh`) in `.agents/hooks/`, wired to tool lifecycle events via adapter JSON configs. Supports Claude Code, Cursor, OpenCode, Augment Code. Hook scripts are tool-agnostic; adapter configs are tool-specific. `install-hooks.sh` auto-detects tool and installs appropriate adapter.

**Rationale**: The POST-TASK CHECKLIST and SESSION START checks rely on LLM compliance (probabilistic). Hooks provide deterministic enforcement — `session-end.sh` always appends a capture reminder, `stop.sh` always checks manifest health. This complements rather than replaces the LLM-driven protocol.

**Change trigger**: AGENTS.md spec standardizes lifecycle commands (Issue #167 `bootstrap`/`post-chat`), making tool-specific adapters unnecessary. OR hook event support converges further across tools, enabling a single universal config format.

**Deep reference**: [hooks/README.md](hooks/README.md), [AGENTS.md spec Issue #167](https://github.com/agentsmd/agents.md/issues/167)

**Last reviewed**: 2026-04-25

---

### 9. Project-Local Specialization
<!-- anchor: project-local-specialization -->

**Current choice**: SKILL-LOCAL.md overlay pattern — project-local skill wraps global skill, specializations accumulate as explicit overrides (additional capture conditions, health thresholds, promotion criteria). Candidates discovered during Mode 4, promoted during Mode 7. Architectural invariants (lifecycle, confidence model, filesystem contract) cannot be overridden.

**Rationale**: Like LLM fine-tuning — base model stays general, per-project data shapes domain-specific behavior. Overlay pattern prevents forking while enabling meaningful adaptation. Evidence-gated promotion prevents over-specialization.

**Change trigger**: Project-local specializations prove insufficient (need deeper structural changes), OR portable specialization packs become needed across multiple same-type projects.

**Deep reference**: [SKILL.md — §Project-Local Specialization](../SKILL.md), [templates/skill-local-template.md](templates/skill-local-template.md)

**Last reviewed**: 2026-04-27

---

## Known Improvement Backlog

Items identified but not yet implemented. Evaluate during pre-validation — if your current capabilities can address any of these, propose the improvement.

**Intake protocol**: Items enter this backlog only through Skill Maintenance Mode (Mode 7). Raw observations stay in project inboxes until triaged.

**Classification**:
- `repair` — concrete fix, bounded scope, prioritize
- `backlog` — valid but needs design work or more evidence
- `reject` — decided against, with documented reason

**Capability Radar budget** (when evaluating `[SKILL-IDEA]` or `[SKILL-COMPAT]` items):
- Max 3 external skill searches
- Max 5 candidate techniques evaluated
- Max 30 minutes total
- Each candidate: adopt / defer / reject with 1-line reason
- No adoption unless tied to a captured failure, eval gap, or explicit user goal

**Current backlog**:
- (none yet — this section fills as Mode 7 processes skill feedback from project inboxes)

---

## Same-Change Rule

When any of these files change, the relevant dimension in this spec MUST be updated in the same change:

| File changed | Update dimension |
|---|---|
| `SKILL.md` Mode 1/2 | §5 Initialization Strategy |
| `references/scripts/init-scaffold.sh` | §5 Initialization Strategy |
| `references/scripts/scan-project.sh` | §5 Initialization Strategy |
| `references/hooks/*` | §8 Hooks & Deterministic Automation |
| `references/templates/*` | §4 Artifact Contracts |
| `references/philosophy.md` | §1, §2, §3 (whichever applies) |
| `references/lifecycle.md` | §6 Lifecycle |
| `references/health-check.md` | §7 Health & Review Cadence |

---

## Review Log

### v1.4 — 2026-04-27
- Added §9 Project-Local Specialization dimension for SKILL-LOCAL.md overlay pattern.
- Expanded from 8 to 9 dimensions.

### v1.3 — 2026-04-27
- Added Skill Feedback Capture protocol (SKILL-FIX/SKILL-IDEA/SKILL-COMPAT tags).
- Added Mode 7: Skill Maintenance with Capability Radar budget.
- Added intake protocol and classification rules to Improvement Backlog.
- Added skill feedback capture condition to POST-TASK CHECKLIST templates.

### v1.2 — 2026-04-25
- Added §8 Hooks & Deterministic Automation dimension for lifecycle hook system.
- Updated §5 Initialization Strategy to reflect two-script approach (init-scaffold + scan-project).
- Added scan-project.sh and hooks/* to Same-Change Rule table.
- Integrated 7 industry improvements from competitive analysis (8 skills, 10 web sources, 4 research papers).

### v1.1 — 2026-04-25
- Added Initialization Strategy dimension (§5) for new scaffold script approach.
- Consolidated from 8 to 7 dimensions per Oracle architectural review.
- Merged: AGENTS.md Scope + Scope-Triggered Rules → §3 AGENTS Boundary & Routing.
- Merged: Template Sections + Governance Sections → §4 Artifact Contracts.
- Renamed: Scaffold Script Approach → Initialization Strategy (broader scope).

### v1.0 — 2026-04-25
- Initial specification. All dimensions reviewed against 15+ competitor tools.
- Validated through Alpha project restructuring (1447→225 line AGENTS.md + 20 knowledge files).
