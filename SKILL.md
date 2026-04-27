---
name: self-evolution
description: "Initialize and maintain a project self-evolution knowledge base. Creates a hierarchical knowledge system under .agents/knowledge/ with lifecycle management: capture, organize, verify, promote, compress, and retire project knowledge. Use this skill whenever the user asks to initialize project knowledge, set up AGENTS.md, create a knowledge base, evolve project documentation, check knowledge health, or crystallize workflows into skills. Also use when users say 'set up project memory', 'initialize project context', 'create project brain', or any variation of wanting persistent, evolving project knowledge for AI-assisted development."
---

# Project Self-Evolution Knowledge System

This skill creates and governs a living knowledge base that evolves with a software project. It addresses three fundamental gaps: the reality gap (actual state vs documented), the access gap (documented vs discoverable), and the trust gap (discovered vs trustworthy).

Read `references/philosophy.md` if you need to understand WHY the system works this way. This file tells you WHAT to do and WHEN.

## Mode Detection

Determine the operating mode from context:

| User says | Mode |
|-----------|------|
| "initialize", "init", "set up knowledge base" | **Initialize** (auto-detects empty vs existing) |
| "evolve", "update knowledge", "compress inbox", "promote" | **Evolve** |
| "check health", "KB health", "knowledge base status" | **Health Check** |
| "crystallize", "turn this into a workflow", "formalize this process" | **Crystallize** |
| "improve the skill", "skill maintenance", "fix the skill" | **Skill Maintenance** |
| (completing a non-trivial task, no explicit request) | **Capture** (ambient) |

For Initialize mode, the skill automatically detects project state and follows the appropriate path:

- **Empty project**: No `src/`, `lib/`, `app/` directories AND no language manifest (package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml, etc.) → Create skeleton only
- **Existing project**: Has source directories OR language manifests → Deep scan, generate initial knowledge

There is no separate "init-deep" trigger — deep initialization is the natural behavior when the skill encounters an existing project.

---

## Filesystem Contract

Every initialization creates this exact structure. No exceptions.

```
.agents/
├── knowledge/
│   ├── README.md                    # System self-description (from template)
│   ├── manifest.json                # Health dashboard (machine-maintained)
│   ├── inbox/                       # Zero-friction capture zone
│   ├── domains/                     # Working knowledge by task area
│   ├── reference/                   # Low-churn reference documentation
│   ├── decisions/                   # Architecture Decision Records
│   ├── patterns/                    # Verified reusable conventions
│   ├── crystallized/                # Executable best practices
│   └── archive/                     # Retired knowledge (never deleted)
└── rules/                           # Scope-triggered discovery rules
└── hooks/                           # Lifecycle hook scripts (tool-agnostic)
```

**Directory purposes:**

| Directory | What goes here | Changes how often |
|-----------|---------------|-------------------|
| `inbox/` | Raw observations, timestamped, no classification needed | Every session |
| `domains/` | Organized working knowledge per task area (conventions + anti-patterns + operational notes merged per domain) | Weekly |
| `reference/` | Low-churn reference docs (API routes, architecture diagrams, companion project docs) | Monthly |
| `decisions/` | Architecture Decision Records with context, alternatives, consequences | On decision |
| `patterns/` | Verified conventions that survived 2+ verification cycles | Occasionally |
| `crystallized/` | Step-by-step workflows extracted from repeated practice | Rarely |
| `archive/` | Retired/superseded knowledge (preserves history, exits active view) | On retirement |
| `hooks/` | Tool-agnostic lifecycle hook scripts (session-end capture, health reminders) | On setup |

---

## Mode 1: Initialize — Empty Project

Create the knowledge base skeleton. Read `references/templates/root-agents-empty.md` and use it as the base for AGENTS.md.

### Steps

0. **Pre-Validation (Skill Self-Check)**:
   Read `references/EVOLUTION-SPEC.md`. For each of the 7 design dimensions, evaluate:
   - "Based on my current knowledge, does this choice still represent best practice?"
   - "Does this specific project have needs that challenge this choice?"
   If all dimensions pass, proceed. If any dimension's change trigger fires, read the linked deep reference, propose improvement to user, and update the spec before continuing. If a dimension's `last_reviewed` exceeds 60 days, force a deep review.

1. Detect project name from directory name or git remote
2. Run the scaffold script:
   ```sh
   sh "references/scripts/init-scaffold.sh" \
     --project-name "$PROJECT_NAME" \
     --mode empty \
     --project-root "$PROJECT_ROOT"
   ```
   This creates all directories, README.md, manifest.json, knowledge-protocol.md, and AGENTS.md with defaults filled.
3. Verify the script output: confirm AGENTS.md exists, all directories created, manifest.json is valid
4. Generate scope-triggered rules (see Scope-Triggered Rules Generation section)
5. Report completion: list created files and explain what to do next

### Completion Criteria
- AGENTS.md exists at project root with CODING DISCIPLINE, POST-TASK CHECKLIST and SELF-EVOLUTION RULES
- .agents/knowledge/ exists with README.md, manifest.json, and 7 subdirectories
- .agents/rules/ exists with at least knowledge-protocol.md
- No knowledge content generated (the project is empty — knowledge accumulates through use)

---

## Mode 2: Initialize — Existing Project

Scan the project, generate initial knowledge, and create the structure. This mode adapts the scanning methodology from `/init-deep` (see `references/init-deep-reference.md`) with our knowledge lifecycle additions.

### Step 0: Pre-Validation (Skill Self-Check)

Before scanning, evaluate the skill's own design:

1. Read `references/EVOLUTION-SPEC.md`
2. For each of the 7 design dimensions, evaluate:
   - "Based on my current knowledge, does this choice still represent best practice?"
   - "Does this specific project have needs that challenge this choice?"
3. If ALL dimensions pass → proceed to Pre-Scan
4. If ANY dimension's change trigger fires:
   a. Read the linked deep reference file
   b. Describe the proposed improvement and rationale
   c. Wait for user confirmation
   d. Update the relevant template/script/spec
   e. Log the change in EVOLUTION-SPEC.md Review Log
   f. Then proceed to Pre-Scan
5. If a dimension's `last_reviewed` exceeds 60 days, force a deep review even if no trigger explicitly fires

### Pre-Scan: Check for Existing Knowledge Artifacts

Before scanning from scratch, check if the project already has knowledge artifacts:

1. **Existing AGENTS.md files** at any directory level — these may have been generated by `/init-deep` or written manually. Read them as high-quality input; import relevant content into `.agents/knowledge/domains/` with `confidence: observed`.
2. **Existing `.agents/` or `.claude/` directories** — preserve them, integrate with our structure.
3. **Existing CLAUDE.md** — read and import content similarly.

If rich existing artifacts are found, the scanning passes below can be lighter — focus on gaps rather than full coverage.

### Pass 1: Structural Inventory (Concurrent)

Fire background explore agents immediately while main session does structural analysis. Reference `references/init-deep-reference.md` for the dynamic agent spawning methodology.

**Background agents (fire simultaneously, collect later):**
- Project structure explorer — report non-standard organization
- Entry points finder — report main files and routing
- Conventions detector — find config files (.eslintrc, pyproject.toml, .editorconfig)
- Anti-patterns finder — find DO NOT/NEVER/ALWAYS/DEPRECATED comments
- Build/CI analyzer — find .github/workflows, Makefile, Dockerfile
- Test patterns analyzer — find test configs and conventions

**Main session concurrent analysis:**
1. **Directory structure**: List all directories (exclude node_modules, .git, venv, dist, build)
2. **Language detection**: Identify from manifests (package.json, Cargo.toml, go.mod, pyproject.toml, requirements.txt, pom.xml, build.gradle, Makefile, CMakeLists.txt)
3. **File counts per directory**: Identify complexity hotspots
4. **Existing documentation**: Locate README.md, CONTRIBUTING.md, docs/, existing AGENTS.md, CLAUDE.md, .cursor/rules/
5. **Config examples**: Locate config.example.*, .env.example, etc.

**Scale-adaptive agent spawning**: For large projects (>100 files), spawn additional agents per the thresholds in `references/init-deep-reference.md`.

### Pass 2: Targeted High-Signal Reads

After collecting Pass 1 results, read specific files. Prioritize by init-deep's complexity scoring (see reference): directories with higher file count, code ratio, module boundaries, and export counts get more attention.

1. **Main entry points**: main.*, app.*, index.*, src/main.*, src/lib.*
2. **Routing/API definitions**: routes.*, router.*, api.*, server.*
3. **Package manifests**: Read dependency sections for tech stack details
4. **Existing docs**: Read README.md fully, skim other docs
5. **Intent vs Reality check**: Compare what README/docs claim about the project against what the code actually does. Record divergences explicitly in `inbox/` — these are the highest-value findings from a scan (e.g., "README says REST API, code uses gRPC").
6. **Config files**: Read config examples for configurable parameters
7. **CI configs**: Read for build/test/deploy commands
8. **Key test files**: 1-2 test files to understand testing patterns

For projects >100 files: increase read budget proportionally. The 15-20 file limit is a baseline, not a cap.

### Generate Output

Generate files in this order — domain files first, then AGENTS.md (because AGENTS.md placeholders like `{{TOPIC_ENTRIES}}`, `{{CORE_INVARIANTS}}`, `{{CRITICAL_ANTI_PATTERNS}}` depend on domain file content).

### Scaffold Setup

Before generating project-specific content, create the base scaffold:

```sh
sh "references/scripts/init-scaffold.sh" \
  --project-name "$PROJECT_NAME" \
  --mode existing \
  --project-root "$PROJECT_ROOT"
```

This creates all directories, README.md, initial manifest.json, and knowledge-protocol.md. The remaining steps below generate only project-specific content.

Then run the project scanner to collect structural metadata:

```sh
sh "references/scripts/scan-project.sh" \
  --project-root "$PROJECT_ROOT" \
  --output "$PROJECT_ROOT/.agents/knowledge/reference/.project-scan.txt"
```

This produces a deterministic report of file counts, language detection, manifest presence, CI/CD config, testing infrastructure, and **detected technologies** — saving ~500 tokens of LLM tool-use overhead during Pass 1.

Use the `DETECTED TECHNOLOGIES` section of the scan output as input for `find-skills` (see Skill Ecosystem in AGENTS.md) to discover relevant best-practice skills for the project. When candidates are found, write them to `manifest.json` `skills.pending_review` immediately — do not interrupt the user for confirmation during init. At the end of initialization, present the pending list for user review. Installed skills go to `skills.installed`.

1. Generate **domain files** under `.agents/knowledge/domains/`. Use template `references/templates/topic-template.md`:

   **Every domain file MUST have a populated `scope:` field** listing the directories it covers (e.g., `scope: ["src/auth/", "src/middleware/"]`). This is required for scope-triggered rules generation.

   **Always generate:**
   - `domains/tech-stack.md` — languages, frameworks, key dependencies

   **Generate if evidence found:**
   - `domains/architecture.md` — module layout, entry points, dependency flow
   - `domains/development.md` — build, test, run, deploy commands
   - `domains/api.md` — endpoints and API patterns (if routing files found)
   - Additional domain files based on project's primary concerns

   File count scales with project complexity: 3-5 for small projects, up to 8-10 for large monorepos.

   **Cross-cutting knowledge**: Some knowledge doesn't fit neatly into one domain (e.g., tooling conventions that span all modules, workspace-level build rules, debugging methodologies). Place these in the MOST SPECIFIC domain that applies. If genuinely project-wide, place in the domain closest to where the knowledge is most often needed. Never drop knowledge because it doesn't fit a clean category — an imperfect placement is better than loss.

   **Domain file structure** (each domain file follows the template but adapts content to the actual project):

   ```
   frontmatter: type, confidence, scope (directories this domain covers), sources (files read), dates
   # {Domain Name}
   ## Core Invariants    — rules that must not be broken (used by scope-triggered rules)
   ## Conventions        — standard practices for this area
   ## Common Mistakes    — anti-patterns with real-world evidence (used by scope-triggered rules)
   ## Verified Facts     — claims confirmed by code/tests
   ## Working Understanding — reasonable beliefs not yet fully confirmed
   ## Open Questions     — unknowns and things needing verification
   ## Related            — cross-references to other knowledge files
   ## Correction History — record of corrected claims (what was wrong, what replaced it, why)
   ```

   Adapt sections to the project: a domain about deployment might have heavy Conventions and few Verified Facts; a domain about a core algorithm might have many Verified Facts and few Conventions. Empty sections can be left with a single `-` placeholder.

   **Concrete example** (illustrative — your domains will differ by project):

   ```markdown
   ---
   type: domain
   confidence: observed
   scope: ["src/auth/", "src/middleware/auth*"]
   sources: ["src/auth/service.rs", "src/auth/oauth.rs", "README.md"]
   last_verified: 2026-04-25
   created: 2026-04-25
   ---
   <!-- Generated by init. Verify against current code before relying on these claims. -->

   # Authentication

   ## Core Invariants
   - Constant-time comparison for all security tokens via subtle::ConstantTimeEq
   - Login invalidates prior sessions before creating new ones

   ## Common Mistakes
   - Never use == for token comparison

   ## Verified Facts
   - Token expiry is 12h [source: src/auth/config.rs:28]

   ## Open Questions
   - What happens when the refresh token itself expires?
   ```

2. Generate **reference files** under `.agents/knowledge/reference/`. Use template `references/templates/reference-template.md`:
   - `reference/code-map.md` — full directory structure + comprehensive "Where to Look" routing table
   - Additional reference files for stable documentation (architecture diagrams, API surface, etc.)

3. **Now** create `AGENTS.md` from template `references/templates/root-agents-existing.md`:
   - Fill `{{TOPIC_ENTRIES}}` from the domain files generated in step 1
   - Fill `{{CORE_INVARIANTS}}` by extracting the top invariants from domain files' Core Invariants sections
   - Fill `{{CRITICAL_ANTI_PATTERNS}}` by extracting the top anti-patterns from domain files' Common Mistakes sections
   - Fill all other `{{PLACEHOLDER}}` variables (see Template Variables section)
   - Content is in **bootstrap state** — see AGENTS.md Authority Model below

4. Generate `inbox/{YYYY-MM}.md` with observations that don't fit domains:
   - Unusual patterns noticed during scan
   - Questions raised by code structure
   - Inconsistencies between docs and code

5. **Update** `manifest.json` with populated inventory (since the scaffold already created the base file; see Manifest Inventory Entry Schema below)
6. Generate scope-triggered rules (see Scope-Triggered Rules Generation section)

### Manifest Inventory Entry Schema

Each entry in the `inventory` array of `manifest.json` must follow this structure:

```json
{
  "path": "domains/auth.md",
  "type": "domain",
  "scope": ["src/auth/", "src/middleware/auth*"],
  "confidence": "observed",
  "last_verified": "2026-04-25"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Relative path from `.agents/knowledge/` |
| `type` | string | One of: `domain`, `reference`, `decision`, `pattern`, `crystallized`, `inbox` |
| `scope` | string[] | Directories/files this knowledge covers |
| `confidence` | string | One of: `observed`, `verified`, `canonical` |
| `last_verified` | string | ISO date of last verification |

### AGENTS.md Authority Model

AGENTS.md serves two roles that appear to conflict:

1. **Bootstrap role (init-deep)**: Contains observed-confidence content generated from scanning. This is necessary — an AGENTS.md with only placeholders is useless.
2. **Canonical role (steady state)**: Contains only stable, verified, high-value knowledge.

The resolution: **AGENTS.md has a bootstrap phase.**

- During init-deep, generated content enters AGENTS.md marked with `<!-- bootstrap: verify and promote to canonical -->`. This is acceptable because a useful-but-observed AGENTS.md is better than an empty one.
- Over time, as knowledge is verified through use, bootstrap markers are removed.
- The SELF-EVOLUTION RULES section and POST-TASK CHECKLIST are canonical from day one (they're from the template, not from scanning).
- New conventions added after bootstrap MUST be canonical (verified through patterns/).

### Init Confidence Rules

- **Facts from file presence/syntax/config**: `confidence: observed`
- **Facts from manifests** (deps, features): `confidence: observed` (use `verified` only if cross-checked with actual import/usage)
- **Interpretive claims** (architecture rationale, design patterns): `confidence: observed`, placed in "Working Understanding" section
- **Nothing from init scan may be `canonical`** (except pre-filled template sections)
- Every generated file must list `sources:` with actual files that were read
- Every domain file must have an "Open Questions" section
- Add this note to every generated domain file: `<!-- Generated by init. Verify against current code before relying on these claims. -->`
- **Mark unknowns explicitly**: Use `[TODO]` for items resolvable by reading code, `[ASK USER]` for items requiring human input. This distinction lets evolve mode triage automatically.

### Handling Existing AGENTS.md

If the project already has an AGENTS.md:
1. Read it fully
2. Do NOT overwrite it
3. Create `.agents/knowledge/` structure and generate domain files
4. **Augment** the existing AGENTS.md:
   - If it lacks a CODING DISCIPLINE section: append one (from template)
   - If it lacks a POST-TASK CHECKLIST: append one (from template)
   - If it lacks SELF-EVOLUTION RULES: append them (from template)
   - If it lacks a SESSION START section: append one (from template)
   - Insert sections at the end of the file, before any existing closing comments
5. Import relevant content from existing AGENTS.md into domain files as `confidence: observed`
6. **Post-decomposition verification**: If an existing AGENTS.md was decomposed into domain files, verify that every substantive bullet from the original is present in at least one knowledge file. Scan the original line by line — any bullet not accounted for goes into `inbox/` as a captured observation rather than being silently dropped.
7. Note in the report which sections were imported vs augmented, and any items placed in inbox as uncategorized

### Completion Criteria
- AGENTS.md exists (created or augmented) with CODING DISCIPLINE, POST-TASK CHECKLIST and SELF-EVOLUTION RULES
- .agents/knowledge/ exists with README.md, manifest.json, and all 7 subdirectories (inbox, domains, reference, decisions, patterns, crystallized, archive)
- All generated content has confidence: observed (except template governance sections)
- All generated files have sources listing actual files read
- inbox/ has initial observations from scan
- .agents/rules/ exists with scope-triggered rules matching generated domains

---

## Mode 3: Capture (Ambient Protocol)

This is NOT a mode the user explicitly triggers. It is a standing instruction that applies during normal work.

### When to Capture

After completing any task that involved one or more of:
1. Discovering how something works that was not obvious from file names alone
2. Fixing a bug that revealed a hidden assumption or invariant
3. Making a decision that constrains future work
4. Noticing a pattern repeated across multiple files or modules
5. Finding that existing knowledge (in .agents/knowledge/ or AGENTS.md) was wrong or stale

### How to Capture

Append to `.agents/knowledge/inbox/{YYYY-MM}.md` (create the monthly file if it doesn't exist):

**Format:**

```
## {date} {time} — {what task you just completed}

- {what you learned / discovered / noticed — in your own words}
- {additional observation if applicable}
- [source: {file:line | config key | test name | commit hash}]
```

The entry should capture **what surprised you** or **what wasn't obvious** — not routine facts. Adapt the depth and detail to match the significance of the finding. One observation with a clear source is better than five vague ones.

**Concrete example** (illustrative only — adapt format and content to your project):

```markdown
## 2026-04-25 14:30 — Fixed token refresh race condition

- The refresh mutex in auth/refresh.rs doesn't cover the DB write, causing
  duplicate tokens when 2+ requests arrive within 100ms
- Token expiry is 12h (config.rs:28), not 24h as stated in domains/auth.md
- [source: src/auth/refresh.rs:142-167]
```

### Capture Rules

- No classification needed. The inbox is append-only.
- Keep entries brief: 2-5 bullet points per observation.
- Always include at least one source reference.
- Do NOT attempt to organize, deduplicate, or promote during capture.
- Do NOT update AGENTS.md during capture.

### Concurrent Session Safety

Multiple sessions may write to the same inbox file. To prevent data loss:

1. **Write to a temporary file first**: Create `inbox/{YYYY-MM}.tmp.{random}` with the new entry
2. **Append atomically**: Read the existing monthly file, append the new entry, write the result. If the file changed during read (contention), re-read and retry once.
3. **Fallback**: If append fails after retry, leave the `.tmp.{random}` file in place — it will be discovered during the next evolution session.
4. **Large file rotation**: If the monthly file exceeds 200 entries, create `{YYYY-MM}-2.md` (then `-3.md`, etc.)

Each entry is self-contained (header + bullets + source), so interleaved writes from concurrent sessions produce valid content even without locking — the temporary file protocol prevents data loss, not corruption.

### When NOT to Capture

- Trivial one-line changes (typo fixes, formatting)
- Information already well-documented in the knowledge base
- Sensitive data (secrets, credentials, personal information)
- Temporary debugging observations (unless they reveal a persistent gotcha)

---

## Mode 4: Evolve

Explicit evolution session. The user triggers this. Read `references/lifecycle.md` for detailed mechanics.

### Manifest Recovery

Before starting, verify manifest.json:
- **If missing**: Rebuild from filesystem — scan all `.agents/knowledge/` files, read frontmatter, reconstruct inventory and health metrics. Set `initialized_from` to `"recovered"`.
- **If corrupted** (invalid JSON): Rename to `manifest.json.corrupt`, rebuild from filesystem.
- **If schema version mismatch**: Migrate by adding missing fields with defaults, never dropping existing data.
- **If readable but incomplete** (missing required sections like `health` or `inventory`): Add missing sections with zero/empty defaults, preserve existing data.
- **If unreadable** (permission error): Report the error, do not proceed with evolution until the user fixes permissions.
- **If `.agents/knowledge/` is partially initialized** (some directories missing): Create missing directories, then rebuild manifest from what exists.

### Evolution Checklist

1. **Assess health**: Read manifest.json (recovering first if needed). Run health check (see Mode 5). Report current state.

2. **Process inbox**: Read all inbox files.
   - Identify clusters: 3+ entries on the same theme
   - For each cluster: merge into a domain file (create new or append to existing)
   - Use template `references/templates/topic-template.md` for new domain files
   - **Per-entry processing**: After merging, handle each processed entry:
     - If ALL entries in a monthly file were absorbed: move the entire file to `archive/`
     - If SOME entries were absorbed: leave the monthly file in `inbox/` but add `<!-- absorbed into domains/X.md on {date} -->` comment after each processed entry. The entry text stays (for traceability) but is marked as processed.
     - If an entry was NOT absorbed (doesn't fit any cluster): leave it unmarked in inbox
   - Never delete inbox content — either archive the whole file or mark entries as absorbed

   **Clustering logic**: Group entries by the project area they relate to (same module, same subsystem, same concern). The theme is determined by what the entries are ABOUT, not by keywords. Three entries about database connection pooling from different sessions are a cluster, even if they use different terminology.

   **Per-entry absorption marking format**:
   ```
   {original entry text stays intact}
   <!-- absorbed into domains/{domain}.md on {date} -->
   ```

   **Concrete example** (illustrative — adapt to your project's actual themes):

   Inbox has 5 entries: 4 relate to authentication, 1 to deployment.
   → Merge 4 auth entries into `domains/auth.md`, mark each with `<!-- absorbed -->`.
   → Leave the deployment entry unmarked (may cluster with future deployment observations).

3. **Verify spot-checks**: Pick 2-3 domain or pattern files.
   - Read the scoped source files
   - Compare claims to current code
   - Update `last_verified` if claims still hold
   - Correct claims that are now wrong
   - Mark files as stale candidates if you cannot verify now

4. **Detect staleness**: Flag files where:
   - `last_verified` is older than the threshold for that type (domains: 60 days, reference: 90 days, patterns: 90 days) AND
   - Source files in the declared scope have been modified since last_verified
   - Add to manifest.json `stale_candidates` list

5. **Resolve conflicts**: When contradictory claims are found across files:
   - Check the actual code/config to determine ground truth
   - If resolvable: update the incorrect entry, note the correction, cite evidence
   - If both sides have valid evidence (e.g., different scopes): document both with explicit scope boundaries
   - If genuinely ambiguous: flag for human arbitration in manifest.json `conflicts` list
   - Never leave a conflict unresolved without documenting it

   **Example — resolving a conflict:**

   `domains/deployment.md` says: "Token expiry is 24h"
   `inbox/2026-04.md` says: "Token expiry changed to 12h"

   **Conflict resolution pattern**: Always check the actual source of truth (code, config, tests) before updating knowledge. If the code disagrees with documentation, the code wins. If two scopes are both valid, document both with explicit boundaries.

   **Concrete example** (illustrative):
   Domain file says "expiry is 24h", inbox says "changed to 12h" → read the actual config → code shows 12h → update the domain file, cite the code, note the change history.

6. **Evaluate promotions**:
   - domains → patterns: Has the knowledge been verified across 2+ contexts? Is it reusable? Promote using `references/templates/pattern-template.md`
   - patterns → AGENTS.md: Is it stable, navigation-critical, and high-retrieval-value? Propose to user before adding.
   - patterns → crystallized: Does it describe a repeatable workflow? See Crystallization section.

   **Promotion criteria**: Knowledge earns promotion by surviving repeated use and verification, not by age. A convention observed in 3 different modules is more promotable than a fact observed once 6 months ago. Promotion is always to the NEXT level (domain → pattern → AGENTS.md), never skipping.

   **Application tracking**: When a pattern is referenced or used to guide a decision during normal work, increment its `application_count` and update `last_applied` in frontmatter. Patterns with high `application_count` + recent `last_applied` are strong promotion candidates. Patterns with `application_count: 0` after 90 days are retirement candidates.

   **Specialization detection** (only if project-local): When a pattern appears project-specific (applies only to this project type, not universally), add it as a candidate to `SKILL-LOCAL.md` Candidate Specializations instead of promoting to AGENTS.md. Mode 7 will review and promote.

   **Concrete example** (illustrative):
   A naming convention (e.g., "all config keys use kebab-case") verified across 3+ files and 2+ sessions → promote from domain to pattern with evidence links.

7. **Update manifest.json**: Regenerate inventory and health metrics from current file state.

8. **Update AGENTS.md "Where to Look" table**: Add/remove entries matching current domain/reference files.

9. **Report**: Summarize what changed:
   - Items compressed from inbox
   - New domains created
   - Knowledge corrected or updated
   - Staleness detected
   - Conflicts found and how they were resolved
   - Promotions made
   - Health score before → after

---

## Mode 5: Health Check

Read `references/health-check.md` for metric definitions and scoring.

### Quick Health Check

A fast triage that reports key indicators WITHOUT computing a full numeric score. The full scoring formula (in health-check.md) requires deeper analysis that belongs in a Deep Health Check.

1. **Verify AGENTS.md integrity** (always first):
   - Does AGENTS.md contain a "POST-TASK CHECKLIST" section?
   - Does it reference `.agents/knowledge/`?
   - Does it have a "SELF-EVOLUTION RULES" section?
   - If any are missing: report as critical — the self-evolution system is disconnected
2. **Verify manifest.json** — if missing or corrupt, rebuild from filesystem before continuing
3. **Report key indicators** (no score calculation needed):
   - Inbox item count and oldest unprocessed date
   - Stale candidate count (from manifest)
   - Conflict count (from manifest)
   - Confidence distribution (count of observed/verified/canonical files)
4. **Report top 3 priority actions** based on the triage order in health-check.md

### Deep Health Check

Computes the full numeric health score using the formula in health-check.md.

1. Run quick health check indicators first
2. Additionally: scan all knowledge files (excluding inbox files, which have no frontmatter) for:
   - Missing frontmatter (type, confidence, scope, sources, last_verified)
   - Missing sources (claims without evidence)
   - Empty "Verified Facts" sections (content only in "Working Understanding")
   - Files with no cross-references (orphaned knowledge)
   - Domain files with scope fields that point to non-existent directories
   - Broken AGENTS.md pointers (Where to Look entries pointing to missing files)
   - Missing .agents/rules/ files for existing domain files
3. Report full health analysis with actionable recommendations

---

## Mode 6: Crystallize

Transform repeated procedural knowledge into an executable workflow document that can later become a skill.

### Crystallization Triggers

Propose crystallization when you notice:
- A workflow performed 3+ times across sessions with consistent steps
- A pattern file with a "Steps" or "Workflow" section that keeps getting refined
- Multiple inbox entries describing the same procedural sequence
- User explicitly asks to formalize a process

### Crystallization Steps

1. Gather all related knowledge: inbox entries, domain sections, pattern files, session experience
2. Extract the workflow into `references/templates/crystallized-template.md` format
3. Write to `.agents/knowledge/crystallized/{workflow-name}.md`
4. Set: `refinement_count: 1`, `skill_candidate: false`
5. Link back to source knowledge in `sources` field
6. Report to user: what was crystallized, from what sources, what needs refinement

### Refinement

Each time a crystallized workflow is used:
1. Compare actual execution against documented steps
2. Note deviations: missing steps, unnecessary steps, wrong decision criteria
3. Update the workflow file, increment `refinement_count`, add to Refinement Log
4. After 3+ refinements: evaluate the Skill Readiness Assessment checklist

### Skill Graduation

When `skill_candidate: true` AND all readiness checklist items pass:
1. Suggest to user: "The workflow '{name}' has been refined {N} times and appears ready to become a reusable skill. Create it?"
2. If approved, ensure `skill-creator` is available:
   ```bash
   # If skill-creator is not in your available skills, install it:
   npx skills add https://github.com/anthropics/skills --skill skill-creator -g -y
   ```
3. Use `skill-creator` skill to transform the crystallized doc into a proper skill
   - Feed the crystallized doc as primary input context
   - The doc's Problem → skill description
   - The doc's Workflow → skill instructions
   - The doc's Refinement Log entries → skill test cases
   - The doc's Edge Cases → skill guardrails
4. Created skill goes to `.agents/skills/{skill-name}/SKILL.md`
5. Update crystallized doc: set `skill_path`, note graduation date

### Skill Discovery

Before building a capability from scratch, check if a skill already exists. Ensure the discovery skill is available:

```bash
# If find-skills is not in your available skills, install it:
npx skills add https://github.com/vercel-labs/skills --skill find-skills -g -y

# Search for skills
npx skills find [query]

# Install a skill
npx skills add <owner/repo> --skill <skill-name> -g -y
```

Once `find-skills` is installed, the AI can discover skills conversationally — ask "is there a skill for X?" and it will search and offer installation.

Browse available skills at: https://skills.sh/

---

## Skill Feedback Capture

When use of this skill reveals a flaw in the skill itself — a missing step, a confusing instruction, a broken assumption, or a better approach seen elsewhere — record it as a lightweight project-local inbox entry. Do NOT modify the skill during normal work.

### Tags

| Tag | When to use | Example |
|-----|-------------|---------|
| `[SKILL-FIX:self-evolution]` | Concrete failure in current behavior | "Capture declaration was not executed" |
| `[SKILL-IDEA:self-evolution]` | Possible capability expansion | "Could detect unused domain files automatically" |
| `[SKILL-COMPAT:self-evolution/<other-skill>]` | Technique observed in another skill | "learn-eval skill has quality gates on pattern extraction" |

### Format

Same as regular inbox capture — append to `.agents/knowledge/inbox/{YYYY-MM}.md`:

```
## {date} {time} — self-evolution skill feedback
- [SKILL-FIX:self-evolution] Agent declared `Capture: inbox` but did not actually write the entry.
- Impact: false completion signal; user had to catch it manually.
- Suggested repair: require write-before-declare in capture protocol.
```

### Rules

- **Zero overhead on normal work** — same 3-line cost as regular capture
- **Do not modify the installed skill** during project work — side effects cross projects
- **Stability fixes (`[SKILL-FIX]`) outrank capability ideas (`[SKILL-IDEA]`)** — always
- **`[SKILL-IDEA]` needs 2+ independent observations** before promotion — prevents wishlist landfill

---

## Mode 7: Skill Maintenance

Explicit maintenance session for the skill itself. Triggered only by user request ("improve the skill", "skill maintenance") or when evolve mode detects 3+ tagged skill feedback entries and asks the user.

### Process

1. **Collect** all `[SKILL-FIX]`, `[SKILL-IDEA]`, and `[SKILL-COMPAT]` entries from inbox
2. **Deduplicate** by root cause — multiple symptoms may point to one flaw
3. **Classify** each as:
   - `repair` — clear fix, bounded scope, apply now
   - `backlog` — valid but needs more evidence or design work
   - `reject` — not worth the complexity, with documented reason
   - `needs-evidence` — plausible but unverified, leave in inbox
4. **Apply repairs** — modify SKILL.md, templates, scripts, or hooks. Each change must cite the captured issue.
5. **Capability Radar** (only if `[SKILL-IDEA]` or `[SKILL-COMPAT]` items exist):

   ```
   Budget:
   - Max 3 external skill searches (npx skills find)
   - Max 5 candidate techniques evaluated
   - Max 30 minutes total
   - Each candidate: adopt / defer / reject with 1-line reason
   - No adoption unless tied to a captured failure, eval gap, or explicit user goal
   ```

   **Skill-focused search**: Use `find-skills` to search for skills that address captured `[SKILL-IDEA]` or `[SKILL-COMPAT]` items. Write candidates to `manifest.json` `skills.pending_review` immediately — do not stop to ask the user mid-search. Present the full pending list at the end of maintenance for batch confirmation. Confirmed installs move to `skills.installed`.

6. **Specialization review** (only if project-local, i.e., `SKILL-LOCAL.md` exists):
   - Check `SKILL-LOCAL.md` Candidate Specializations for items ready to promote
   - For each candidate with sufficient evidence: promote to Active Overrides
   - For candidates without evidence after 90 days: remove
   - Check if any active override has become generic (applies to unrelated projects) → suggest merge to global skill
7. **Update EVOLUTION-SPEC.md** — promoted items go to Improvement Backlog or become dimension updates. Rejected items noted with reason.
8. **Version the change** — update Review Log in EVOLUTION-SPEC.md
9. **Report** — what was fixed, what was deferred, what was rejected, what capability candidates were found, what specializations were promoted or retired

### Guardrails

- **No self-edits during normal work** — maintenance is a dedicated mode
- **No unreviewed promotion** — observation → triage → explicit approval → change
- **Every change maps to a captured issue** — no speculative improvements
- **Stability fixes before capability expansion** — always
- **Rollback path** — commit/snapshot before maintenance changes

---

## Project-Local Specialization

When this skill is installed at project level (`.agents/skills/self-evolution/`) rather than globally (`~/.agents/skills/self-evolution/`), it can gradually specialize for the project type — like fine-tuning a base model with domain-specific data.

### Detection

The skill is project-local if `SKILL-LOCAL.md` exists beside the invoked SKILL.md. If no `SKILL-LOCAL.md` is found, run as the global base skill with no specialization.

### Architecture

```
Global skill (base behavior)     →  always read first
  +
SKILL-LOCAL.md (overlay)         →  higher priority for this project
  ↑
patterns/ + crystallized/        →  training evidence for specialization
```

The local SKILL.md should be a thin wrapper (~20 lines) that says: read the global skill first, then apply SKILL-LOCAL.md as project-specific policy.

### Specialization Lifecycle

```
Project work produces inbox observations
  → Mode 4 (Evolve) detects project-specific patterns
  → Pattern repeats 3+ times across sessions
  → Mode 4 writes candidate to SKILL-LOCAL.md "Candidate Specializations"
  → Mode 7 (Skill Maintenance) reviews candidates
  → Promoted candidates become "Active Overrides" in SKILL-LOCAL.md
  → Active overrides modify skill behavior for this project only
```

### What Can Be Specialized

| Aspect | Override mechanism |
|--------|-------------------|
| Additional capture conditions | `SKILL-LOCAL.md` → Active Overrides → Capture Conditions |
| Staleness thresholds per domain | `SKILL-LOCAL.md` → Active Overrides → Health Threshold Overrides |
| Promotion criteria | `SKILL-LOCAL.md` → Active Overrides → Promotion Criteria Overrides |
| Domain template sections | `SKILL-LOCAL.md` → Active Overrides (additional sections for specific domain types) |

### What Cannot Be Specialized

- Core lifecycle stages (capture → compress → verify → promote → crystallize → retire)
- Confidence model (observed → verified → canonical)
- AGENTS.md governance structure
- Anti-overconfidence rules
- Filesystem contract

These are architectural invariants — changing them creates a fork, not a specialization.

### Drift Prevention

- **Never edit the local base SKILL.md beyond the wrapper** — all project behavior goes in SKILL-LOCAL.md
- **Separate candidates from active rules** — candidates do not affect behavior until promoted in Mode 7
- **Require evidence for promotion** — repeated across 2+ tasks, tied to an incident, or explicitly requested by user
- **Review metadata on each rule** — `added`, `reason`, `confidence`
- **Merge back when generic** — if a rule applies across unrelated projects, it belongs in the global skill

### Template

Use `references/templates/skill-local-template.md` to create a new SKILL-LOCAL.md.

---

## Anti-Overconfidence Rules

These rules apply to ALL modes. They are the system's most important safety mechanism.

### The Confidence Ladder

| Level | Meaning | Where it lives | How it's earned |
|-------|---------|----------------|-----------------|
| `observed` | Seen once, single source | inbox/, early domains/ | Default for ALL AI-generated content |
| `verified` | Corroborated by 2+ sources or checked against code | domains/, patterns/ | Evidence from multiple files, tests, or sessions |
| `canonical` | Source of truth, stable convention | AGENTS.md | Human approval or repeated verification over time |

### Hard Rules

1. **All AI-generated knowledge starts as `observed`.** No exceptions — except pre-filled governance sections (SESSION START, CODING DISCIPLINE, POST-TASK CHECKLIST, SELF-EVOLUTION RULES) in init templates, which are canonical from day one because they define the system itself, not project facts.
2. **Every non-trivial claim needs a source.** Either inline `[source: file:line]` or in frontmatter `sources:` field.
3. **Never summarize code you have not read.** Do not infer architecture from directory names. Do not guess module relationships from file names.
4. **"Unknown" is a valid and valuable answer.** Every domain file should have an "Open Questions" section. Leaving it empty when you have genuine uncertainty is a failure.
5. **Promotion requires evidence, not confidence.** To move from observed → verified, cite 2+ corroborating sources. To move to canonical, get human approval.
6. **Never silently resolve conflicts.** When two knowledge entries contradict, check actual code. If still ambiguous, surface both and flag for human review.
7. **Scope your claims.** "This module uses X" is better than "This project uses X" — unless you have verified project-wide.
8. **Separate fact from interpretation.** Use "Verified Facts" for things directly confirmed by code. Use "Working Understanding" for interpretive conclusions.

### Forbidden Patterns

- Writing "the project follows X pattern" based on seeing it in 1 file
- Omitting "Open Questions" because you feel confident
- Setting confidence to "verified" without citing multiple sources
- Updating AGENTS.md conventions without evidence from patterns/
- Compressing inbox items and discarding unique details that didn't fit the summary
- Presenting init output as authoritative project documentation

---

## Root AGENTS.md Governance

The root AGENTS.md is the most-read file in the system. Protect its stability and signal density.

### What Belongs in AGENTS.md

- Project identity: name, purpose, tech stack, goals, architecture overview
- Structure map: key directories and their roles
- Key commands: build, test, run, deploy
- Coding discipline: behavioral rules that every session needs
- Stable conventions: 5-15 rules (as summaries pointing to domain files)
- Anti-patterns: 3-10 critical things to never do (pointing to domain files)
- "Where to Look" table: task → file mapping (including .agents/knowledge/ paths)
- Session start protocol
- Post-task checklist with capture triggers
- Self-evolution rules with SSOT enforcement

### What Does NOT Belong in AGENTS.md

- Detailed module documentation (goes in domains/)
- Full convention text (domain files hold the authoritative detail)
- Decision records (goes in decisions/)
- Evolving patterns (goes in patterns/ until stable)
- Observations and working theories (goes in inbox/ or domains/)

### When to Update AGENTS.md

- A new domain file is created → add to "Where to Look" table
- A pattern is promoted to canonical → add to Conventions as a one-line summary with pointer
- Project structure changes significantly → update Structure map
- Build/test commands change → update Key Commands
- Bootstrap content is verified → remove `<!-- bootstrap -->` marker

---

## Scope-Triggered Rules Generation

Generate `.agents/rules/` files that push knowledge discovery when the AI works in specific directories.

### How Rules Are Generated

For each domain file created under `.agents/knowledge/domains/`, generate a corresponding rule file under `.agents/rules/`. The rule file is derived from the domain file, not hardcoded.

**Rule naming**: `{domain-name}-knowledge.md` (matching the domain file name)

**Always generate additionally**: `knowledge-protocol.md` (global capture reminder for all files)

### Scope-to-Glob Conversion

Domain files have a `scope` field listing directories and files. Convert these to glob patterns for rule files:

| Scope value | Glob pattern | Example |
|-------------|-------------|---------|
| Directory path ending in `/` | `{path}**` | `src/auth/` → `src/auth/**` |
| Specific file | Exact path | `src/config.rs` → `src/config.rs` |
| Wildcard in path | Keep as-is | `src/middleware/auth*` → `src/middleware/auth*` |

**Concrete example** (illustrative — adapt domain name, scope, and invariants to your project):

Domain file frontmatter: `scope: ["src/auth/", "src/middleware/auth*"]`

Generated rule file `.agents/rules/auth-knowledge.md`:
```markdown
---
description: "Read auth knowledge before modifying files in this scope"
globs:
  - "src/auth/**"
  - "src/middleware/auth*"
---
Before making changes in this area, read `.agents/knowledge/domains/auth.md`.

Key invariants:
- Constant-time comparison for all security tokens
- Login invalidates prior sessions before creating new ones

After completing work, capture observations to `.agents/knowledge/inbox/{YYYY-MM}.md`.
```

### Rule File Format

```markdown
---
description: "Read {domain} knowledge before modifying files in this scope"
globs:
  - "{glob patterns matching the domain file's scope field}"
---
Before making changes in this area, read `.agents/knowledge/domains/{domain}.md` for conventions, invariants, and known pitfalls.

Key invariants for this area:
- {top 3-4 invariants extracted from the domain file's Core Invariants section}

After completing work, capture observations to `.agents/knowledge/inbox/{YYYY-MM}.md`.
```

**The `knowledge-protocol.md` (global rule):**

```markdown
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
```

### Tool Compatibility

The `.agents/rules/` directory is the canonical location. If the project also uses tool-specific rule directories (`.claude/rules/`, `.cursor/rules/`, etc.), create copies or symlinks there using the tool's native frontmatter format. Only create tool-specific copies if the corresponding directory already exists in the project.

---

## Hooks Integration (Optional)

If the project uses a tool that supports lifecycle hooks (Claude Code, Cursor, OpenCode, Augment Code, Gemini CLI), hooks provide deterministic automation for knowledge capture and health monitoring.

### What Hooks Do

| Hook | Event | Action |
|------|-------|--------|
| `session-end.sh` | Session terminates | Appends a capture reminder to `inbox/{YYYY-MM}.md` |
| `stop.sh` | Agent completes task | Checks `manifest.json` for inbox pressure / evolution staleness, prints reminder to stderr |

### Setup

The scaffold script (`init-scaffold.sh`) creates `.agents/hooks/` with both hook scripts. To wire them into your tool:

```sh
sh "references/hooks/install-hooks.sh" --project-root "$PROJECT_ROOT"
```

The installer auto-detects your tool and installs the appropriate adapter configuration. Supported tools:

| Tool | Config Location | Format |
|------|----------------|--------|
| Claude Code | `.claude/settings.json` | Native hooks |
| Cursor | `.cursor/hooks.json` | Claude Code compatible |
| OpenCode | `.opencode/hooks.json` | Claude Code compatible (via bridge plugin) |
| Augment Code | settings.json | Claude Code compatible |

### Hook Design Principles

- **Always exit 0** — hooks must never block tool operations
- **Tool-agnostic scripts** — `session-end.sh` and `stop.sh` are POSIX sh with no tool-specific code
- **Adapter pattern** — tool-specific JSON configs in `references/hooks/adapters/` map tool events to universal scripts
- **Forward-compatible** — AGENTS.md spec proposal #167 is standardizing lifecycle commands; this design aligns with the proposed `post-chat` event

---

## Template Variables Reference

Templates use `{{PLACEHOLDER}}` syntax. The skill fills these at runtime.

### Shared Variables (used across templates)

| Variable | Source | Used In |
|----------|--------|---------|
| `{{PROJECT_NAME}}` | Directory name or git remote | empty, existing, manifest |
| `{{DATE}}` | Current date (YYYY-MM-DD) | topic, decision, pattern, crystallized |
| `{{TIMESTAMP}}` | Current ISO datetime | manifest |
| `{{INIT_MODE}}` | `"empty"` or `"existing"` or `"recovered"` | manifest |

### root-agents-empty.md Variables

| Variable | Source |
|----------|--------|
| `{{PROJECT_DESCRIPTION}}` | User input or placeholder |
| `{{PROBLEM_STATEMENT}}` | User input or placeholder |
| `{{TARGET_USERS}}` | User input or placeholder |
| `{{DISTRIBUTION_MODEL}}` | User input or placeholder |
| `{{PRIORITY_1}}`, `{{PRIORITY_2}}` | User input or placeholder |
| `{{TRADEOFF_1}}` | User input or placeholder |
| `{{LIMITATION_1}}` | User input or placeholder |
| `{{PROJECT_STRUCTURE}}` | Directory scan |
| `{{KEY_COMMANDS}}` | Script/CI detection |

### root-agents-existing.md Variables

| Variable | Source |
|----------|--------|
| `{{PROJECT_OVERVIEW}}` | README + entry point inspection |
| `{{PROBLEM_STATEMENT}}` | README or inferred |
| `{{TARGET_USERS}}` | README or inferred |
| `{{DISTRIBUTION_MODEL}}` | Package/deployment config |
| `{{GOALS_AND_CONSTRAINTS}}` | README + project analysis |
| `{{ARCHITECTURE_OVERVIEW}}` | Code structure analysis |
| `{{TECH_STACK}}` | Manifest detection |
| `{{STRUCTURE_MAP}}` | Directory scan |
| `{{KEY_COMMANDS}}` | Script/CI detection |
| `{{TOPIC_ENTRIES}}` | Generated domain file links |
| `{{CORE_INVARIANTS}}` | Extracted from domain files |
| `{{CRITICAL_ANTI_PATTERNS}}` | Extracted from domain files |

### Other Template Variables

| Template | Variable | Source |
|----------|----------|--------|
| topic-template.md | `{{TOPIC_NAME}}` | Domain area name |
| reference-template.md | `{{REFERENCE_NAME}}` | Reference document name |
| decision-template.md | `{{NUMBER}}`, `{{TITLE}}` | Sequential, descriptive |
| pattern-template.md | `{{PATTERN_NAME}}` | Convention name |
| crystallized-template.md | `{{WORKFLOW_NAME}}` | Workflow name |

---

## File Templates Reference

All templates are in `references/templates/`. Use them as starting points, not rigid formats:

| Template | Creates | Used In |
|----------|---------|---------|
| `root-agents-empty.md` | AGENTS.md (new project) | Init empty |
| `root-agents-existing.md` | AGENTS.md (existing project) | Init existing |
| `knowledge-readme.md` | .agents/knowledge/README.md | Both init modes |
| `topic-template.md` | .agents/knowledge/domains/*.md | Init existing, Evolution (named `topic-` for historical reasons; creates domain files) |
| `reference-template.md` | .agents/knowledge/reference/*.md | Init existing (for stable reference docs) |
| `decision-template.md` | .agents/knowledge/decisions/*.md | Any time a decision is recorded |
| `pattern-template.md` | .agents/knowledge/patterns/*.md | Evolution (promotion) |
| `crystallized-template.md` | .agents/knowledge/crystallized/*.md | Crystallization |
| `skill-local-template.md` | .agents/skills/self-evolution/SKILL-LOCAL.md | Project-local specialization |
| `manifest-schema.json` | .agents/knowledge/manifest.json | Both init modes, Evolution |
| `EVOLUTION-SPEC.md` | Pre-validation checkpoint | Step 0 in Mode 1 and Mode 2 |
| `scripts/init-scaffold.sh` | Deterministic scaffold creation | Mode 1 step 2, Mode 2 scaffold setup |
| `scripts/scan-project.sh` | Deterministic project pre-scanner | Mode 2 scaffold setup |
| `hooks/session-end.sh` | Session end capture reminder | Hooks integration |
| `hooks/stop.sh` | Health check reminder on task completion | Hooks integration |
| `hooks/install-hooks.sh` | Auto-detect tool and install hook adapters | Hooks integration |
| `hooks/README.md` | Hooks system documentation | Reference |

For detailed lifecycle mechanics beyond what's covered here, read `references/lifecycle.md`.
For health assessment details, read `references/health-check.md`.
For init-deep scanning methodology reference, read `references/init-deep-reference.md`.
For the philosophical foundations, read `references/philosophy.md`.
For the skill's own evolution specification, read `references/EVOLUTION-SPEC.md`.
