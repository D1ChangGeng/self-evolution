# Self-Evolution v2

Self-Evolution is a lightweight project context skill for coding agents. It
keeps the small amount of repository-local knowledge that will change a future
engineering action, routes agents to it at the right time, and requires
material claims to be checked against current reality.

Its scope is durable repository-local knowledge that changes future engineering
decisions and actions.

## Why Use It

Project documentation often fails in three different ways:

- the useful fact was never preserved;
- the fact exists but the next agent cannot find it;
- the fact is found and trusted after the code, configuration, or runtime has
  changed.

v2 addresses all three with lightweight knowledge maintenance. It preserves
high-value Guides and Decisions, uses a thin `AGENTS.md` router, and treats every
document as guidance that may need present-day verification.

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

| Artifact                | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `AGENTS.md`             | Project purpose, essential commands, critical rules, and routing       |
| Guides                  | Knowledge that changes how a future task is understood or performed    |
| Decisions               | Adopted choices, rationale, consequences, and reconsideration triggers |
| Observations            | Temporary high-value findings whose final destination is unclear       |
| Archive                 | Superseded material retained for real historical value                 |
| `index.yaml`            | Deterministic retrieval index generated from Guides and Decisions      |
| `.agents/settings.yaml` | Explicit user choices for optional routing and adapters                |

Guides use `kind: guide | runbook | map | policy`. This classifies their use,
not a maturity level.

## Core Behavior

Self-Evolution has four explicit operations:

- **Onboard** reuses existing documentation, finds high-cost understanding
  gaps, and creates the smallest useful routing system.
- **Capture or Correct** updates the known authoritative document, records a
  valuable Observation when placement is unclear, or leaves the source of truth
  unchanged when no durable knowledge was produced.
- **Maintain** fixes the highest-impact correctness, source-change, retrieval,
  duplication, or supersession problem.
- **Audit** reports prioritized, evidence-backed risks and actions.

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

### Migrating from v1

Use the [Migration Guide](docs/MIGRATION.md) whenever v1 artifacts are detected
or a v1-to-v2 migration is requested. It defines the reviewable prepare,
semantic review, apply, verification, and rollback stages and their safety gates.
Onboarding keeps the active v1 system unchanged until the reviewed migration is
applied.

Start a migration with:

```text
Prepare a self-evolution v1 to v2 migration for review.
```

v1 migration remains supported throughout the complete `2.x` release line.

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

The CLI handles deterministic structure, index generation, path and link checks,
source-change signals, adapter configuration, and migration mechanics. Human or
model review judges whether knowledge is correct, valuable, complete, and worth
retaining, routing, or retiring.

Normal skill use resolves the executable from the installed skill directory.

## Optional Adapters

Onboarding leaves adapters disabled. Explicit adapter commands can enable context
recovery after compaction and a non-writing post-task Capture reminder. Adapter
integrations preserve unrelated tool configuration and keep project knowledge
read-only. See [Optional Adapters](docs/OPTIONAL-ADAPTERS.md).

## v2 Knowledge Model

v2 stores durable project context in Guides, Decisions, Observations, and
Archive, with routing in `AGENTS.md` and deterministic metadata in `index.yaml`.
Optional adapters are explicitly enabled and isolated under
`.agents/generated/adapters/`. The final v1 distribution remains under
`legacy/v1/` as migration evidence.

## Documentation

| Document                                       | Purpose                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)           | Runtime layers, data ownership, and boundaries                      |
| [Usage Guide](docs/USAGE-GUIDE.md)             | Onboard, Retrieve, Capture or Correct, Maintain, Audit, and CLI use |
| [Migration Guide](docs/MIGRATION.md)           | Reviewable v1 to v2 prepare/apply/rollback workflow                 |
| [Optional Adapters](docs/OPTIONAL-ADAPTERS.md) | Opt-in tool integration and safety contract                         |
| [Maintainer Design](maintainer/DESIGN.md)      | Accepted v2 product contract                                        |
| [Evaluation Spec](maintainer/evals/SPEC.md)    | Outcome-based release gates                                         |

## Design Principles

1. Save knowledge only when a future consumer and action are clear.
2. Route to the smallest relevant context.
3. Keep each correction in its authoritative document as the single source of
   truth.
4. Match evidence strength to the cost of being wrong.
5. Let programs verify deterministic facts and models interpret their meaning.
6. Keep optional tool integration explicit, isolated, reversible, and off by
   default.
7. Use observed failures and evaluations to guide skill improvements.

## License

[Business Source License 1.1](LICENSE) - free for personal use, open-source,
education, and small teams with fewer than 10 employees. Commercial use by
larger organizations requires a commercial license. The project converts to
Apache 2.0 on 2030-04-27.
