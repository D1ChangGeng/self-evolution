# v1 to v2 Migration

## Contents

- Boundary and mechanical mapping
- Prepare and semantic review
- Adapter choice and apply
- Rollback

## Boundary

Migration has two distinct responsibilities:

- deterministic tooling inventories, hashes, copies, validates, journals, switches,
  checks, and restores files;
- the model decides value, destination, merging, deletion, scope, uncertainty,
  authority, and supersession.

Never let a mechanical mapping become an assertion that content deserves to survive.

## Mechanical Candidate Mapping

| v1 source | v2 candidate |
|---|---|
| `domains/` | `guides/`, kind `guide` |
| `reference/` | `guides/`, kind `map` or `guide`; semantic review required |
| `patterns/` | related Guide or a standalone Guide; merge review required |
| `crystallized/` | `guides/`, kind `runbook` |
| `decisions/` | `decisions/` |
| `inbox/` | Observation candidates after value review |
| `archive/` | `archive/` when historical lookup remains valuable |
| `SKILL-LOCAL.md` | project policy, scoped policy, settings, or deletion |
| manifest inventory | regenerate `index.yaml` |
| manifest hook state | explicit adapter conversion or disable choice |
| scope rules | review generated routing vs user-owned policy; archive the bytes, then regenerate only if enabled |
| Hook scripts | review generated lifecycle code vs user-owned automation; archive the bytes before disabling v1 behavior |

Do not migrate manifest health, confidence levels, counts, stale/conflict caches,
Skill queues, application/refinement counters, session markers, or generated copies.

## Prepare

Run:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" migrate prepare \
  --project-root "<absolute-project-root>" --format text
```

Prepare is read-only with respect to the active v1 system and live AGENTS.md. It
creates `.agents/.migrations/<run-id>/` containing:

- hashes of all migration inputs;
- candidate v2 knowledge;
- `plan.yaml`;
- a source-to-candidate traceability report;
- a semantic review checklist;
- `AGENTS.md.v2-proposed` when root routing must change.

Migration inputs include every file below `.agents/rules/` and
`.agents/hooks/`. These trees are removed from active v2 behavior only after
their bytes are hashed, traced, and given an explicit semantic disposition.

Running prepare again against identical inputs should safely reuse or reproduce the
same plan. If inputs differ, create a new run or explicitly invalidate the old one.

## Semantic Review

Review every candidate before apply:

1. Merge duplicated facts from AGENTS, domains, patterns, and reference files into
   one authoritative location with routes elsewhere.
2. Delete empty template sections, generic advice, unsupported guesses, facts obvious
   from adjacent code, and observations with no future consumer.
3. Split documents that combine unrelated scopes or consumers.
4. Convert speculative content to an explicit uncertainty with supporting basis, or
   remove it.
5. Select `guide`, `runbook`, `map`, or `policy` by intended use, not v1 directory.
6. Mark old Decisions and current documents as superseded where applicable.
7. Verify high-impact claims against current reality.
8. Approve the proposed AGENTS route separately from knowledge conversion.

Every surviving substantive source item must appear in the traceability report as
preserved, merged, split, archived, or intentionally dropped with a reason.

## Adapter Choice

If v1 hooks were explicitly enabled, choose for each affected tool:

- `convert`: preserve the user's opt-in but replace v1 behavior with v2 context
  recovery and/or post-task reminder that never writes knowledge;
- `disable`: remove v1 integration without installing v2 behavior.

Apply must refuse semantic review items that lack both an explicit disposition
(`preserve`, `merge`, `split`, `archive`, or `drop`) and `resolved: true`.
Apply must also refuse unresolved adapter choices. Absence of v1 integration remains
absence; do not turn migration into a new opt-in prompt.

## Apply

Run only after semantic items, AGENTS approval, and adapter choices are complete:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" migrate apply <run-id> \
  --project-root "<absolute-project-root>" --format text
```

Apply must:

1. verify input hashes have not changed;
2. back up live AGENTS, v1 knowledge, rules, hooks, and every tool config it will
   modify under `.agents/legacy/v1-<run-id>/`;
3. record a SHA-256 manifest of backups;
4. use same-volume journaled renames and atomic file writes;
5. never discard unrelated tool configuration;
6. rebuild the v2 index and run checks;
7. restore automatically if any switch or verification step fails.

Do not dual-write or make both v1 and v2 active retrieval sources.

## Rollback

Run:

```text
node "<absolute-skill-dir>/references/bin/kb.mjs" migrate rollback <run-id> \
  --project-root "<absolute-project-root>" --format text
```

Rollback must restore all backed-up bytes and adapter configuration exactly, verify
the backup hashes, and be safe to rerun. Before restoring, it compares every
controlled path with the state recorded immediately after apply. If AGENTS.md,
knowledge, settings, generated files, legacy rules or hooks, or a managed tool config
changed after migration, rollback refuses to overwrite those changes and reports the
blocking paths. If exact restoration cannot be proven, stop rather than attempting a
partial best-effort rollback.
