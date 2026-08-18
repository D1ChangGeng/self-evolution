# Migrating from v1 to v2

v1 migration is reviewable, staged, reversible, and supported for the complete
`2.x` release line. It is not a bulk copy of every old file.

## Why Semantic Review Is Required

v1 can represent the same claim in `AGENTS.md`, domains, patterns,
crystallized workflows, rules, and inbox entries. It also contains confidence,
health, skill, Hook, and lifecycle metadata that v2 intentionally removes.

The deterministic migrator can preserve bytes, parse structures, and propose
safe mappings. A model or human must decide whether content should be merged,
deleted, split, reframed as uncertainty, or superseded.

## Structural Mapping

| v1 artifact | v2 candidate |
|---|---|
| `domains/` | Guide with `kind: guide` |
| `reference/` | Guide with `kind: map` or `guide` |
| `patterns/` | Merge into the relevant Guide or retain as a focused Guide |
| `crystallized/` | Guide with `kind: runbook` |
| `decisions/` | Decision |
| `inbox/` | Filtered Observation candidate |
| `archive/` | Archive |
| `SKILL-LOCAL.md` | Explicit policy, scoped policy, settings choice, or removal |
| manifest inventory | Rebuilt generated index |
| manifest health and counters | Not migrated |
| manifest skill queue | Not migrated into project knowledge |
| enabled Hook state | Explicit per-tool convert-or-disable review item |
| scope rules | Review generated routing vs user policy, archive original bytes, then regenerate only when enabled |
| Hook scripts | Review generated lifecycle code vs user automation and archive original bytes before disabling v1 behavior |

Mapping creates candidates, not final semantic approval.

## 1. Prepare

Ask the skill to prepare migration or invoke the conceptual command:

```text
kb migrate prepare
```

Prepare reads v1 and writes a run directory under
`.agents/.migrations/<run-id>/`. It records input hashes, candidate v2 files, a
migration plan, traceability, a semantic review checklist, adapter decisions,
and a proposed v2 `AGENTS.md`. It does not change the active v1 system.
The frozen input set includes every file under `.agents/rules/` and
`.agents/hooks/`, so changes to either tree after review invalidate apply.

Running prepare again against identical input safely reuses or reproduces the
same plan. If input changes, prepare creates or requires a refreshed review
rather than treating the old plan as current.

## 2. Review

Resolve every semantic item:

- merge duplicate claims into one authority;
- remove empty template sections, generic advice, unsupported guesses, and
  observations with no future consumer;
- split files whose scopes or consumers do not overlap;
- express hypotheses and limitations directly rather than preserving a
  confidence label;
- supersede old Decisions, Guides, and Runbooks;
- approve the proposed minimal `AGENTS.md` routing;
- choose `convert` or `disable` for each tool with explicitly enabled v1 Hooks.

Each semantic item also needs one explicit disposition: `preserve`, `merge`,
`split`, `archive`, or `drop`. `resolved: true` without a disposition is not an
approval.

Review traceability to ensure every material v1 input is accounted for even
when the disposition is removal. The migrator does not need to keep every byte
active, but it must never lose unreviewed input.

## 3. Apply

Apply only when input hashes still match, every semantic item is resolved, the
AGENTS proposal is approved, and adapter choices are complete:

```text
kb migrate apply <run-id>
```

Apply backs up the active `AGENTS.md`, v1 knowledge, rules, Hooks, and every
tool configuration it may modify under `.agents/legacy/v1-<run-id>/`. The backup
contains a SHA-256 manifest. A journaled same-volume switch installs v2, rebuilds
the index, and runs checks.

If post-switch verification fails, apply restores the backup automatically.
Repeated apply against an already completed run is a safe no-op or verified
reuse, not a second migration.

## 4. Verify

Before accepting the migration:

- inspect the Where to Look routes;
- confirm only current Guides and Decisions appear in `index.yaml`;
- run deterministic checks;
- sample material claims against current evidence;
- verify no v1 and v2 dual-write behavior remains;
- verify converted adapters are non-writing and disabled adapters are absent;
- confirm unrelated tool configuration survived;
- compare the traceability report to every v1 input category.

## 5. Roll Back

Use the recorded run:

```text
kb migrate rollback <run-id>
```

Rollback restores the original bytes and configuration from the SHA-256
manifest. Before overwriting anything, it compares all controlled paths with the
state recorded immediately after apply. If AGENTS.md, knowledge, settings,
generated files, legacy rules or Hooks, or a managed tool configuration changed
after migration, rollback refuses and reports the blocking paths. It is safe to
repeat once the controlled state still matches. After rollback, the v2 candidate
and review artifacts may remain in the migration run directory for diagnosis, but
the active project is v1 again.

## Compatibility Rules

- v2 does not dual-write v1 and v2.
- v2 does not retrieve both structures by default.
- `kb init` does not overwrite a detected v1 project.
- The repository's `legacy/v1/` archive is maintainer evidence; migration reads
  the target project's own v1 artifacts.
- Migration support remains available in `2.x`; removing it is a `3.0` change.
