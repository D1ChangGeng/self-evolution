---
type: reference
confidence: verified
sources: [oh-my-openagent@3.15.3, github.com/code-yeongyu/oh-my-openagent]
last_verified: 2026-04-24
---

# init-deep Reference: Project Scanning Methodology

This file documents the `/init-deep` command from oh-my-openagent (OpenCode) for use as a reference standard when our skill initializes knowledge on existing projects.

## What init-deep Does

Generates hierarchical `AGENTS.md` files throughout a project by:
1. Concurrent exploration (6+ background agents + LSP + bash structural analysis)
2. Complexity scoring per directory (decides which directories warrant their own AGENTS.md)
3. Generating formatted knowledge files with project-specific content
4. Deduplication and review pass

## Scanning Architecture

### Phase 1: Discovery (Concurrent)

**6 base explore agents fire simultaneously:**
- Project structure explorer
- Entry points finder
- Conventions detector (`.eslintrc`, `pyproject.toml`, `.editorconfig`)
- Anti-patterns finder (`DO NOT`, `NEVER`, `ALWAYS`, `DEPRECATED` in comments/docs)
- Build/CI analyzer (`.github/workflows`, `Makefile`, `Dockerfile`)
- Test patterns analyzer

**Bash structural analysis (parallel):**
- Directory depth + file counts
- Files per directory (top 30 by count)
- Code concentration by file extension
- Existing AGENTS.md / CLAUDE.md finder

**LSP codemap (if available):**
- `DocumentSymbols` for entry points
- `WorkspaceSymbols` for classes, interfaces, functions
- `FindReferences` for reference centrality

**Dynamic agent spawning based on project scale:**

| Factor | Threshold | Additional Agents |
|--------|-----------|-------------------|
| Total files | >100 | +1 per 100 files |
| Total lines | >10k | +1 per 10k lines |
| Directory depth | >=4 | +2 for deep exploration |
| Large files (>500 lines) | >10 | +1 for complexity hotspots |
| Monorepo detected | yes | +1 per package/workspace |
| Multiple languages | >1 | +1 per language |

### Phase 2: Scoring

Each directory gets a complexity score that determines whether it warrants its own AGENTS.md.

**Scoring matrix:**

| Factor | Weight | High Threshold |
|--------|--------|----------------|
| File count | 3x | >20 |
| Subdir count | 2x | >5 |
| Code ratio | 2x | >70% |
| Unique patterns | 1x | Has own config files |
| Module boundary | 2x | Has `index.ts`/`__init__.py`/`mod.rs` |
| Symbol density | 2x | >30 symbols |
| Export count | 2x | >10 exports |
| Reference centrality | 3x | >20 references |

**Decision rules:**

| Score | Action |
|-------|--------|
| Root (.) | ALWAYS create |
| >15 | Create AGENTS.md |
| 8-15 | Create if distinct domain |
| <8 | Skip (parent file covers this) |

### Phase 3: Generation

**Root AGENTS.md template (50-150 lines):**

```markdown
# PROJECT KNOWLEDGE BASE

## OVERVIEW
{1-2 sentences: what this project does + core tech stack}

## STRUCTURE
{Directory tree with non-obvious purpose annotations only}

## WHERE TO LOOK
| Task | Location | Notes |

## CODE MAP
{From LSP: key symbols, types, locations, reference counts}

## CONVENTIONS
{ONLY deviations from standard practices — never generic advice}

## ANTI-PATTERNS (THIS PROJECT)
{Things explicitly forbidden in THIS project}

## COMMANDS
{dev/test/build/deploy commands}

## NOTES
{Gotchas, non-obvious behaviors}
```

**Subdirectory AGENTS.md (30-80 lines):**
- Shorter, focused on module-specific context
- NEVER repeats parent content
- Sections: OVERVIEW (1 line), STRUCTURE (if >5 subdirs), WHERE TO LOOK, CONVENTIONS (if different), ANTI-PATTERNS

### Phase 4: Review

- Deduplicate content across files
- Remove generic advice that applies to ALL projects
- Trim to size limits
- Verify child files don't repeat parent content

## What init-deep Does NOT Do

init-deep creates knowledge snapshots but lacks:
- **Confidence tracking** — no observed/verified/canonical distinction
- **Knowledge lifecycle** — no inbox, promotion, compression, retirement
- **Evidence linkage** — no source references on claims
- **Staleness detection** — no last_verified timestamps
- **Governance protocol** — no capture triggers, no evolution rules
- **Conflict handling** — no mechanism for contradictory knowledge

These are the gaps our self-evolution skill fills.

## How Our Skill Uses This Reference

When initializing on an existing project, our skill should:

1. **Check for existing init-deep AGENTS.md files** at subdirectory levels
2. **Read them as input** — they contain high-quality structural analysis
3. **Import relevant content** into `.agents/knowledge/domains/` with `confidence: observed, sources: ["AGENTS.md (init-deep generated)"]`
4. **Preserve subdirectory AGENTS.md files** — they provide valuable module-level context
5. **Enhance the root AGENTS.md** with our governance protocol (SESSION START, POST-TASK CHECKLIST, SELF-EVOLUTION RULES)
6. **Apply our scanning methodology** for areas init-deep missed (decisions, patterns, conventions classification)

The init-deep scoring matrix above can guide our own scan prioritization: focus on directories with score >8 first.
