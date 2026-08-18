# Usage Guide

Use Self-Evolution from the project root. The skill combines model judgment
with a bundled deterministic CLI; ordinary users do not need a globally
installed `kb` command.

## Onboard

Ask:

```text
Onboard this project with self-evolution.
```

Onboarding first reads existing `AGENTS.md`, README and docs, ADRs, build and
test configuration, tool rules, operational documentation, and key entry
points. It reuses useful documentation rather than generating an equivalent
knowledge encyclopedia.

It then identifies only gaps with a credible future cost, such as a hidden
architecture constraint, hazardous release step, misleading existing document,
or project command that is easy to misuse. A normal result is:

- a short `AGENTS.md` router;
- `.agents/settings.yaml` and generated `index.yaml`;
- zero to five high-value Guides for an existing project;
- routes to important existing Decisions or documentation;
- no adapters unless explicitly requested.

An empty project receives only the minimal router and settings/index files. It
does not receive empty knowledge templates or speculative project facts.

Before completion, verify that commands come from actual manifests, CI, or
scripts; routed paths exist; material claims have evidence; and every new Guide
has a clear future task and action.

If v1 artifacts are detected, onboarding stops and routes to migration. It does
not mix v1 and v2 structures.

## Retrieve During Work

Retrieve is part of every engineering task:

1. Understand the requested scope and risk.
2. Read `AGENTS.md` for candidate routes.
3. Select the smallest set whose `scope` or `use_when` matches.
4. Inspect declared sources, review conditions, and limitations.
5. Re-check material claims when the source changed, the action is high-risk,
   or runtime/configuration may differ from repository code.
6. Use current evidence to perform and verify the task.

Do not load the whole knowledge directory. Do not trust a statement merely
because it is in a Guide. Depending on the claim, current evidence may be code,
tests, deployed configuration, runtime behavior, logs, official documentation,
or an explicit human decision.

When routing misses, use repository search. Create a Guide only if the completed
investigation passes the future-action value test.

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

Do not preserve the old claim in multiple active layers. Keep correction
history only when the prior mistake itself has future diagnostic or audit
value.

### Write an Observation

Use a monthly Observation only when the finding is valuable but its final home
is unclear or current task scope does not justify restructuring. Include:

```markdown
## 2026-07-31 - Refund retry behavior

- Learned: failed gateway refunds remain retryable for 24 hours.
- Future impact: retry tooling must preserve the original idempotency key.
- Evidence: `src/refunds/retry.ts`, test `refund_retry_window`.
- Likely destination: `guides/payments.md`.
```

### Save Nothing

Do not persist ordinary local implementation details, temporary debugging
output, one-time command results, facts immediately visible in nearby code, or
information with no identifiable future consumer.

Optional post-task reminders ask the same decision questions but never write an
Observation automatically.

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

Maintain is a bounded repair, not a requirement to empty observations or
recalculate a dashboard. Run deterministic checks, interpret each signal, make
the smallest semantic correction, rebuild the index, and re-check.

## Audit

Ask:

```text
Audit this project's knowledge system and prioritize actionable risks.
```

List findings first, ordered by Critical, High, Medium, and Low. Every finding
includes the file or claim, evidence, required action, and why the priority is
warranted. Cover correctness, retrieval, authority, maintenance, security or
publication risk, and missing high-value knowledge.

Do not emit a numeric health score. Counts and source-change signals may support
a finding but never replace its evidence or action.

## Guides and Decisions

Use a Guide when future work needs interpretation, constraints, navigation, a
project-specific procedure, or an adopted policy. Required metadata includes
its kind, status, non-empty scope, and non-empty use conditions. Add structured
source baselines only when change detection is useful.

Use a Decision for an important adopted choice whose rationale, alternatives,
consequences, or reconsideration conditions matter. Supersede rather than
rewriting history. Proposed or rejected Decisions are not routed as current
authority.

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
source-change result is a prompt to inspect impact, not permission for automatic
prose rewriting.

Commands support selecting a project root and machine-readable output. Treat
non-success results as actionable; do not hide check findings in a successful
onboarding or migration report.

## Migrate v1

Start with:

```text
Prepare a self-evolution v1 to v2 migration for review.
```

Preparation is read-only with respect to the active system. Review candidate
Guide/Decision/Observation mappings, duplicate or empty content, uncertainties,
the proposed `AGENTS.md`, and each previously enabled Hook decision.

Apply only after inputs remain unchanged and every semantic review item is
resolved. Verify the generated index and checks. Use rollback when verification
fails or the result is rejected, but expect it to refuse if any controlled path
changed after apply; it never force-overwrites later work. See
[Migration](MIGRATION.md).

## Enable an Adapter

Ask explicitly for the tool and feature, for example:

```text
Install the context-recovery adapter for this project's OpenCode setup.
```

Inspect status after installation and confirm unrelated configuration remains.
The optional post-task reminder is non-writing; neither feature blocks the tool
or turns adapters into a prerequisite for onboarding. See
[Optional Adapters](OPTIONAL-ADAPTERS.md).

## Practical Decision Tests

Before writing durable knowledge, be able to answer:

- Who will use this?
- What task or scope will retrieve it?
- What action will it change?
- What evidence supports it?
- What would cause it to be reviewed or retired?

If those answers are unclear, save nothing or use a temporary Observation only
when the future value is still concrete.
