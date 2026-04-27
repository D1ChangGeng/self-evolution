# Lifecycle: Detailed Evolution Mechanics

Read this during explicit evolution sessions. It expands on the Evolution Protocol in SKILL.md with detailed triggers, techniques, and examples.

## Compression

### Triggers

Compress inbox material when any of these conditions are met:

- **Cluster threshold**: 3 or more inbox entries share the same theme (same module, same concept, same problem area)
- **Volume threshold**: A single month's inbox file exceeds 20 entries
- **Maturity signal**: An inbox entry is clearly complete enough to merge into a topic (it reads like topic-level content, not a raw note)
- **Explicit request**: User asks to clean up or organize the inbox

### Process

1. Read all inbox files chronologically
2. Group entries by theme (don't force — some entries are genuinely standalone)
3. For each cluster of 3+ entries:
   a. Check if a matching topic file exists in `domains/`
   b. If yes: merge new observations into the existing topic file's appropriate section (Verified Facts if confirmed, Working Understanding if interpretive, Open Questions if uncertain)
   c. If no: create a new topic file from `references/templates/topic-template.md`
4. Preserve unique details — if an observation contains a specific edge case or unusual finding that doesn't fit the main theme, put it in the topic's "Open Questions" section rather than discarding it
5. After merging, mark each processed entry with `<!-- absorbed into domains/X.md on {date} -->`. If every entry in a monthly inbox file has been absorbed, move the entire file to `archive/`. Do not delete inbox entries — traceability is more important than tidiness.

### Output

- One merged topic file per theme
- Updated or new topic files with proper frontmatter
- Updated manifest.json inventory
- Archive of raw inbox if fully compressed

### Guard

Never discard details during compression. The most valuable knowledge is often in the exceptions, not the generalizations. Things that seem like noise during compression may be critical signals later.

## Promotion

### The Promotion Path

```
inbox → topics → patterns → crystallized → skills
                                ↗
            decisions (direct entry, skips inbox)
                    ↘
                AGENTS.md (canonical only)
```

### Criteria Per Level

**inbox → topic**: Enough related observations exist to form a coherent subject. This is a low bar intentionally — topics are working knowledge, not finished documents.

**topic → pattern**: The knowledge has been:
- Observed in the topic file AND verified against current code
- Found applicable across 2+ different contexts (not just one module)
- Expressed as a reusable practice (not a project-specific fact)

Use `references/templates/pattern-template.md` for new patterns.

**topic/pattern → AGENTS.md**: The knowledge is:
- Stable (unchanged for weeks/months)
- Navigation-critical (needed by most sessions working in this area)
- High-retrieval-value (saves significant time when known)
- Project-wide (not scoped to one module)

Only `canonical`-confidence knowledge enters AGENTS.md. Propose to user before adding.

**pattern → crystallized**: The knowledge is:
- Procedural (describes steps to follow, not just facts to know)
- Repeatable (the same sequence works across contexts)
- Refined through practice (real sessions have used and improved it)

See the Crystallization Detection section below.

### What Does NOT Promote

- One-off observations (stay in inbox or topics)
- Context-specific workarounds (stay in topics with narrow scope)
- Speculative interpretations (stay in topics under "Working Understanding")
- Anything that has not been verified against code (stays at `observed`)

## Staleness Detection

### Opportunistic Detection

The primary detection method: when the AI touches files in a scope, it should check related knowledge files.

Example: While working on `src/payments/`, the AI should check if `domains/payments.md` exists and whether its claims still hold.

### Heuristic Signals

A knowledge file is a staleness candidate when:

| Signal | Threshold | Weight |
|--------|-----------|--------|
| `last_verified` age | > 60 days (domains), > 90 days (reference, patterns) | Medium |
| Source files modified since `last_verified` | Any modification | High |
| References to files/functions that no longer exist | Any broken reference | Critical |
| Confidence is `verified` or `canonical` but sources are stale | Any | High |
| Confidence is `observed` and age > 90 days | | Low (observed is already marked as tentative) |

### Actions on Detection

1. **If verifiable now**: Read the scoped source files, compare claims, update the knowledge file, update `last_verified`
2. **If not verifiable now**: Add to manifest.json `stale_candidates` list with the detected signal
3. **If clearly wrong**: Correct the claim, update sources, note the correction in the file
4. **If the scope no longer exists**: Move to archive with `retirement_reason: "scope removed"`

### Important Rule

Do NOT auto-retire based on age alone. Old knowledge can be stable and valuable. A convention documented 6 months ago that still matches the code is not stale — it is proven. Age is a trigger for re-verification, not for automatic retirement.

## Conflict Resolution

### Detection

Conflicts surface during:
- Compression (two inbox entries contradict each other)
- Evolution (a topic claim contradicts current code or another topic)
- Consumption (an AI session notices a discrepancy)

### Surfacing Format

In the relevant topic file, create a clearly marked conflict section:

```markdown
## Conflicting Knowledge

**Claim A** (from domains/caching.md, verified 2026-03-15):
"Session storage uses Redis for all environments"

**Claim B** (from inbox/2026-04.md, observed 2026-04-20):
"Production migrated session storage to Valkey"

**Status**: Unresolved
**Evidence**: Claim A was verified against staging config. Claim B was observed in production deployment scripts.
**Likely resolution**: Both may be true — staging still uses Redis, production uses Valkey.
**Action needed**: Verify production config, update topic to reflect per-environment differences.
```

### Resolution Path

1. **Evidence-based**: Check current code/config to determine which claim is correct
2. **Scope-based**: Both claims may be true in different scopes (different environments, different modules)
3. **Temporal**: One claim may have superseded the other (check dates)
4. **Human arbitration**: When evidence is equal, flag for human decision

### Rule

Never silently resolve conflicts by picking one side. Document the resolution, keep the conflict history, and note what evidence resolved it. Future sessions may encounter similar conflicts and benefit from seeing how previous ones were resolved.

## Archive Conventions

### What Goes to Archive

- Superseded knowledge (replaced by a newer, more accurate version)
- Retired decisions (ADRs with status: deprecated or superseded)
- Deprecated patterns (practices that are no longer recommended)
- Confirmed-stale topics (verified to no longer reflect project reality)
- Fully compressed inbox files (raw notes absorbed into topics)

### How to Archive

1. Move the file to `archive/`
2. Add archival metadata to the frontmatter:
   ```yaml
   archived_at: 2026-04-24
   retirement_reason: "Superseded by domains/caching-v2.md after Valkey migration"
   superseded_by: "domains/caching-v2.md"  # if applicable
   ```
3. Update manifest.json inventory
4. Remove from AGENTS.md "Where to Look" table (if referenced there)

### Archive Is Searchable

Archive is not a trash can. It is a historical record. Archived files can be searched when investigating why a past decision was made or understanding how the system evolved. They are simply excluded from the active knowledge view.

## Module-Level AGENTS.md

### When to Create

Only when ALL of these conditions are met:

- A directory has been the subject of work in 5+ sessions
- The directory has module-specific conventions that differ from project-wide conventions
- Topic files for this module exceed 100 lines (too much for one topic file)
- The directory represents a clear architectural boundary

### Content

Module-level AGENTS.md follows the same structure as root AGENTS.md but scoped:

- Module overview (purpose, boundaries, dependencies)
- Module-specific conventions
- Module-specific "Where to Look" table
- Pointer to relevant `.agents/knowledge/domains/` files

### What NOT to Put There

- Project-wide knowledge (belongs in root AGENTS.md)
- Cross-cutting concerns (belongs in domains/ with broad scope)
- Temporary observations (belongs in inbox/)

### Governance

Same confidence rules apply. Same lifecycle. Module AGENTS.md is subject to the same staleness detection and evolution as any other knowledge file.

## Crystallization Detection

### Signals

Propose crystallization when you notice any of these:

1. **Repetition signal**: A workflow was performed 3+ times across sessions with the same steps in the same sequence
2. **Refinement signal**: A pattern file or topic section with "Steps" or "Workflow" or "Process" heading has been edited in 3+ sessions
3. **Parallel discovery**: Multiple inbox entries from different sessions describe the same procedural sequence independently
4. **Explicit signal**: User says "we should formalize this" or "this should be reusable" or "turn this into a process"
5. **Clustering signal**: During evolution, procedural knowledge (step-by-step sequences) clusters in topics or patterns

### On Detection

1. Confirm with user: "I've noticed {workflow} has been performed {N} times. Should I crystallize it into a reusable workflow document?"
2. If approved: gather all related knowledge (inbox entries, topic sections, pattern files)
3. Extract into `crystallized/{workflow-name}.md` using the crystallized template
4. Set `refinement_count: 1`, `skill_candidate: false`
5. Link back to source knowledge via `sources` field

### Refinement Process

Each subsequent use of the crystallized workflow:

1. Before starting: read the crystallized doc
2. During execution: note any deviation from the documented steps
3. After completion: update the doc with improvements
   - Missing step? Add it.
   - Unnecessary step? Mark optional or remove.
   - Wrong decision criteria? Fix it.
   - New edge case? Document it.
4. Increment `refinement_count`, update `last_refined`, add Refinement Log entry

### Skill Graduation

When ALL of these are true:
- `refinement_count >= 3`
- Tested across 3+ distinct contexts (different inputs, different situations)
- Edge cases are documented from real failures
- Decision points have concrete criteria (not "use judgment")
- Prerequisites are enumerable
- Output is verifiable

Then: set `skill_candidate: true` and suggest skill creation to the user. Ensure `skill-creator` is available (if not: `npx skills add https://github.com/anthropics/skills --skill skill-creator -g -y`), then use it to transform the crystallized doc into a skill with test cases and evaluation.

## Evolution Session Checklist

Use this as a step-by-step guide during explicit evolution:

1. Read manifest.json — note health metrics, stale candidates, conflicts
2. Read all inbox files — identify themes and clusters
3. Compress: merge clustered inbox items into topics (create or update)
4. Promote: check if any topics qualify for pattern promotion
5. Verify: spot-check 2-3 topic or pattern files against current code
6. Detect staleness: flag files with old `last_verified` + changed scopes
7. Detect conflicts: look for contradictory claims across files
8. Detect crystallization: look for procedural knowledge patterns
9. Archive: retire superseded or confirmed-stale knowledge
10. Update manifest.json with current inventory and health metrics
11. Update AGENTS.md "Where to Look" table if topics changed
12. Report summary to user: what changed, what needs attention, health score before and after
