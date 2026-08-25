# Migrating from v1 to v2

v1 migration is a reviewable, staged, reversible conversion of approved project
knowledge, supported throughout the complete `2.x` release line.

## Scope and Routing

Use this guide whenever a v1 knowledge base is detected or a v1-to-v2 migration
is requested. Onboarding routes here while v1 remains active. Parse the complete
guide before preparing a run, editing review artifacts, applying candidates, or
rolling back a completed migration. Every semantic migration decision receives
explicit review. Start with:

```text
Prepare a self-evolution v1 to v2 migration for review.
```

Invoke the bundled CLI from its absolute installed path:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" <command> \
  --project-root "<absolute-project-root>" --format text
```

## Why Semantic Review Is Required

v1 can represent the same claim in `AGENTS.md`, domains, patterns,
crystallized workflows, rules, and inbox entries. The migration record maps
those sources into the v2 knowledge model and records the treatment of metadata,
Hooks, and lifecycle information.

The deterministic migrator preserves bytes, parses structures, and proposes
structural mappings. A model or human reviewer approves each mapping and records
its disposition, authority, future value, and limitations.

## Structural Mapping

| v1 artifact                  | v2 candidate                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `domains/`                   | Guide with `kind: guide`                                                                                             |
| `reference/`                 | Guide with `kind: map` or `guide`                                                                                    |
| `patterns/`                  | Merge into the relevant Guide or retain as a focused Guide                                                           |
| `crystallized/`              | Guide with `kind: runbook`                                                                                           |
| `decisions/`                 | Decision                                                                                                             |
| `inbox/`                     | Filtered Observation candidate                                                                                       |
| `archive/`                   | Archive                                                                                                              |
| `SKILL-LOCAL.md`             | Explicit policy, scoped policy, settings choice, or removal                                                          |
| manifest inventory           | Rebuilt generated index                                                                                              |
| manifest health and counters | Migration trace and backup                                                                                           |
| manifest skill queue         | Migration trace and backup                                                                                           |
| enabled Hook state           | Explicit per-tool convert-or-disable review item                                                                     |
| scope rules                  | Review generated routing against user policy, archive source bytes, and regenerate according to the reviewed setting |
| Hook scripts                 | Review lifecycle code against user automation, archive source bytes, and record the approved integration state       |

Every structural mapping is a candidate that requires explicit semantic approval.

## 1. Prepare

Ask the skill to prepare migration or invoke the command:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" migrate prepare \
  --project-root "<absolute-project-root>" --format text
```

Prepare reads the active v1 system and writes a run directory under
`.agents/.migrations/<run-id>/`. The run contains candidate v2 files, a migration
plan, traceability records, semantic review items, adapter decisions, and a
proposed v2 `AGENTS.md`. The active v1 system remains unchanged.

The prepare run freezes and hashes every input file under `.agents/rules/` and
`.agents/hooks/`. Apply requires the prepared source set and aggregate hash to
match. Any input change creates a refreshed prepare and review requirement.

A repeated prepare against identical input verifies and reuses the same run.
Keep v1 active until semantic review is complete and the migration is approved
for apply.

## 2. Review

Resolve every semantic item:

- merge duplicate claims into one authority;
- remove empty template sections, generic advice, unsupported guesses, and
  observations with no future consumer;
- split files into distinct scopes or consumer groups;
- express hypotheses and limitations directly;
- supersede old Decisions, Guides, and Runbooks;
- approve the proposed minimal `AGENTS.md` routing;
- approve each affected tool's `convert` or `disable` adapter choice.

Approval requires both `resolved: true` and one explicit disposition: `preserve`,
`merge`, `split`, `archive`, or `drop`.

Traceability accounts for every material v1 input and records its approved
disposition before apply. The disposition determines whether material remains
active, is merged or split, moves to archive, or is dropped.

## Adapter Choice

If v1 Hooks were explicitly enabled, choose for each affected tool:

- `convert`: preserve the explicit opt-in and connect it to the selected
  non-writing v2 context-recovery or post-task reminder features;
- `disable`: record the reviewed decision to retire the owned v1 registration.

Complete an explicit adapter choice for every affected tool before apply. Apply
preserves each tool's configured or unconfigured integration state.

## 3. Apply

Apply proceeds when the prepared input set and hash still match, every semantic
item has an explicit disposition and `resolved: true`, the AGENTS proposal is
approved, and adapter choices are complete:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" migrate apply <run-id> \
  --project-root "<absolute-project-root>" --format text
```

Apply backs up the active `AGENTS.md`, v1 knowledge, rules, Hooks, and every
managed tool configuration under `.agents/legacy/v1-<run-id>/`. The backup
contains a SHA-256 manifest. A journaled same-volume switch installs v2, rebuilds
the index, and runs checks.

Apply preserves each tool's existing integration state and all unrelated
configuration.

Apply must:

1. verify input hashes match;
2. create backups of live AGENTS, v1 knowledge, rules, Hooks, and every managed
   tool configuration it may modify;
3. record a SHA-256 manifest of backups;
4. use same-volume journaled renames and atomic writes;
5. rebuild the v2 index and run checks;
6. restore automatically if a switch or verification step fails;
7. preserve all unrelated tool configuration.

After a successful apply, v2 becomes the single active retrieval and write
target.

If post-switch verification reports a failure, apply restores the backup automatically.
A repeated apply verifies and reuses the already completed run.

## 4. Verify

Before accepting the migration:

- inspect the Where to Look routes;
- confirm only current Guides and Decisions appear in `index.yaml`;
- run deterministic checks;
- sample material claims against current evidence;
- verify that v2 is the single active retrieval and write target;
- verify converted adapters are non-writing and each adapter retains its reviewed
  state;
- confirm unrelated tool configuration survived;
- compare the traceability report to every v1 input category.

## 5. Roll Back

Use the recorded run:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" migrate rollback <run-id> \
  --project-root "<absolute-project-root>" --format text
```

Rollback restores the original bytes and configuration from the SHA-256 manifest
after confirming that every controlled path still matches the post-apply state.
When a controlled path has changed, rollback reports the path and leaves it
untouched. The operation is repeatable while the controlled state matches. After
rollback, the active project is v1 again.

## Compatibility Rules

- One knowledge system is active at a time: v1 before apply, v2 after apply,
  and v1 after rollback.
- `kb init` leaves a detected v1 project unchanged and routes it to migration.
- The repository's `legacy/v1/` archive is maintainer evidence; migration reads
  the target project's own v1 artifacts.
- Migration support remains available in `2.x`; removing it is a `3.0` change.
