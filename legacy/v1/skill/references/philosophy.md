# Philosophy: Why the System Works This Way

Read this when making judgment calls not covered by SKILL.md, or when you need to understand why a rule exists.

## The Three Gaps

Software projects have three persistent gaps between reality and understanding. Every design decision in this system targets one or more of them.

### Reality Gap

The project's actual state includes code, configuration, runtime behavior, team conventions, undocumented decisions, and failed experiments that shaped current design. Documentation always lags behind this actual state because the people producing knowledge are focused on producing code, not docs.

The system addresses this gap by making capture near-zero-friction. If the cost of recording an observation approaches zero, more observations get recorded, and the gap narrows continuously rather than in periodic bursts of documentation effort that decay.

### Access Gap

Even well-documented projects fail here. Knowledge exists in files, but a new AI session or new team member cannot find the right piece at the right time. A 1500-line AGENTS.md contains the answer, but loading all of it wastes context budget, and the consumer cannot tell which parts matter for the current task.

The system addresses this gap through layered entry points: root AGENTS.md as a thin router, scope-tagged topic files for drill-down, and manifest.json as a machine-readable index. Knowledge is organized for retrieval, not for display.

### Trust Gap
<!-- anchor: trust-gap -->

This is the most insidious gap. Loaded knowledge looks authoritative regardless of whether it was verified yesterday or written speculatively six months ago. AI-generated summaries and human-authored facts have the same visual authority in a markdown file.

The system addresses this gap through the confidence ladder (observed/verified/canonical), explicit source references, and the rule that all AI-generated knowledge starts at the lowest trust level.

## Why Static Documentation Fails

Static documentation is built on four assumptions that do not hold in real projects:

1. **Structure can be pre-designed.** It cannot. Knowledge topology follows project evolution. An auth module that was a single file six months ago is now five files with three cross-cutting concerns. Pre-designed categories become wrong.

2. **Maintenance can be separated from development.** It cannot. The knowledge producers ARE the developers. When documentation is a separate task from coding, it gets skipped under deadline pressure and never catches up.

3. **Write-once-read-many is the dominant pattern.** It is not. Knowledge gets modified, split, merged, superseded, and retired. A document written once becomes a historical artifact, not a living reference.

4. **Consumers will filter stale content themselves.** They will not. Especially AI consumers, who treat all text in their context window with roughly equal authority.

The conclusion is not "write better docs." It is: documentation systems must treat change, staleness, and uncertainty as first-class concerns, not afterthoughts.

## Knowledge Is Heterogeneous

Project knowledge includes at least twelve distinct types, each with different lifecycles, verification methods, and confidence characteristics:

| Type | Example | Verification | Lifetime |
|------|---------|-------------|----------|
| Facts | "The API runs on port 8317" | Check code/config | Until changed |
| Decisions | "We chose event sourcing over CRUD" | Check with decision-makers | Until superseded |
| Conventions | "Use kebab-case for config keys" | Check codebase consistency | Until explicitly changed |
| Patterns | "Error handlers follow X structure" | Check multiple instances | Until refactored |
| Warnings | "Never use == for token comparison" | Check incident history | Long-lived |
| Relationships | "Module A depends on Module B's events" | Trace code paths | Until architecture changes |
| Observations | "The build seems slower after the migration" | Needs measurement | Short-lived unless verified |
| Business understanding | "Users expect real-time updates" | Check with product owners | Until requirements change |
| Environment knowledge | "CI uses Alpine containers" | Check CI config | Until infra changes |
| Preferences | "We prefer small functions" | Check team consensus | Indefinite, soft |
| Historical knowledge | "We used MongoDB before PostgreSQL" | Check git history | Permanent but contextual |
| Migration knowledge | "Old API still serves traffic during transition" | Check deployment config | Until migration completes |

These types cannot share a single format or lifecycle. A fact from code and an observation from a debugging session require different confidence defaults, different verification methods, and different retirement triggers. The system accommodates this heterogeneity through flexible frontmatter rather than rigid categories.

## Knowledge Has a Lifecycle
<!-- anchor: knowledge-lifecycle -->

Knowledge is born, matures, ages, and dies. Systems that do not model this lifecycle accumulate zombie knowledge that actively misleads.

The ten stages:

1. **Discovery** - a signal appears during development work
2. **Capture** - the signal is recorded in inbox (low friction, low structure)
3. **Deduplication** - similar observations are merged
4. **Association** - new knowledge is linked to existing context
5. **Retrieval** - knowledge is found and consumed for a specific task
6. **Verification** - claims are checked against code, tests, or runtime behavior
7. **Promotion** - repeatedly verified knowledge moves up the confidence ladder
8. **Compression** - many specific observations become fewer general principles
9. **Staleness detection** - old unverified knowledge is flagged
10. **Retirement** - obsolete knowledge moves to archive

Skip any stage and the system degrades: without capture it forgets, without verification it pollutes, without compression it bloats, without staleness detection it rots, without retirement it loses credibility.

## The Eight Failure Modes

Each failure mode has a structural defense in this system:

| Failure Mode | What Happens | Structural Defense |
|---|---|---|
| **Garbage accumulation** | Everything captured, nothing pruned | Inbox is temporary; evolution compresses; archive retires |
| **Premature fixation** | Experimental conclusions hardened into rules | Confidence ladder prevents observed from being treated as canonical |
| **Summary mythology** | Summaries lose connection to evidence | Sources required on all files; summaries trace to specifics |
| **Duplicate drift** | Same knowledge maintained in 2+ places | Single-topic-per-subject rule; dedup during evolution |
| **Zombie knowledge** | Outdated claims persist silently | Staleness detection flags old unverified files |
| **Classification burden** | Taxonomy harder than the project | Few flat directories; inbox needs no classification at all |
| **AI overconfidence** | One observation written as universal rule | observed-by-default rule; scope bounding; evidence requirements |
| **Entry point failure** | Knowledge exists but cannot be found | AGENTS.md router + manifest.json index + scope matching |

## Project Stage Adaptation

The same structure naturally adapts to different project stages without any mode switching:

**New projects** have a thin AGENTS.md and empty knowledge directories. The system is invisible and costs nothing. Value appears the moment the first useful observation is captured.

**Active development** fills the inbox rapidly. Evolution sessions compress inbox into topics. Patterns begin forming. AGENTS.md gains its first conventions.

**Complex projects** have 10-20 topic files organized by domain. Patterns are well-established. Crystallized workflows emerge. Module-level AGENTS.md files appear for hotspot directories.

**Maintenance phase** sees less inbox activity but more staleness detection. Archive grows. Health checks become the primary evolution driver.

**Migration/refactoring** creates temporal scoping: topics get `scope: { valid_until: "migration-complete" }`. New and old knowledge coexist explicitly rather than conflicting silently.

The system adapts because inbox pressure drives compression, verification drives promotion, staleness detection drives retirement, and the confidence ladder prevents premature fixation. No manual phase declaration is needed.

## The Design Principles

Eight principles, each with the reasoning behind it:

### 1. Low friction over perfect structure
<!-- anchor: low-friction -->
If capture does not happen, nothing else in the system matters. A messy inbox entry is infinitely more valuable than a perfectly structured document that was never written because the author could not decide which template to use.

### 2. Delayed structuring over pre-classification
<!-- anchor: delayed-structuring -->
Premature taxonomy becomes a maintenance burden. Categories that seem right on day one are wrong by month three. Let knowledge accumulate in inbox, then organize when natural clusters emerge.

### 3. Summaries must trace to details
An untraceable summary is unfalsifiable. If a topic file says "we use X pattern" but cannot point to where that pattern was observed, the claim becomes a myth that resists correction even when wrong.

### 4. Confidence must be visible
<!-- anchor: confidence-visible -->
AI consumers cannot distinguish authoritative claims from speculation without structural help. A markdown file looks equally authoritative whether it was written by a senior architect or generated by an AI that read three files. The confidence field provides the missing signal.

### 5. Structure serves retrieval
<!-- anchor: structure-serves-retrieval -->
The only purpose of organizing knowledge is making it findable. If a classification scheme makes knowledge harder to find (because the consumer must learn the taxonomy before searching), the scheme is harmful.

### 6. Knowledge must be allowed to die
<!-- anchor: knowledge-must-die -->
Accumulation without pruning destroys signal-to-noise ratio. A knowledge base with 200 files, 50 of which are stale, is less useful than one with 150 files that are all current. The archive directory makes retirement safe by preserving history without polluting the active view.

### 7. Partial inconsistency is acceptable
Real projects have dual-track states during migrations, experimental branches, and concurrent refactoring. Forcing global consistency at all times means either lying about the current state or blocking all concurrent change. The system allows scoped, temporal, explicitly-marked inconsistency.

### 8. The system must be self-describing
<!-- anchor: self-describing -->
Each new AI session starts from zero context. The README.md teaches the system. The AGENTS.md provides the entry point. The manifest.json provides the index. A session that reads these three files can participate in the knowledge lifecycle without any external documentation.
