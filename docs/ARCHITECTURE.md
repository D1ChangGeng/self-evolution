# Architecture

## Product Boundary

Self-Evolution v2 is a project context system with three separate surfaces:

| Surface                   | Responsibility                                      |
| ------------------------- | --------------------------------------------------- |
| Project Knowledge Core    | Durable project knowledge and retrieval             |
| Optional Tool Integration | Explicit reminders and generated routing            |
| Maintainer System         | Failure cases, proposals, evaluations, and releases |

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

The arrows show evidence flow. A generated index proves that a file was parsed;
the model determines whether the document should guide a decision. Code shows
implemented behavior, while deployed state and business intent use their own
current evidence. The model selects evidence appropriate to the risk.

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

The tree describes available locations. Onboarding creates the minimal root files
and adds knowledge directories on demand. `generated/` is disposable output
derived from knowledge or settings.

### AGENTS.md

`AGENTS.md` is the highest-attention routing surface. It should remain small and
contain only:

- project purpose;
- essential commands supported by manifests, CI, or scripts;
- critical project rules;
- a Where to Look table;
- the rule to verify material knowledge against current evidence and correct it
  when reality disagrees.

Detailed Guides, adapter state, project history, and maintenance evidence remain
in their authoritative locations.

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
include `draft`, `active`, `superseded` and `retired`; only `active` is consumed.
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

Observations stay outside routine retrieval. Maintain integrates, archives, or
retires entries as their future value becomes clear.

### Archive

Archive is excluded from current retrieval. It exists for material history,
audit, and migration traceability. A status change plus archive move must not
leave current routing pointed at the old document.

Structured archived Decisions remain in the historical ID/relation set. They
cannot become current index entries. Duplicate IDs, dangling/self/cyclic
supersession and inconsistent current authority remain deterministic errors.
Historical scope or source disappearance is not a current routing violation.

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

Full-text search is the fallback when routing misses. A new Guide follows from
durable future-action value established by the completed work.

## Task continuity and change boundaries

The host harness owns task continuity. For a multi-stage task it carries only
the objective, constraints, verified state, important decisions, open risks,
and next verification; after compaction or delegation the agent rereads the
relevant routes before acting. Short tasks do not need a separate task record.
The wiki stores cross-task facts and adopted choices, while maintainer files
store changes to the distributed skill and its evaluation policy.

A portable `continuation/1` Markdown packet is optional task state, produced
only when existing host/task records cannot serve a handoff. It identifies the
repository, worktree, base and actual authorized transfer bytes, with verified
claims, uncertainty and next checks. See the distributed continuation guide.
Receivers preserve mismatched work and revalidate rather than resetting branches.

Feedback follows `orient -> plan -> execute -> verify -> adjust or roll back ->
close`. A failed check changes the task plan or local change first. It is
promoted to project knowledge only when the result has a future consumer and
claim-level evidence; a skill change additionally needs an observed failure or
measured gap, expected benefit, maintenance cost, and focused validation.

When sources disagree, separate observed behavior from adopted intent. Current
code, configuration, and runtime establish what happened; an adopted policy or
accepted Decision establishes what the project chose. Keep the conflict and its
evidence visible, condition a risky action until it is resolved, and converge
through correction, supersession, retirement, or archive.

## Write Flow

At a task boundary, the model asks whether the finding has cross-session action
value:

```text
known destination and valuable
  -> correct Guide or Decision directly

valuable but destination unclear
  -> write Observation

future action remains unestablished
  -> leave the source of truth unchanged
```

Routine implementation details, temporary logs, one-time command output, and
facts already expressed clearly in code or tests remain in their current source
of truth.

## Deterministic CLI Boundary

The bundled Node.js CLI may:

- initialize minimal files;
- parse and validate frontmatter;
- generate the retrieval index and optional rules;
- check paths, local links, scopes, IDs, and adapter state;
- compare declared local source baselines;
- perform atomic writes and staged migration.
- protect participating `write` and `index` operations with a short per-worktree
  OS lock on Windows/Linux. The expected document digest is checked inside the
  protected write section. Direct editor, migration and adapter mutations retain
  their separate ownership/Git checks. Other platforms retain ordinary index
  rebuilding and report guarded writes as unavailable.

It may report `SOURCE_CHANGED`, `SOURCE_MISSING`, or
`SOURCE_BASELINE_UNAVAILABLE`. Semantic interpretation of correctness, value,
completeness, conflict, and abstraction remains with the model and reviewer.

## Optional Adapter Boundary

Adapters are explicit and project-scoped. Context recovery reminds the agent to
reload `AGENTS.md` and relevant knowledge after compaction. The post-task
reminder asks whether a correction, Observation, or source-of-truth update is appropriate.

Both features are advisory and non-blocking. Adapter configuration is parsed,
backed up, written atomically, verified, and removed by ownership so unrelated
settings survive. Knowledge writes and health assessment remain in the core
workflow.

## Migration Architecture

Migration uses a prepare-review-apply-rollback state machine:

```text
v1 input
  -> prepare: hashes + candidate conversion + semantic checklist
  -> model/human review
  -> apply: validate inputs + backup + journaled switch + index/check
  -> rollback: compare controlled paths with the post-apply baseline, then
     restore the byte-identical backup when the recorded state matches
```

The converter performs structural mappings. A model or reviewer decides merge,
delete, split, downgrade, and supersession dispositions. After apply, v2 is the
single active retrieval and write target.

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
