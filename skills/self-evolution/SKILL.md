---
name: self-evolution
description: "Initialize, retrieve, correct, maintain, audit, or migrate a lightweight project knowledge system built around AGENTS.md and .agents/knowledge. Use when Codex needs to set up project memory or a project brain, onboard to a repository, create or repair project knowledge, document a durable decision or runbook, audit knowledge correctness or retrieval risk, migrate a v1 self-evolution knowledge base, or install and inspect optional self-evolution tool adapters."
---

# Project Self-Evolution v2

Preserve only project knowledge that a future task can retrieve, verify against current
reality, and use to improve a decision, implementation, or check. Optimize for correct
outcomes and low maintenance cost, not knowledge volume or activity.

## Resolve the Bundled CLI

The deterministic helper is `references/bin/kb.mjs` relative to this installed
skill. Resolve the installed skill directory before invoking it. Do not assume a
global `kb` command exists, and do not run a relative `references/...` path from the
project root.

Use the resolved absolute path in every invocation:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" <command> \
  --project-root "<absolute-project-root>"
```

Require Node.js 22 or newer. Use `--format json` when consuming results
programmatically and `--format text` for user-facing diagnostics.

The CLI performs mechanics; the model owns relevance, value, correctness, conflicts,
abstraction, and safe action.

## Standing Behavior: Retrieve

Retrieve is not a fifth explicit operation. Apply it at every project task start.

1. Read the applicable `AGENTS.md` files for project rules and routing.
2. Understand the task's files, subsystem, operation, and risk before choosing
   knowledge.
3. Select the smallest set of Guides and Decisions whose `scope` or `use_when`
   matches the task.
4. Read those documents before changing the governed area or performing the
   governed operation.
5. Inspect their evidence, limitations, status, and reconsideration conditions.
6. Revalidate material claims when their sources changed, the task is high risk,
   the knowledge is old relative to the system, or observed reality disagrees.
7. Execute the task using current reality as the final factual boundary.

Do not load the entire knowledge base. A matching Guide is guidance, not proof;
missing one is not by itself a reason to create one.

## Choose One Explicit Operation

| User intent | Operation |
|---|---|
| Initialize project memory, onboard, set up AGENTS.md | Onboard |
| Save a durable finding, update knowledge, record a decision | Capture or Correct |
| Clean up, reconcile, refresh, or repair existing knowledge | Maintain |
| Review knowledge quality, risk, correctness, or usefulness | Audit |

If a request combines operations, Retrieve first, then order them by dependency.

## Filesystem Contract

Use this v2 structure:

```text
project/
|-- AGENTS.md
`-- .agents/
    |-- settings.yaml
    |-- knowledge/
    |   |-- index.yaml
    |   |-- guides/
    |   |-- decisions/
    |   |-- observations/
    |   `-- archive/
    `-- generated/
        |-- rules/
        `-- adapters/
```

`kb init` creates only the minimum scaffold. Create knowledge directories on demand;
do not add empty knowledge content to complete the tree. Generated rules and
adapters exist only after explicit opt-in.

- `guides/`: knowledge that changes future action. A Guide may have kind `guide`,
  `runbook`, `map`, or `policy`.
- `decisions/`: important choices, rationale, alternatives, consequences, and
  reconsideration conditions.
- `observations/`: temporary monthly holding files for valuable findings that do
  not yet have a clear authoritative destination.
- `archive/`: superseded or retired content retained for genuine historical use.
- `index.yaml`: generated retrieval metadata. Rebuild it; never hand-edit it.
- `settings.yaml`: user choices that cannot be inferred from files. Do not put
  knowledge health, counts, or semantic judgments in settings.

Do not recreate v1 `inbox`, `domains`, `reference`, `patterns`, `crystallized`,
`manifest.json`, confidence levels, health scores, promotion counters, skill queues,
or project-local Skill overlays.

## Knowledge Contracts

Read `references/data-model.md` when changing a Guide, Decision, Observation, index,
settings, or root AGENTS file. Use `references/templates/` as starting assets and
`references/schemas/` as validation contracts.

### AGENTS.md

Keep the root file small and high signal: state the few rules and commands that must
always be known, and route tasks to existing documentation or v2 knowledge.

Prefer this content:

- project purpose;
- essential commands verified from manifests, CI, scripts, or actual execution;
- three to ten high-impact project rules when evidence supports them;
- a compact `Where to Look` table;
- the reality-verification and correction rule.

Do not copy Guide bodies, initialization guesses, adapter state, metrics, skill
recommendations, generic advice, or task status into AGENTS.md. Never overwrite it
blindly; preserve applicable human rules and route to their existing source.

### Guides

Require `kind`, `status`, nonempty `scope`, and nonempty `use_when` frontmatter.
Allow optional `review_when` and structured `sources`. Use:

- `guide` for understanding or modifying an area;
- `runbook` for executing a project-specific operation;
- `map` for stable navigation with little interpretation;
- `policy` only for rules the project has explicitly adopted.

Use only the body sections the subject needs. Never fill empty template sections
with placeholders, boilerplate, generic best practices, or manufactured questions.

### Decisions

Require a unique `id`, `kind: decision`, `status`, `date`, nonempty `scope`, and a
`supersedes` field. Use `proposed`, `accepted`, `superseded`, or `rejected` status.
Record why the choice was made, alternatives, consequences, evidence, and when to
reconsider it. A Decision's authority comes from explicit adoption, not a
confidence label.

When replacing a Decision, set the old record to `superseded`, link the replacement
prominently in its body, and set the new record's `supersedes` to the old ID. Do not
rewrite history to make the new choice appear original.

### Observations

Use a monthly Markdown file such as
`.agents/knowledge/observations/2026-07.md`. Each entry must state:

- what was learned;
- how it can change a future action;
- the evidence;
- the likely destination, or why no destination is known.

Observations do not enter `index.yaml`. Integrate, correct, archive, or delete them
when they no longer justify maintenance.

### Evidence Boundary

Never use file-level confidence labels. Match evidence strength to the cost of an
incorrect claim.

For high-impact claims, record the precise claim, scope, basis, checked commit or
digest when practical, and known limitations or unverified boundaries.

Use frontmatter `sources` for deterministic source-change signals:

```yaml
sources:
  - path: "src/payments/**"
    checked_at: "git:abc1234"
```

For a non-Git single file, `checked_at` may be `sha256:<digest>`. Put runtime
observations, test names, symbols, external documentation, and nuanced limitations
in the body. Do not expose secrets, credentials, private personal data, or
unnecessary internal infrastructure details.

## Operation: Onboard

Onboard replaces v1 Initialize and Deep Brownfield modes. Its goal is a minimum
useful route into the project, not a generated encyclopedia.

### 1. Discover Existing Knowledge

Inspect before creating anything:

- root and nested `AGENTS.md`, `CLAUDE.md`, and tool rule files;
- README, docs, ADRs, runbooks, contribution and operations documents;
- manifests, CI, build/test scripts, configuration examples, and key entry points;
- an existing `.agents/` tree and any v1 self-evolution artifacts.

Reuse good existing documentation. Route to it rather than copying it. Treat docs
as candidate knowledge and compare high-impact claims with code, tests, config, or
runtime behavior.

If v1 artifacts are detected, stop normal initialization. Do not mix v1 and v2 or
silently copy data. Follow `references/migration.md` and use `kb migrate prepare`.

### 2. Find High-Value Gaps

Identify only gaps that can materially affect future work:

- an area a new agent is likely to misunderstand;
- an operation where a mistake is expensive or hard to recover from;
- a constraint that is not discoverable from nearby code or file names;
- a command, environment boundary, or ownership rule that is easy to misuse;
- a conflict between existing documentation and current reality;
- useful documentation that lacks a retrieval route.

Do not use fixed quotas. Existing documentation may make zero new Guides correct.

### 3. Create the Minimum System

Run the resolved CLI:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" init \
  --project-root "<absolute-project-root>" --format text
```

`kb init` must be idempotent, must not overwrite AGENTS.md, must not install an
adapter, and must not fabricate project knowledge. Create or augment routing only
after inspecting current content. Add zero to five high-value Guides when justified
and route important existing Decisions.

### 4. Verify the Result

- commands came from real project sources or direct verification;
- every routed path exists;
- every Guide has a clear future consumer and actionable `scope`/`use_when`;
- material claims have proportionate evidence and uncertainties are explicit;
- inferred facts were not presented as policy;
- removing each new Guide would create observable rediscovery cost or risk;
- no optional adapter or generated rule appeared without opt-in.

Then rebuild and check:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" index \
  --project-root "<absolute-project-root>" --format text
node "<absolute-skill-dir>/references/bin/kb.mjs" check \
  --project-root "<absolute-project-root>" --format text
```

## Operation: Capture or Correct

Apply this operation at a natural task boundary when work produced a durable
understanding. Prefer correction over accumulation.

### Future-Action Value Test

Persist knowledge only when every answer is yes:

1. Will a plausible future task need this again?
2. Is rediscovery materially more expensive than saving and maintaining it?
3. Is code, a test, a type, CI, configuration, or existing documentation an
   insufficient or inappropriate home?
4. Will the knowledge change a future decision, implementation, verification, or
   risk judgment?
5. Can its scope be stated clearly?
6. Is there traceable evidence?

If any answer is no, do not capture it. Do not save routine implementation details,
temporary debugging logs, one-off command output, facts obvious from adjacent code,
session summaries, or information without a future action.

### Choose the Destination

1. Correct an existing Guide or Decision when the destination is clear.
2. Create a Decision directly for a newly adopted consequential choice.
3. Create or update a Guide directly for durable scoped knowledge or a runbook.
4. Write an Observation only when the finding is valuable but its destination is
   genuinely unclear or current task scope does not permit responsible integration.
5. Encode enforceable truths in code, tests, types, CI, or config instead of
   documentation when those are better controls; route to that source if useful.

When reality contradicts knowledge, verify the disagreement, correct the knowledge
in the same task when safe, and preserve meaningful decision history. Do not append
a second contradictory claim and defer an obvious repair.

After edits, run `kb index` and `kb check`. Report `Capture: none`, `Capture:
corrected <path>`, `Capture: decision <path>`, `Capture: guide <path>`, or `Capture:
observation <path>` only after the corresponding action is complete.

## Operation: Maintain

Maintain is impact-driven repair, not a requirement to process every Observation or refresh metrics.

1. Run `kb check`, inspect current evidence, and rank issues by likely harm and
   maintenance return.
2. Address the smallest number of highest-impact items:
   - known incorrect or conflicting claims;
   - material Guides whose declared sources changed;
   - retrieval gaps blocking current work;
   - Observations with an obvious valuable destination;
   - duplicated knowledge or documents with no plausible consumer;
   - superseded Decisions, Guides, or Runbooks still presented as current;
   - broken routes, links, scope, schema, or adapter state.
3. Verify reality before changing semantic content.
4. Prefer one authoritative location and links over copied summaries.
5. Archive only when historical lookup is valuable; otherwise remove low-value
   content through the project's normal reviewed workflow.
6. Rebuild the index and rerun checks.

Do not process every Observation by default. Do not create categories, recurrence
counts, application counts, refinement counts, confidence transitions, or health
scores. Repetition may signal a code defect rather than a documentation need.

## Operation: Audit

Audit reports evidence-backed risks, never a 0-100 score. Read
`references/audit.md` before a broad or formal audit.

Run `kb check` for deterministic signals, then evaluate six categories:

1. correctness: conflicts, source changes, invalid claims, broken evidence;
2. retrieval: missing routes, ambiguous scope, duplicate routing, excessive loading;
3. authority: hypotheses presented as facts, rejected or superseded choices treated
   as current, policy without adoption evidence;
4. maintenance: duplication, dead fields, unused or bloated documents;
5. security/publication: secrets, sensitive operations, private infrastructure, or
   content unsafe for the repository's audience;
6. value gaps: costly mistakes or repeated investigations lacking useful guidance.

Order findings by Critical, High, Medium, then Low. Each finding must contain the
specific file or claim, supporting evidence, risk, recommended action, expected
benefit, and priority rationale. If no findings exist, state that and name residual
testing or sampling limits.

Do not infer semantic correctness from schema validity. Do not call every changed
source stale; `SOURCE_CHANGED` is a request for model review, not a verdict.

## Deterministic CLI Boundary

The CLI may:

- initialize the minimum scaffold;
- parse and validate frontmatter, YAML, JSON, JSONC, paths, globs, and local links;
- rebuild a deterministic path-sorted index;
- detect duplicate IDs and exact duplicate routes;
- compare declared Git or SHA-256 source baselines;
- generate optional scope rules when enabled;
- install, inspect, and remove explicitly selected adapters;
- prepare, apply, and roll back a journaled v1 migration;
- use atomic writes and reject unsafe paths or concurrent input changes.

The CLI must not:

- decide whether knowledge is correct, valuable, complete, stale, or necessary;
- create project-specific Guides or Decisions from guesses;
- score health or coverage;
- classify content by confidence;
- promote knowledge or turn repeated work into a Skill;
- resolve semantic conflicts;
- use counts or age thresholds as semantic decisions.

Interpret source signals precisely:

- `SOURCE_CHANGED`: declared material changed since its recorded baseline;
- `SOURCE_MISSING`: declared source no longer resolves;
- `SOURCE_BASELINE_UNAVAILABLE`: the baseline cannot be evaluated locally.

The model decides the consequence after inspecting reality.

CLI exit codes are: `0` success, `1` check found project issues, `2` invalid command
or unparseable input, and `3` unsafe write or concurrent-state conflict.

## Optional Adapters and Scope Rules

Core onboarding installs none. Supported tool values are `claude-code`, `cursor`,
`opencode`, and `augment-code`. On explicit request, use `kb adapter install <tool>
[--features context-recovery,post-task-reminder]`, `kb adapter status [tool]`, or
`kb adapter remove <tool>`. Optional v2 features are:

- context recovery: after compaction, remind the agent to reread AGENTS.md and the
  relevant Guide;
- post-task reminder: ask the three Capture questions without writing knowledge.

Adapters must remain non-blocking, project-scoped, and free of semantic decisions.
They must not write Observations, inspect a health score, or trigger maintenance.
Configuration lives in `.agents/settings.yaml`; generated integration files live
under `.agents/generated/adapters/` or the tool's documented project config.

Generate scope rules only when `routing.generate_scope_rules` is explicitly enabled.
Rules route to the source Guide and must not copy the Guide's substantive content.

## Migration Boundary

Read `references/migration.md` before any v1 migration. Keep its mechanical and
semantic phases separate.

1. `kb migrate prepare` reads v1 without changing the active system. It creates a
   run directory with input hashes, candidate v2 files, a plan, traceability report,
   and semantic review checklist.
2. The model reviews every candidate for merge, deletion, split, uncertainty,
   authority, future value, and supersession. The CLI must not make these judgments.
3. The user approves the proposed AGENTS.md and all adapter conversions or disables.
4. `kb migrate apply <run-id>` refuses changed inputs or unresolved semantic items,
   backs up every affected file, switches using the journal, rebuilds the index, and
   checks the result.
5. On failure, restore automatically. `kb migrate rollback <run-id>` must restore backed-up
   bytes exactly, but must refuse to overwrite controlled paths that changed after apply.

Do not dual-write, retrieve from v1 and v2 simultaneously, edit the active v1 tree
during prepare, or automatically preserve empty templates, duplicated knowledge,
health state, skill queues, confidence metadata, counters, or session markers.

## Reality and Authority Rules

- Read a source before citing or summarizing it.
- Scope claims narrowly; do not generalize from one file to the whole project.
- Separate observed behavior, adopted policy, accepted decision, external contract,
  and hypothesis; each has a different authority source.
- Treat code as evidence of implementation, not necessarily product intent or safe
  operational policy.
- Prefer tests and runtime evidence for behavior, adopted project documents for
  governance, Decisions for rationale, and current official docs plus actual calls
  for external systems.
- Surface unresolved contradictions. Never silently choose the more convenient
  source.
- Preserve rollback data and unrelated project or tool configuration.
- Never put credentials, tokens, private keys, or personal data in knowledge files.

## Completion Contract

Before reporting any operation complete:

1. Confirm only intended project files changed.
2. Confirm no placeholders or generic filler were introduced.
3. Verify every new route and local link exists.
4. Run `kb index` after semantic knowledge changes.
5. Run `kb check` and distinguish deterministic issues from semantic judgments.
6. For migration, verify traceability, backups, hashes, and rollback readiness.
7. State optional adapter and generated-rule status accurately; absence is the
   default, not an incomplete installation.
8. Summarize what future task behavior now improves, not how many artifacts exist.

## References

- Read `references/data-model.md` for complete fields, examples, and source rules.
- Read `references/audit.md` for the formal risk-audit method and report shape.
- Read `references/migration.md` for v1 mapping, semantic review, and safety gates.
- Use `references/templates/` for minimal project artifacts.
- Use `references/schemas/` for deterministic validation contracts.
- Use the resolved `references/bin/kb.mjs` for all CLI operations.
