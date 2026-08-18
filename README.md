# Self-Evolution v2

Self-Evolution is a lightweight project context skill for coding agents. It
keeps the small amount of repository-local knowledge that will change a future
engineering action, routes agents to it at the right time, and requires
material claims to be checked against current reality.

It is not a session log, project encyclopedia, health dashboard, task manager,
or self-modifying skill system.

## Why Use It

Project documentation often fails in three different ways:

- the useful fact was never preserved;
- the fact exists but the next agent cannot find it;
- the fact is found and trusted after the code, configuration, or runtime has
  changed.

v2 addresses all three without making knowledge maintenance a second project.
It preserves high-value Guides and Decisions, uses a thin `AGENTS.md` router,
and treats every document as guidance that may need present-day verification.

## Project Layout

```text
your-project/
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

Only the minimal files are created during onboarding. Knowledge directories
and generated integration files appear when needed; adapters are off by
default.

| Artifact | Purpose |
|---|---|
| `AGENTS.md` | Project purpose, essential commands, critical rules, and routing |
| Guides | Knowledge that changes how a future task is understood or performed |
| Decisions | Adopted choices, rationale, consequences, and reconsideration triggers |
| Observations | Temporary high-value findings whose final destination is unclear |
| Archive | Superseded material retained for real historical value |
| `index.yaml` | Deterministic retrieval index generated from Guides and Decisions |
| `.agents/settings.yaml` | Explicit user choices for optional routing and adapters |

Guides use `kind: guide | runbook | map | policy`. This classifies their use,
not a maturity level.

## Core Behavior

Self-Evolution has four explicit operations:

- **Onboard** reuses existing documentation, finds high-cost understanding
  gaps, and creates the smallest useful routing system.
- **Capture or Correct** updates the known authoritative document, records a
  valuable Observation when placement is unclear, or intentionally saves
  nothing.
- **Maintain** fixes the highest-impact correctness, source-change, retrieval,
  duplication, or supersession problem.
- **Audit** reports evidence-backed Critical, High, Medium, and Low risks with
  actions. It never emits a composite health score.

**Retrieve** is the standing behavior for every development task: use
`AGENTS.md`, `scope`, and `use_when` to load the smallest relevant set, then
verify material claims against code, tests, configuration, runtime evidence,
project documentation, or an explicit human decision.

## Quick Start

Install or update the skill:

```bash
npx skills add D1ChangGeng/self-evolution --skill self-evolution -g -y
```

Node.js 22 or later is required for the bundled deterministic CLI.

From a project root, ask your agent:

```text
Onboard this project with self-evolution.
```

For an existing v1 project, ask for migration rather than initialization:

```text
Prepare a self-evolution v1 to v2 migration for review.
```

Migration is staged and reversible. Preparation does not change the active
system; apply requires reviewed semantic decisions and unchanged inputs;
rollback restores the recorded backup only while controlled paths still match
the post-apply baseline, otherwise it refuses without overwriting later work. v1
migration support remains throughout the complete `2.x` release line.

## Deterministic CLI

The skill routes deterministic work through its bundled `kb.mjs` executable:

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

The CLI creates and validates structure, generates the index, checks paths and
links, reports source-change signals, edits supported adapter configuration,
and executes migration mechanics. It does not decide whether knowledge is
correct, valuable, complete, or worth retaining, routing, or retiring.

Normal skill use resolves the executable relative to the installed skill. A
global `kb` command is not assumed after `npx skills add`.

## Optional Adapters

No Hook or adapter is installed during onboarding. Explicit adapter commands
can enable context recovery after compaction and a non-writing post-task
Capture reminder for supported tools.

Adapters never write project knowledge, never compute health thresholds, and
must preserve unrelated tool configuration. See
[Optional Adapters](docs/OPTIONAL-ADAPTERS.md).

## What Changed from v1

v2 removes the confidence ladder, promotion pipeline, health score,
application/refinement counters, mandatory seven-directory scaffold, runtime
EVOLUTION-SPEC review, skill recommendation queue, project-local skill
overrides, session-end inbox writer, and mandatory Hook decision point.

The final v1 distribution is preserved under `legacy/v1/` for migration
evidence and is intentionally not discoverable as another skill.

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Runtime layers, data ownership, and boundaries |
| [Usage Guide](docs/USAGE-GUIDE.md) | Onboard, Retrieve, Capture or Correct, Maintain, Audit, and CLI use |
| [Migration Guide](docs/MIGRATION.md) | Reviewable v1 to v2 prepare/apply/rollback workflow |
| [Optional Adapters](docs/OPTIONAL-ADAPTERS.md) | Opt-in tool integration and safety contract |
| [Maintainer Design](maintainer/DESIGN.md) | Accepted v2 product contract |
| [Evaluation Spec](maintainer/evals/SPEC.md) | Outcome-based release gates |

## Design Principles

1. Save knowledge only when a future consumer and action are clear.
2. Route to the smallest relevant context.
3. Correct the authoritative document instead of copying through lifecycle
   layers.
4. Match evidence strength to the cost of being wrong.
5. Let programs verify deterministic facts and models interpret their meaning.
6. Keep optional tool integration explicit, isolated, reversible, and off by
   default.
7. Improve the skill through observed failures and evaluations, not runtime
   self-review.

## License

[Business Source License 1.1](LICENSE) - free for personal use, open-source,
education, and small teams with fewer than 10 employees. Commercial use by
larger organizations requires a commercial license. The project converts to
Apache 2.0 on 2030-04-27.
