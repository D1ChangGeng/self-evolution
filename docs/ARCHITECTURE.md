# Architecture

## Product Boundary

Self-Evolution v2 is a project context system with three separate surfaces:

| Surface | Owns | Does not own |
|---|---|---|
| Project Knowledge Core | Durable project knowledge and retrieval | Task state, skill discovery, global settings |
| Optional Tool Integration | Explicit reminders and generated routing | Knowledge content or semantic judgment |
| Maintainer System | Failure cases, proposals, evaluations, releases | User-project runtime behavior |

The separation prevents a project knowledge system from becoming a control
plane for the entire agent environment.

## Runtime Layers

```text
+----------------------------------------------------------+
| Model: relevance, value, applicability, conflict, action |
+----------------------------------------------------------+
                            ^
+----------------------------------------------------------+
| Reality: code, tests, config, runtime, docs, decisions   |
+----------------------------------------------------------+
                            ^
+----------------------------------------------------------+
| Knowledge: Guides, Decisions, Observations               |
+----------------------------------------------------------+
                            ^
+----------------------------------------------------------+
| Retrieval: AGENTS.md, scope, use_when, index.yaml        |
+----------------------------------------------------------+
                            ^
+----------------------------------------------------------+
| CLI: schema, paths, links, source signals, atomic writes |
+----------------------------------------------------------+
```

The arrows are evidence flow, not authority inheritance. A generated index can
prove that a file was parsed; it cannot prove the document should guide a
decision. Code can show implemented behavior; it may not prove deployed state
or business intent. The model selects evidence appropriate to the risk.

## Filesystem Contract

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

The tree describes possible locations, not mandatory empty directories.
Onboarding creates the minimal root files and adds knowledge directories on
demand. `generated/` is disposable output derived from knowledge or settings.

### AGENTS.md

`AGENTS.md` is the highest-attention routing surface. It should remain small and
contain only:

- project purpose;
- essential commands supported by manifests, CI, or scripts;
- critical project rules;
- a Where to Look table;
- the rule to verify material knowledge against current evidence and correct it
  when reality disagrees.

It does not summarize every Guide, expose adapter state, report knowledge
health, or host project history.

### Guides

Guide frontmatter exposes retrieval metadata:

```yaml
---
kind: guide
status: active
scope:
  - "src/payments/**"
use_when:
  - "modifying payment processing"
review_when:
  - "payment integration or configuration changes"
sources:
  - path: "src/payments/**"
    checked_at: "git:abc1234"
---
```

`kind` is one of `guide`, `runbook`, `map`, or `policy`. Current Guide statuses
are `draft` and `active`; non-current statuses are `superseded` and `retired`.
Scope and use conditions are required because a document without a future
consumer is maintenance cost, not project context.

Structured sources are optional. They support change detection, not automatic
staleness judgment. Git baselines may use `git:<commit>`; a non-Git single file
may use `sha256:<digest>`. Runtime results and external documents belong in the
Guide's evidence prose because the local CLI does not verify them over the
network.

### Decisions

Decision frontmatter uses `kind: decision`, a unique ID, status, date, scope,
and supersession relationship. Supported states distinguish proposed,
accepted, superseded, and rejected decisions.

A Decision remains separate from a Guide because its primary query is why a
choice was made and when it should be reconsidered. Superseding a Decision
changes its state and relationship; it does not overwrite history.

### Observations

Observations are monthly Markdown entries used only when a valuable finding has
no obvious authoritative destination. They state:

1. what was learned;
2. what future action it changes;
3. the evidence;
4. the likely destination.

They are not indexed for normal retrieval and are not append-only forever.
Maintain may integrate, archive, or delete entries that no longer have future
value.

### Archive

Archive is excluded from current retrieval. It exists for material history,
audit, and migration traceability. A status change plus archive move must not
leave current routing pointed at the old document.

### Generated Index

`index.yaml` is rebuilt from current consumable Guides and Decisions. Entries
contain only retrieval fields and use stable POSIX paths and ordering. It
excludes Observations, Archive, generated files, and non-current statuses.

The output contains no wall-clock timestamp, health statistics, confidence
distribution, backlog pressure, skill queue, or adapter note, so identical input
produces identical bytes.

### Settings

`.agents/settings.yaml` is the only project settings file. It stores user
choices that cannot be inferred:

- whether scope rules are generated;
- which tool adapters and features are enabled;
- whether a post-task reminder is enabled.

All optional behavior defaults to off. Generated rules are synchronized by
`kb index` only when the setting is enabled.

## Retrieval Flow

```text
understand task
  -> read AGENTS.md candidate routes
  -> match scope and use_when
  -> load the smallest relevant set
  -> inspect source baselines and limitations
  -> verify material or changed claims against current reality
  -> perform and verify the task
```

Full-text search is the fallback when routing misses. A missing Guide is not in
itself a reason to create one.

## Write Flow

At a task boundary, the model asks whether the finding has cross-session action
value:

```text
known destination and valuable
  -> correct Guide or Decision directly

valuable but destination unclear
  -> write Observation

no clear future action
  -> no knowledge write
```

Routine implementation details, temporary logs, one-time command output, and
facts already expressed clearly in code or tests do not enter the knowledge
base by default.

## Deterministic CLI Boundary

The bundled Node.js CLI may:

- initialize minimal files;
- parse and validate frontmatter;
- generate the retrieval index and optional rules;
- check paths, local links, scopes, IDs, and adapter state;
- compare declared local source baselines;
- perform atomic writes and staged migration.

It may report `SOURCE_CHANGED`, `SOURCE_MISSING`, or
`SOURCE_BASELINE_UNAVAILABLE`. It may not declare knowledge incorrect, valuable,
complete, conflicting in meaning, or ready for abstraction.

## Optional Adapter Boundary

Adapters are explicit and project-scoped. Context recovery reminds the agent to
reload `AGENTS.md` and relevant knowledge after compaction. The post-task
reminder asks whether a correction, Observation, or no write is appropriate.

Neither feature writes knowledge, checks health thresholds, or blocks the host
tool. Adapter configuration is parsed, backed up, written atomically, verified,
and removed by ownership so unrelated settings survive.

## Migration Architecture

Migration uses a prepare-review-apply-rollback state machine:

```text
v1 input
  -> prepare: hashes + candidate conversion + semantic checklist
  -> model/human review
  -> apply: validate inputs + backup + journaled switch + index/check
  -> rollback: byte-identical restore only if controlled paths still match the
     post-apply baseline; otherwise refuse without overwriting later work
```

The converter performs safe structural mappings but does not decide whether to
merge, delete, split, downgrade, or supersede content. It never dual-writes v1
and v2 or retrieves both by default.

## Maintainer Architecture

The distributed skill is improved outside user projects:

```text
observed failure
  -> failure case with replayable evidence
  -> proposal when the public mechanism must change
  -> deterministic and integrated evaluations
  -> maintainer decision
  -> changelog and release
```

A field or mechanism without an identified consumer, changed action,
measurement, and removal condition is rejected. See
`maintainer/DESIGN.md` and `maintainer/evals/SPEC.md`.
