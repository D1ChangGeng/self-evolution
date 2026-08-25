---
name: self-evolution
description: "Initialize, retrieve, correct, maintain, or audit a lightweight project knowledge system built around AGENTS.md and .agents/knowledge. Use for onboarding, durable knowledge capture or correction, maintenance, audits, optional adapters, and explicitly requested v1-to-v2 migrations routed through the repository Migration Guide."
---

# Project Self-Evolution v2

Preserve project knowledge that a future task can retrieve, verify against current
reality, and use to improve a decision, implementation, or check. Measure success
through correct outcomes, future-task value, and low maintenance cost.

## Resolve the Bundled CLI

The deterministic helper is `references/bin/kb.mjs` relative to this installed
skill. Resolve the installed skill directory and invoke the helper through its
absolute path.

Use the resolved absolute path in every invocation:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" <command> \
  --project-root "<absolute-project-root>"
```

Require Node.js 22 or newer. Use `--format json` when consuming results
programmatically and `--format text` for user-facing diagnostics.

The CLI handles deterministic structure, indexes, paths, links, source signals,
adapter configuration, atomic writes, and migration mechanics. Human or model
review determines relevance, correctness, authority, future value, conflicts,
abstraction, and safe action.

## Standing Behavior: Retrieve

Retrieve is the standing behavior applied at every project task start.

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

Load the smallest matching set of Guides and Decisions. Treat each Guide as a
route to evidence, and create a new Guide when the completed work establishes
durable future-action value.

## Choose One Explicit Operation

| User intent                                                 | Operation          |
| ----------------------------------------------------------- | ------------------ |
| Initialize project memory, onboard, set up AGENTS.md        | Onboard            |
| Save a durable finding, update knowledge, record a decision | Capture or Correct |
| Clean up, reconcile, refresh, or repair existing knowledge  | Maintain           |
| Review knowledge quality, risk, correctness, or usefulness  | Audit              |

If a request combines operations, Retrieve first, then order them by dependency.

v1-to-v2 migration follows the repository Migration Guide. When v1 artifacts are
detected or migration is requested, route to the repository README and
`docs/MIGRATION.md` before making changes. The guide defines prepare, semantic
review, apply, verification, and rollback; the bundled CLI provides the
migration commands. If the guide cannot be located, request it before proceeding.

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

`kb init` creates the minimum scaffold. Create knowledge directories on demand.
Generated rules and adapters appear after explicit opt-in.

- `guides/`: knowledge that changes future action. A Guide may have kind `guide`,
  `runbook`, `map`, or `policy`.
- `decisions/`: important choices, rationale, alternatives, consequences, and
  reconsideration conditions.
- `observations/`: temporary monthly holding files for valuable findings whose
  authoritative destination is still being established.
- `archive/`: superseded or retired content retained for genuine historical use.
- `index.yaml`: generated retrieval metadata rebuilt from source documents.
- `settings.yaml`: explicit user choices for routing and adapters. Knowledge
  evidence and semantic judgments remain in their authoritative documents.

The v2 knowledge model uses Guides, Decisions, Observations, Archive, generated
index metadata, and explicit project settings. Reviewed migration records retain
historical v1 material when its future value is established.

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

Keep Guide bodies, adapter state, metrics, recommendations, and task status in
their authoritative locations. Preserve applicable human rules in AGENTS.md and
route detailed material to its source.

### Guides

Require `kind`, `status`, nonempty `scope`, and nonempty `use_when` frontmatter.
Allow optional `review_when` and structured `sources`. Use:

- `guide` for understanding or modifying an area;
- `runbook` for executing a project-specific operation;
- `map` for stable navigation with little interpretation;
- `policy` only for rules the project has explicitly adopted.

Use the body sections the subject needs and fill each included section with
substantive project-specific content.

### Decisions

Require a unique `id`, `kind: decision`, `status`, `date`, nonempty `scope`, and a
`supersedes` field. Use `proposed`, `accepted`, `superseded`, or `rejected` status.
Record why the choice was made, alternatives, consequences, evidence, and when to
reconsider it. A Decision's authority comes from explicit adoption.

When replacing a Decision, set the old record to `superseded`, link the replacement
prominently in its body, and set the new record's `supersedes` to the old ID. This
relationship preserves the decision history.

### Observations

Use a monthly Markdown file such as
`.agents/knowledge/observations/2026-07.md`. Each entry must state:

- what was learned;
- how it can change a future action;
- the evidence;
- the likely destination, or why no destination is known.

Observations remain outside `index.yaml`. Integrate, correct, archive, or retire
them as their authoritative destination and future value become clear.

### Evidence Boundary

Match evidence strength to the cost of an incorrect claim and record evidence at
the declaration level.

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
in the body. Keep secrets, credentials, private personal data, and unrelated
internal infrastructure details in their protected systems of record.

## Operation: Onboard

Onboard creates the minimum useful route into the project from current evidence.

### 1. Discover Existing Knowledge

Inspect before creating anything:

- root and nested `AGENTS.md`, `CLAUDE.md`, and tool rule files;
- README, docs, ADRs, runbooks, contribution and operations documents;
- manifests, CI, build/test scripts, configuration examples, and key entry points;
- an existing `.agents/` tree and any v1 self-evolution artifacts.

Reuse good existing documentation. Route to it rather than copying it. Treat docs
as candidate knowledge and compare high-impact claims with code, tests, config, or
runtime behavior.

When v1 artifacts are detected, keep the active v1 system unchanged and route the
user to the repository README's Migration Guide. Parse `docs/MIGRATION.md`,
complete the documented review, and apply the migration through that workflow.

### 2. Find High-Value Gaps

Identify only gaps that can materially affect future work:

- an area a new agent is likely to misunderstand;
- an operation where a mistake is expensive or hard to recover from;
- a constraint that is not discoverable from nearby code or file names;
- a command, environment boundary, or ownership rule that is easy to misuse;
- a conflict between existing documentation and current reality;
- useful documentation that lacks a retrieval route.

Let evidence and future-task value determine the number of new Guides; existing
documentation may already provide complete coverage.

### 3. Create the Minimum System

Run the resolved CLI:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" init \
  --project-root "<absolute-project-root>" --format text
```

`kb init` is idempotent and preserves an existing AGENTS.md. Adapter installation
remains an explicit operation, and project knowledge comes from inspected evidence.
Create or augment routing after inspecting current content. Add zero to five
high-value Guides when justified and route important existing Decisions.

### 4. Verify the Result

- commands came from real project sources or direct verification;
- every routed path exists;
- every Guide has a clear future consumer and actionable `scope`/`use_when`;
- material claims have proportionate evidence and uncertainties are explicit;
- inferred facts retain their evidentiary status;
- removing each new Guide would create observable rediscovery cost or risk;
- optional adapters and generated rules match explicit settings.

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

Persist knowledge when every answer is yes:

1. Will a plausible future task need this again?
2. Is rediscovery materially more expensive than saving and maintaining it?
3. Is code, a test, a type, CI, configuration, or existing documentation an
   insufficient or inappropriate home?
4. Will the knowledge change a future decision, implementation, verification, or
   risk judgment?
5. Can its scope be stated clearly?
6. Is there traceable evidence?

The project source of truth retains routine implementation details, temporary
debugging logs, one-off command output, adjacent-code facts, and information
without a future action.

### Choose the Destination

1. Correct an existing Guide or Decision when the destination is clear.
2. Create a Decision directly for a newly adopted consequential choice.
3. Create or update a Guide directly for durable scoped knowledge or a runbook.
4. Write an Observation when the finding is valuable and its destination is
   genuinely unclear or the current task scope calls for a temporary holding place.
5. Encode enforceable truths in code, tests, types, CI, or config when those are
   the strongest controls; route to that source when useful.

When reality contradicts knowledge, verify the disagreement, correct the knowledge
in the same task when safe, and preserve meaningful decision history. Keep one
authoritative current claim.

After edits, run `kb index` and `kb check`. Report `Capture: none`, `Capture:
corrected <path>`, `Capture: decision <path>`, `Capture: guide <path>`, or `Capture:
observation <path>` only after the corresponding action is complete.

## Operation: Maintain

Maintain is impact-driven repair focused on the highest-return knowledge work.

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
5. Archive material history and retire content whose future consumer has ended
   through the project's normal reviewed workflow.
6. Rebuild the index and rerun checks.

Process Observations by future-action value. Keep the knowledge model focused on
evidence, consumers, actions, and maintenance return.

## Operation: Audit

Audit reports evidence-backed risks by severity. Read `references/audit.md`
before a broad or formal audit.

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

Schema validity establishes structure. The model reviews semantic correctness and
interprets `SOURCE_CHANGED` against current evidence.

## Deterministic CLI Boundary

The CLI may:

- initialize the minimum scaffold;
- parse and validate frontmatter, YAML, JSON, JSONC, paths, globs, and local links;
- rebuild a deterministic path-sorted index;
- detect duplicate IDs and exact duplicate routes;
- compare declared Git or SHA-256 source baselines;
- generate optional scope rules when enabled;
- install, inspect, and remove explicitly selected adapters;
- prepare, apply, and roll back a staged v1 migration through the reviewed workflow;
- use atomic writes and reject unsafe paths or concurrent input changes.

Human or model review owns:

- knowledge correctness, value, completeness, and necessity;
- project-specific Guides and Decisions;
- semantic risk and coverage judgments;
- authority and evidence interpretation;
- abstraction and workflow crystallization;
- semantic conflict resolution;
- the action triggered by counts, source signals, or elapsed time.

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
- post-task reminder: ask the three Capture questions while leaving knowledge
  writes to the model's explicit action.

Adapters are non-blocking, project-scoped, and free of semantic decisions. They
leave Observations, health assessment, and maintenance under the core workflow's
control.
Configuration lives in `.agents/settings.yaml`; generated integration files live
under `.agents/generated/adapters/` or the tool's documented project config.

Generate scope rules when `routing.generate_scope_rules` is explicitly enabled.
Rules route to the source Guide, while substantive knowledge remains in that Guide.

## Reality and Authority Rules

- Read a source before citing or summarizing it.
- Scope claims to the evidence that supports them.
- Separate observed behavior, adopted policy, accepted decision, external contract,
  and hypothesis; each has a different authority source.
- Treat code as implementation evidence and use adopted project sources for intent
  and operational policy.
- Prefer tests and runtime evidence for behavior, adopted project documents for
  governance, Decisions for rationale, and current official docs plus actual calls
  for external systems.
- Surface unresolved contradictions with their evidence and authority sources.
- Preserve rollback data and unrelated project or tool configuration.
- Keep credentials, tokens, private keys, and personal data in their protected
  systems of record.

## Completion Contract

Before reporting any operation complete:

1. Confirm only intended project files changed.
2. Confirm every written section contains project-specific, actionable content.
3. Verify every new route and local link exists.
4. Run `kb index` after semantic knowledge changes.
5. Run `kb check` and distinguish deterministic issues from semantic judgments.
6. State optional adapter and generated-rule status accurately; the default state
   is disabled and generated output appears only after explicit enablement.
7. Summarize the future task behavior that now improves.

## References

- Read `references/data-model.md` for complete fields, examples, and source rules.
- Read `references/audit.md` for the formal risk-audit method and report shape.
- Use `references/templates/` for minimal project artifacts.
- Use `references/schemas/` for deterministic validation contracts.
- Use the resolved `references/bin/kb.mjs` for all CLI operations.
