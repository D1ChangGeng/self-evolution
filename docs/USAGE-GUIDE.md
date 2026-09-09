# Usage Guide

Use Self-Evolution from the project root. The skill combines model judgment
with a bundled deterministic CLI invoked from its installation directory.

## Onboard

Ask:

```text
Onboard this project with self-evolution.
```

Onboarding first reads existing project documentation, configuration, tool rules,
operational material, and key entry points. It builds the initial routing system
from that evidence and adds knowledge only for gaps with a credible future cost.

A normal result is:

- a short `AGENTS.md` router;
- `.agents/settings.yaml` and generated `index.yaml`;
- zero to five high-value Guides for an existing project;
- routes to important existing Decisions or documentation;
- adapters remain disabled until explicitly requested.

An empty project receives the minimal router and settings/index files.

Before completion, verify that commands come from actual manifests, CI, or
scripts; routed paths exist; material claims have evidence; and every new Guide
has a clear future task and action.

If v1 artifacts are detected, onboarding routes to the Migration Guide and keeps
v1 active until the reviewed migration is applied.

## Retrieve During Work

Retrieve is part of every engineering task:

1. Understand the requested scope and risk.
2. Read `AGENTS.md` for candidate routes.
3. Select the smallest set whose `scope` or `use_when` matches.
4. Inspect declared sources, review conditions, and limitations.
5. Re-check material claims when the source changed, the action is high-risk,
   or runtime/configuration may differ from repository code.
6. Use current evidence to perform and verify the task.

Load the smallest relevant knowledge set, then validate material claims against
current code, tests, deployed configuration, runtime behavior, logs, official
documentation, or an explicit human decision.

When routing misses, use repository search. Create a Guide when the completed
investigation establishes durable future-action value.

For a multi-stage task, keep the objective, constraints, verified state,
important decisions, open risks, and next verification in the host harness's
normal task state. After compaction, delegation, or a long pause, reread that
state and the relevant Guide before continuing. Do not use the project wiki as
a progress log or retry queue.

## Capture or Correct

At a meaningful task boundary, ask:

```text
Will this understanding change a future agent's design, implementation,
verification, operation, or risk decision?
```

### Correct Directly

Update the existing authoritative Guide or Decision when its destination is
clear. Typical cases are a wrong constraint, a missing runbook step, a changed
reconsideration condition, or a Decision that has been superseded.

Keep one active authoritative claim. Retain correction history when the prior
mistake has future diagnostic or audit value.

### Write an Observation

Use a monthly Observation when the finding is valuable and its final home is
unclear or the current task scope calls for a temporary holding place. Include:

```markdown
## 2026-07-31 - Refund retry behavior

- Learned: failed gateway refunds remain retryable for 24 hours.
- Future impact: retry tooling must preserve the original idempotency key.
- Evidence: `src/refunds/retry.ts`, test `refund_retry_window`.
- Likely destination: `guides/payments.md`.
```

### Keep the Source of Truth

Capture records knowledge with a concrete future consumer and action. Keep
routine implementation details, temporary debugging output, one-time command
results, and facts already clear in nearby code in their existing source of
truth.

Optional post-task reminders ask the same decision questions and leave all
knowledge writes to the model's explicit action.

## Maintain

Ask:

```text
Maintain the highest-impact project knowledge issue revealed by this task.
```

Prioritize in this order:

1. known wrong or conflicting guidance;
2. a changed source behind a high-impact Guide;
3. a retrieval failure affecting current work;
4. an Observation with a clear integration destination;
5. duplicate or unconsumed documentation;
6. a superseded Guide, Decision, or Runbook still routed as current.

Maintain performs the smallest semantic repair for the highest-impact issue,
then rebuilds the index and reruns deterministic checks.

## Audit

Ask:

```text
Audit this project's knowledge system and prioritize actionable risks.
```

List findings first, ordered by Critical, High, Medium, and Low. Every finding
includes the file or claim, evidence, required action, and why the priority is
warranted. Cover correctness, retrieval, authority, maintenance, security or
publication risk, and missing high-value knowledge.

Audit reports evidence-backed findings and actions by severity. Counts and
source-change signals may support each finding.

## Guides and Decisions

Use a Guide when future work needs interpretation, constraints, navigation, a
project-specific procedure, or an adopted policy. Required metadata includes
its kind, status, non-empty scope, and non-empty use conditions. Add structured
source baselines only when change detection is useful.

Use a Decision for an important adopted choice whose rationale, alternatives,
consequences, or reconsideration conditions matter. Retain decision history
and route adopted, current Decisions as authority.

## CLI Workflows

The skill invokes the CLI bundle relative to its own installation. Conceptual
commands are:

```text
kb init
kb index
kb check
kb migrate prepare|apply|rollback
kb adapter install <tool> [--features context-recovery,post-task-reminder]
kb adapter status [tool]
kb adapter remove <tool>
```

Supported tool values are `claude-code`, `cursor`, `opencode`, and `augment-code`.

Use `init` for minimal deterministic scaffold creation, `index` after knowledge
metadata changes, and `check` before claiming the system is consistent. A
source-change result prompts impact inspection and semantic review before any
prose change.

Commands support selecting a project root and machine-readable output. Treat
non-success results as actionable and include every check finding in the
onboarding or migration report.

## Migrate v1

Start with:

```text
Prepare a self-evolution v1 to v2 migration for review.
```

For a v1 migration, follow the complete [Migration Guide](MIGRATION.md) through
preparation, semantic review, apply, verification, and rollback.

## Enable an Adapter

Ask explicitly for the tool and feature, for example:

```text
Install the context-recovery adapter for this project's OpenCode setup.
```

Inspect status after installation and confirm that unrelated configuration
remains. Both adapter features are optional, and the post-task reminder is
non-writing. See [Optional Adapters](OPTIONAL-ADAPTERS.md).

## Practical Decision Tests

Before writing durable knowledge, be able to answer:

- Who will use this?
- What task or scope will retrieve it?
- What action will it change?
- What evidence supports it?
- What would cause it to be reviewed or retired?

When those answers are open, keep the finding in its current source of truth or
use a temporary Observation while its future destination is established.

## Release and evaluation

Use the change class that matches the actual impact: `docs`, `routing`,
`core`, or `migration`. The standard release profile combines deterministic
safety checks, the public benchmark policy, and a changed-path engineering
sample. The strict historical v1/v2 campaign remains available as the
`private` enhancement profile. Run `maintainer/evals/run.mjs --release` with
`--profile` and `--change-class` as described in the maintainer evaluation
guide. Missing benchmark data, dependencies, credentials, or a host capability
are `blocked`/`not-measured`; they are never converted to a passing result.
