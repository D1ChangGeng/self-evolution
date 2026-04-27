#!/bin/sh
set -e

usage() {
  cat <<'EOF'
Usage: sh init-scaffold.sh --project-name NAME --mode empty|existing [--project-root PATH]

Arguments:
  --project-name NAME    Required. Project name for templates.
  --mode empty|existing  Required. 'empty' creates AGENTS.md; 'existing' creates scaffold only.
  --project-root PATH    Optional. Defaults to current working directory.
EOF
}

create_dir() {
  dir_path=$1

  if [ -d "$dir_path" ]; then
    printf 'skipped directory %s\n' "$dir_path"
  else
    mkdir -p "$dir_path"
    printf 'created directory %s\n' "$dir_path"
  fi
}

project_name=
mode=
project_root=

while [ $# -gt 0 ]; do
  case "$1" in
    --project-name)
      shift
      if [ $# -eq 0 ]; then
        usage
        exit 1
      fi
      project_name=$1
      ;;
    --mode)
      shift
      if [ $# -eq 0 ]; then
        usage
        exit 1
      fi
      mode=$1
      ;;
    --project-root)
      shift
      if [ $# -eq 0 ]; then
        usage
        exit 1
      fi
      project_root=$1
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

if [ -z "$project_name" ] || [ -z "$mode" ]; then
  usage
  exit 1
fi

case "$mode" in
  empty|existing)
    ;;
  *)
    usage
    exit 2
    ;;
esac

if [ -n "$project_root" ]; then
  PROJECT_ROOT=$project_root
else
  PROJECT_ROOT=$(pwd)
fi

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PROJECT_NAME_JSON=$(printf '%s' "$project_name" | sed 's/\\/\\\\/g; s/"/\\"/g')
PROJECT_NAME_SED=$(printf '%s' "$project_name" | sed 's/[\\&/]/\\&/g')

KNOWLEDGE_DIR=$PROJECT_ROOT/.agents/knowledge
RULES_DIR=$PROJECT_ROOT/.agents/rules
HOOKS_DIR=$PROJECT_ROOT/.agents/hooks

create_dir "$KNOWLEDGE_DIR"
create_dir "$KNOWLEDGE_DIR/inbox"
create_dir "$KNOWLEDGE_DIR/domains"
create_dir "$KNOWLEDGE_DIR/reference"
create_dir "$KNOWLEDGE_DIR/decisions"
create_dir "$KNOWLEDGE_DIR/patterns"
create_dir "$KNOWLEDGE_DIR/crystallized"
create_dir "$KNOWLEDGE_DIR/archive"
create_dir "$RULES_DIR"
create_dir "$HOOKS_DIR"

README_FILE=$KNOWLEDGE_DIR/README.md
if [ -f "$README_FILE" ]; then
  printf 'skipped file %s\n' "$README_FILE"
else
  cat <<'EOF' > "$README_FILE"
# Project Knowledge Evolution System

## What This System Is

This is a project knowledge evolution system.

It is not a static documentation archive. Knowledge here is expected to change as the project changes. Entries have lifecycle states, confidence levels, and evidence trails. That means a note captured today can later be refined, verified, promoted, superseded, or archived.

The goal is simple: preserve useful project understanding in a form that helps future work without pretending every statement is equally trustworthy.

This system exists to help humans and AI sessions work with the same evolving body of project knowledge.

## What This System Is Not

This system is not a replacement for code, tests, or runtime verification.

It is not automatically correct. A knowledge file can be incomplete, stale, or wrong.

It is not a permanent archive for every observation ever made. Some notes are temporary, some become patterns, and some should be retired.

## Directory Structure

### `inbox/`

Raw capture goes here first, usually in monthly files. Use it for observations that are worth saving but not yet organized. Treat it as intake, not final form.

### `domains/`

Working knowledge lives here, organized by task area. Each domain file merges conventions, anti-patterns, and operational notes for a focused area such as authentication, deployment, UI patterns, or security. One domain file per concern prevents hunting across multiple files.

### `reference/`

Low-churn reference documentation lives here. API route tables, architecture diagrams, companion project docs, comprehensive code maps. Content that rarely changes but needs to be accessible when working in specific areas.

### `decisions/`

Architectural and operational decisions live here in ADR form. Use this directory when the team has explicitly chosen a path and the reasoning should remain visible.

### `patterns/`

Verified conventions and repeated practices live here. A pattern file should describe when something applies, when it does not, and the evidence behind it.

### `crystallized/`

Executable best practices live here. These files should describe repeatable workflows with prerequisites, decision points, and verification steps.

### `archive/`

Retired or superseded knowledge moves here. Archive content is still useful for historical context, but it should not be treated as current guidance.

## How to Read Knowledge

Use this discovery protocol when starting work:

1. Check `AGENTS.md` and its `Where to Look` table for your task area.
2. If there is no obvious match, scan `manifest.json` inventory entries for files whose scope matches your work.
3. If you still do not have a match, search `domains/` for keywords related to the task.
4. Check `inbox/` for recent observations that may not be organized yet.
5. Before trusting any entry, note its `confidence` level and `last_verified` date.

Do not treat every file as equally authoritative. The confidence ladder matters.

## How to Write Knowledge

Use this capture protocol after non-trivial tasks.

Append observations to `inbox/{YYYY-MM}.md`.

Use this format:

```md
## {date} {time} — {context}
- {observation}
- [source: {file:line}]
```

No classification is required at capture time. Just write it down clearly.

Capture knowledge when any of these conditions are true:

1. You discovered how something works.
2. You fixed a bug that revealed a hidden assumption.
3. You made a constraining decision.
4. You noticed a cross-file pattern.
5. You found that existing knowledge was wrong.

Raw capture is better than losing the insight.

## Confidence Levels

### `observed`

Seen once, or based on a single source. This can still be useful, but use it with awareness that it may be wrong.

### `verified`

Corroborated by two or more sources, or checked directly against code, tests, or authoritative documentation. This is usually safe to rely on.

### `canonical`

Source of truth. Canonical knowledge belongs in root `AGENTS.md` and should only change through an explicit decision.

All AI-generated knowledge starts as `observed`. No exceptions.

## When Knowledge Conflicts

If two entries conflict:

1. Surface both versions explicitly in the relevant topic file.
2. Mark the conflict clearly so it is visible, not buried in prose.
3. Note the evidence for each side.
4. Flag the issue for human arbitration if both sides have comparable evidence.
5. Do not silently pick one side and erase the other.

Conflict that is made explicit can be resolved. Conflict that is hidden becomes misinformation.

## Promotion and Lifecycle

Typical progression looks like this:

1. Capture an observation in `inbox/`.
2. Move or summarize it into a `domains/` file when the area becomes important.
3. Promote repeated and supported guidance into `patterns/` or `crystallized/`.
4. Promote only durable source-of-truth knowledge into root `AGENTS.md`.
5. Archive files that are no longer current.

Not every note needs promotion. Some observations are only useful in the short term.

## Security

Never store secrets, API keys, passwords, tokens, or credentials as knowledge.

If sensitive context matters, reference it by location, such as `see .env` or `see deployment secret store`, not by value.

Treat knowledge files as durable project memory. Write them as if they may be read broadly.

## When to Ask a Human

Ask a human when any of these conditions apply:

- There is an unresolvable conflict between knowledge entries.
- You want to promote something to canonical status in `AGENTS.md`.
- A decision has significant architectural consequences.
- Your confidence in your own judgment is low.

Human arbitration is part of the system, not a failure of the system.

## Maintenance Expectations

Keep entries concise, specific, and evidence-linked.

Prefer corrections over silent drift.

When you learn that a file is outdated, update it or mark it clearly. A stale knowledge base is worse than a small one.

## Quick Summary

- Capture first.
- Verify when possible.
- Promote carefully.
- Mark confidence honestly.
- Never hide conflicts.
- Never store secrets.
EOF
  printf 'created file %s\n' "$README_FILE"
fi

MANIFEST_FILE=$KNOWLEDGE_DIR/manifest.json
if [ -f "$MANIFEST_FILE" ]; then
  printf 'skipped file %s\n' "$MANIFEST_FILE"
else
  cat <<EOF > "$MANIFEST_FILE"
{
  "schema_version": "1.0",
  "created_at": "${TIMESTAMP}",
  "last_evolved_at": null,
  "last_health_check": null,
  "project": {
    "name": "${PROJECT_NAME_JSON}",
    "initialized_from": "${mode}"
  },
  "inventory": [],
  "health": {
    "total_files": 0,
    "by_type": {
      "domain": 0,
      "reference": 0,
      "decision": 0,
      "pattern": 0,
      "crystallized": 0,
      "inbox": 0,
      "archived": 0
    },
    "by_confidence": {
      "observed": 0,
      "verified": 0,
      "canonical": 0
    },
    "inbox_count": 0,
    "inbox_oldest_unprocessed": null,
    "stale_candidates": [],
    "conflicts": [],
    "days_since_evolution": null
  }
}
EOF
  printf 'created file %s\n' "$MANIFEST_FILE"
fi

PROTOCOL_FILE=$RULES_DIR/knowledge-protocol.md
if [ -f "$PROTOCOL_FILE" ]; then
  printf 'skipped file %s\n' "$PROTOCOL_FILE"
else
  cat <<'EOF' > "$PROTOCOL_FILE"
---
description: "Project knowledge capture protocol"
globs:
  - "**/*"
---
After completing any non-trivial task, check if any of these capture conditions apply:
1. Discovered how something works
2. Fixed a bug revealing a hidden assumption
3. Made a constraining decision
4. Noticed a cross-file pattern
5. Found existing knowledge was wrong

If yes, append to .agents/knowledge/inbox/{YYYY-MM}.md
EOF
  printf 'created file %s\n' "$PROTOCOL_FILE"
fi

SESSION_END_FILE=$HOOKS_DIR/session-end.sh
if [ -f "$SESSION_END_FILE" ]; then
  printf 'skipped file %s\n' "$SESSION_END_FILE"
else
  cat << 'EOF' > "$SESSION_END_FILE"
#!/bin/sh
# Hook: session-end — append a session marker to inbox for knowledge capture reminder
# Always exits 0 — never blocks session termination.
set -u
INBOX_DIR=".agents/knowledge/inbox"
[ -d "$INBOX_DIR" ] || exit 0
MONTH_FILE="$INBOX_DIR/$(date -u +%Y-%m).md"
DATE_STR=$(date -u +%Y-%m-%d)
TIME_STR=$(date -u +%H:%M)
printf '\n## %s %s — Session ended\n\n- Session completed. Review POST-TASK CHECKLIST for any uncaptured knowledge.\n- [source: hooks/session-end.sh]\n' "$DATE_STR" "$TIME_STR" >> "$MONTH_FILE"
exit 0
EOF
  chmod +x "$SESSION_END_FILE"
  printf 'created file %s\n' "$SESSION_END_FILE"
fi

STOP_FILE=$HOOKS_DIR/stop.sh
if [ -f "$STOP_FILE" ]; then
  printf 'skipped file %s\n' "$STOP_FILE"
else
  cat << 'EOF' > "$STOP_FILE"
#!/bin/sh
# Hook: stop — check manifest for inbox pressure and suggest evolve
# Always exits 0 — never blocks the stop event.
set -u
MANIFEST=".agents/knowledge/manifest.json"
[ -f "$MANIFEST" ] || exit 0
inbox_count=$(grep '"inbox_count"' "$MANIFEST" 2>/dev/null | grep -o '[0-9]*' | head -1)
days_since=$(grep '"days_since_evolution"' "$MANIFEST" 2>/dev/null | grep -o '[0-9]*' | head -1)
inbox_count=${inbox_count:-0}
days_since=${days_since:-0}
if [ "$inbox_count" -gt 10 ] 2>/dev/null || [ "$days_since" -gt 14 ] 2>/dev/null; then
  printf '[knowledge] inbox_count=%s, days_since_evolution=%s. Consider running evolve.\n' "$inbox_count" "$days_since" >&2
fi
exit 0
EOF
  chmod +x "$STOP_FILE"
  printf 'created file %s\n' "$STOP_FILE"
fi

COMPACT_FILE=$HOOKS_DIR/compact-recovery.sh
if [ -f "$COMPACT_FILE" ]; then
  printf 'skipped file %s\n' "$COMPACT_FILE"
else
  cat << 'EOF' > "$COMPACT_FILE"
#!/bin/sh
set -u
cat << 'DIRECTIVE'
CONTEXT WAS COMPACTED. Before continuing:
1. Re-read AGENTS.md — focus on CORE INVARIANTS and CRITICAL ANTI-PATTERNS
2. Re-read the domain file for your current task area (check WHERE TO LOOK table)
3. State which invariants and anti-patterns apply to your current work before proceeding
DIRECTIVE
exit 0
EOF
  chmod +x "$COMPACT_FILE"
  printf 'created file %s\n' "$COMPACT_FILE"
fi

if [ "$mode" = "empty" ]; then
  AGENTS_FILE=$PROJECT_ROOT/AGENTS.md

  if [ -f "$AGENTS_FILE" ]; then
    printf 'skipped file %s\n' "$AGENTS_FILE"
  else
    cat <<'EOF' | sed "s/{{PROJECT_NAME}}/${PROJECT_NAME_SED}/g" > "$AGENTS_FILE"
<!-- Generated by self-evolution skill -->

# {{PROJECT_NAME}}

## IDENTITY

A new project. Description will be added as the project takes shape.

**What problem this solves:** To be defined.

**Who uses it:** To be defined.

**Distribution model:** To be defined.

## GOALS & CONSTRAINTS

**Current priorities:**

**Intentional trade-offs:**

**Known limitations:**

## STRUCTURE

```text
{{PROJECT_NAME}}/
└── .agents/
    ├── knowledge/
    └── rules/
```

## COMMANDS

```bash
# No build commands configured yet.
```

## WHERE TO LOOK

| Task area | Start here | Deep knowledge |
|-----------|-----------|---------------|
| | | |

## CORE INVARIANTS

Project-wide rules will accumulate here as the project develops. Each entry should be a summary pointing to the authoritative domain file.

_No invariants yet. Add them as conventions emerge and get verified through use._

## CRITICAL ANTI-PATTERNS

_No anti-patterns yet. Add them as mistakes are discovered and patterns verified._

## SESSION START

1. Read this file for project overview and routing
2. Check `.agents/knowledge/manifest.json` — if `inbox_count > 10` or `days_since_evolution > 14`, suggest evolution to user
3. Read the relevant `.agents/knowledge/domains/*.md` for your current task (use the Where to Look table above)

## CODING DISCIPLINE

These behavioral rules reduce common AI coding mistakes. They bias toward caution over speed — for trivial, local tasks, use judgment. Escalate caution on subsystem transitions, external-system operations, or knowledge-affecting work.

**Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently. If a simpler approach exists, say so — push back when warranted. If something is unclear, stop and ask.

**Simplicity first.** Minimum code that solves the problem. No speculative features, no premature abstractions, no "flexibility" or "configurability" that wasn't requested, no error handling for impossible scenarios. If you wrote 200 lines and it could be 50, rewrite it. Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

**Surgical changes.** Touch only what you must. Don't "improve" adjacent code, comments, or formatting. Don't refactor things that aren't broken. Match existing style, even if you'd do it differently. If you notice unrelated dead code, mention it — don't delete it. If your changes create orphans (unused imports/variables), clean those up — but don't remove pre-existing dead code unless asked. Every changed line should trace to the user's request.

**Goal-driven execution.** Transform tasks into verifiable goals before starting. "Fix the bug" becomes "write a test that reproduces it, then make it pass." For multi-step tasks, state a plan with verification checkpoints. Strong success criteria let you loop independently — weak criteria require constant clarification. Loop until verified — don't declare done without evidence.

**Context familiarity is not domain competence.** A long session builds false confidence — having edited 30 files does not mean you understand the 31st. When a task shifts to a subsystem, workflow, or environment you haven't directly read the source for in this session, stop and read the relevant domain file before acting. The trigger is simple: if you cannot cite the specific file/line that governs the behavior you're about to change, you don't know enough yet.

## POST-TASK CHECKLIST

After completing any non-trivial task:

1. Run tests if code was changed
2. Check if any of these knowledge capture conditions apply:
   - Discovered how something works that was not already documented
   - Fixed a bug that revealed a hidden assumption
   - Made a decision that constrains future implementation choices
   - Noticed a pattern that spans multiple files, modules, or workflows
   - Found that existing knowledge was wrong, incomplete, or outdated
   - Found that the self-evolution skill itself had a flaw (tag as `[SKILL-FIX:self-evolution]`)
3. If any condition is met, **write the inbox entry NOW** — append to `.agents/knowledge/inbox/{YYYY-MM}.md` before reporting completion:
   ```
   ## {date} {time} — {context}
   - {observation}
   - [source: {file:line}]
   ```
   If existing knowledge needs correction, tag the inbox entry with `[DOMAIN-FIX: domains/X.md]` so the fix is discoverable at the next natural boundary.
4. Domain-level corrections (updating `domains/*.md`, adding to Correction History) can be batched at task end. Before reporting final completion of a multi-step task, scan inbox for any `[DOMAIN-FIX]` entries from this session and apply them.
5. **State your capture decision in one line** after acting:
   - `Capture: none` — no conditions met
   - `Capture: inbox (hidden assumption in auth refresh)` — appended to inbox
   - `Capture: inbox + [DOMAIN-FIX: domains/auth.md] (token expiry wrong)` — appended, will fix at task end

### Skill Ecosystem

Before building a capability from scratch, check if a skill already exists:

1. Ensure `find-skills` is available — if not: `npx skills add https://github.com/vercel-labs/skills --skill find-skills -g -y`
2. Search for skills: `npx skills find [query]` or ask "is there a skill for X?"
3. If found: install and use the skill
4. If a workflow has been refined 3+ times: consider crystallizing it via `skill-creator` (see `.agents/knowledge/crystallized/`)

See `.agents/knowledge/README.md` for the full protocol, confidence model, and promotion rules.

## SELF-EVOLUTION RULES

When modifying this codebase, update knowledge **in the same commit**:

- New file → update the relevant `domains/*.md` or `reference/*.md` file
- New endpoint → update `reference/*.md` route listing + WHERE TO LOOK table in this file
- New config key → add to the relevant `domains/*.md` file, also update config examples
- New convention → add to the relevant `domains/*.md` file (NOT to this file)
- Significant architecture change → update `domains/*.md` scope sections

As the project grows, refine these rules to name SPECIFIC files (e.g., `reference/api-routes.md`, `domains/auth.md`). Specific targets prevent sync misses.

**Single Source of Truth:** Each rule has exactly one canonical home in `.agents/knowledge/domains/`. This file contains summaries with pointers. When updating a rule, update the domain file only.

### Knowledge Writing Rules

When writing to any `.agents/knowledge/` file, follow these rules:

- **Confidence:** All AI-generated knowledge starts as `observed`. To earn `verified`, cite 2+ corroborating sources. Only human-approved, stable knowledge becomes `canonical`.
- **Evidence:** Every non-trivial claim needs `[source: file:line]` or a `sources:` entry in frontmatter. No evidence = no credibility.
- **Scope:** Say "this module uses X" not "this project uses X" — unless you've verified project-wide.
- **Unknowns:** "Open Questions" sections are mandatory. If you have no open questions, you haven't thought hard enough.
- **Conflicts:** When two knowledge entries contradict, surface BOTH in the relevant file. Never silently pick one side.
- **SSOT:** Each rule has ONE home. Update the domain file, not this file. Cross-reference, don't duplicate.
- **No speculation as fact:** Use "appears to", "likely", "based on X" for unverified interpretations. Reserve declarative statements for verified facts.

### Knowledge Distillation Principles

- Preserve domain cognitive sense — record what, why, and what mental model is needed
- Keep high-frequency pitfalls as concrete cases — specific gotchas > abstract advice
- Generalize only when cross-subsystem — domain rules stay in domain files
- Deduplicate — each rule has exactly one home in `.agents/knowledge/`
- Every bullet must pass the usefulness test — "Does this save time or prevent a mistake next month?"

### AGENTS.md vs Knowledge System Boundary

AGENTS.md holds knowledge that **every session needs** — if removing it degrades 80%+ of sessions, it belongs here. Everything else goes in `.agents/knowledge/`.

| Belongs in AGENTS.md | Belongs in knowledge system |
|---|---|
| Project identity, goals, architecture | Detailed module documentation |
| Build/test/run commands | Domain-specific conventions (only relevant to one area) |
| Top 10 invariants (as summaries with pointers) | Full rule text with evidence and context |
| Top 10 anti-patterns (as summaries) | Accumulated lessons and debugging notes |
| Coding discipline (every-session behavioral rules) | Task-specific patterns and workflows |
| Navigation routing table | Comprehensive file inventories |
| Knowledge capture protocol | Lifecycle mechanics (compression, promotion, retirement) |

Knowledge that proves itself essential across many sessions can be **promoted into AGENTS.md** — but only as a summary with a pointer to the canonical source in the knowledge system. This keeps AGENTS.md dense and high-signal while the knowledge system provides unlimited depth.
EOF
    printf 'created file %s\n' "$AGENTS_FILE"
  fi
fi

printf 'init-scaffold complete for %s (%s)\n' "$PROJECT_ROOT" "$mode"
