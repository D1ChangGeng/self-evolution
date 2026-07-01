# Self-Evolution Skill — Evolution Specification

This file defines the design dimensions and change triggers for the self-evolution skill. It is the pre-validation checkpoint read during Step 0 of Mode 1 and Mode 2.

On first use, this file is copied to `references/EVOLUTION-SPEC.md` where it gains user-specific sections (Known Improvement Backlog, Review Log). Step 0 reads from `references/EVOLUTION-SPEC.md`, not this file.

```
version: 1.4
review_cycle: Every major use OR every 60 days
```

## How to Use This File

1. Read each dimension's **Change Trigger**.
2. Ask: "Based on my current knowledge, has anything changed that fires this trigger?"
3. Ask: "Does this specific project have needs that challenge this choice?"
4. If ALL dimensions pass → proceed to initialization.
5. If ANY trigger fires → read the linked **Deep Reference**, evaluate, propose changes to user.
6. Log any changes in the Review Log (in `references/EVOLUTION-SPEC.md`).

If a dimension's `last_reviewed` exceeds 60 days AND you have reason to believe the field has advanced, force a deep review even if no trigger explicitly fires.

---

## Dimensions

### 1. Knowledge Topology

**Current choice**: 7 directories (inbox, domains, reference, decisions, patterns, crystallized, archive) under `.agents/knowledge/`. Flat hierarchy — no nesting within directories.

**Change trigger**: A new knowledge type emerges that doesn't fit any existing directory AND causes repeated misplacement across 3+ projects.

**Deep reference**: [philosophy.md](references/philosophy.md)

---

### 2. Trust Model

**Current choice**: 3 confidence levels (observed → verified → canonical). All AI-generated knowledge starts as `observed`. Promotion requires evidence, not confidence.

**Change trigger**: Evidence that 3 levels cause harmful conflation, OR LLM self-calibration capabilities advance enough to support finer-grained trust.

**Deep reference**: [philosophy.md](references/philosophy.md)

---

### 3. AGENTS Boundary & Routing

**Current choice**: Thin router AGENTS.md (~150-250 lines) with the 80% rule. Scope-triggered rules in `.agents/rules/` push knowledge discovery to point-of-need.

**Change trigger**: Context windows grow so large that the 80% threshold shifts materially, OR AI tools gain native scope-aware knowledge loading.

**Deep reference**: [philosophy.md](references/philosophy.md)

---

### 4. Artifact Contracts

**Current choice**: Domain files have 7 required sections + Correction History. AGENTS.md has 5 governance sections canonical from day one.

**Change trigger**: Sections consistently left empty or consistently overstuffed across multiple projects, OR new failure modes emerge that existing governance sections don't prevent.

**Deep reference**: [SKILL.md](SKILL.md)

---

### 5. Initialization Strategy

**Current choice**: Three initialization paths — Mode 1 (empty project scaffold), Mode 2 (existing project scan + domain generation), Mode 2B (deep brownfield onboarding with 6-phase audit/extract/restructure). POSIX scripts handle deterministic work.

**Change trigger**: LLM tool-use becomes deterministic enough that scripting is unnecessary, OR the brownfield onboarding phases prove insufficient for complex legacy projects.

**Deep reference**: [init-deep-reference.md](references/init-deep-reference.md)

---

### 6. Lifecycle

**Current choice**: 6-stage lifecycle: capture → compress → verify → promote → crystallize → retire. Staleness thresholds: domains 60 days, reference/patterns 90 days.

**Change trigger**: A stage proves consistently skipped or bottlenecked, OR new research identifies a missing lifecycle stage.

**Deep reference**: [lifecycle.md](references/lifecycle.md)

---

### 7. Health & Review Cadence

**Current choice**: 8 health metrics with weighted scoring (0-100). Triage priority: conflicts → stale verified/canonical → inbox compression → coverage gaps → stale observed.

**Change trigger**: Health metrics prove uncorrelated with actual knowledge quality, OR new degradation patterns emerge.

**Deep reference**: [health-check.md](references/health-check.md)

---

### 8. Hooks & Deterministic Automation

**Current choice**: POSIX sh hook scripts in `.agents/hooks/`, wired via adapter JSON configs (Claude Code / Cursor / Augment) or a native ESM plugin (OpenCode). **Integration is opt-in but explicitly prompted**: every Mode 1 / Mode 2 / Mode 2B run executes the Hook Integration Decision Point, presenting opencode / claude-code / cursor / augment-code / custom as the user's choices, and records the result in `manifest.json` `hooks.integration`. "Hooks installed" (scripts on disk) and "hooks active" (adapter wired) are reported as distinct states. Mode 4 / Mode 5 re-prompt only when `hooks.integration` is `deferred` or missing.

**Change trigger**: AGENTS.md spec standardizes lifecycle commands, OR hook event support converges into a single universal format, OR the decision-point UX needs revision based on user observations (e.g., users repeatedly choose `custom` because the bundled adapters miss a tool that should be supported).

**Deep reference**: [hooks/README.md](references/hooks/README.md) + `## Hook Integration Decision Point` section in `SKILL.md`

**Last reviewed**: 2026-05-07 — added explicit decision point and `manifest.json` `hooks.integration` schema after observing that "hooks installed but unwired" was being reported to users as if hooks were active.

---

### 9. Project-Local Specialization

**Current choice**: SKILL-LOCAL.md overlay in `.agents/knowledge/`. Candidates discovered during Mode 4, promoted during Mode 7. Architectural invariants cannot be overridden.

**Change trigger**: Specializations prove insufficient, OR portable specialization packs become needed across multiple same-type projects.

**Deep reference**: [SKILL.md](SKILL.md)

---

## Same-Change Rule

When any of these files change, the relevant dimension in `references/EVOLUTION-SPEC.md` MUST be updated in the same change:

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

## Known Improvement Backlog

- **2026-05-07** — Decision-point pattern (added in this revision for hook integration) currently exists only for one decision. If a future review finds 2+ other decisions being silently skipped (e.g., skill installation choice during Mode 6, or design-token migration during AGENTS.md restructure), generalize the pattern into a reusable "Decision Point" mechanism in SKILL.md instead of duplicating the prose. Trigger: 2+ independent observations.

## Review Log

- **2026-05-07** — Added explicit Hook Integration Decision Point to SKILL.md (Mode 1 / Mode 2 / Mode 2B step lists, Mode 4 / Mode 5 re-prompt logic). Added `hooks` object to manifest schema. Updated §8 of this spec. Triggered by inbox `[SKILL-IDEA:self-evolution]` entry from a deep-init session where `onboarding-report.md` reported "3 hooks" as if active when only the shell scripts were on disk; the user had to ask whether hooks needed initialization. The fix splits "scripts on disk" from "wired to tool" as separate completion criteria, lets the user explicitly choose among opencode / claude-code / cursor / augment-code / custom, and records the choice in `manifest.json` so re-prompts are deterministic.
