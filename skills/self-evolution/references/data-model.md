# v2 Data Model

## Contents

- AGENTS.md and filesystem
- Guide contract
- Decision contract
- Observation contract
- Generated index
- Settings
- Evidence and status rules

## AGENTS.md and Filesystem

The root `AGENTS.md` is a high-priority router, not a project encyclopedia. Keep
project purpose, verified essential commands, a few adopted critical rules, a
`Where to Look` table, and the reality-verification rule. Link existing README,
docs, ADRs, or v2 knowledge instead of copying their content.

The project data layout is:

```text
.agents/
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

Create knowledge directories only when needed. `index.yaml` is generated from
current Guides and Decisions. `settings.yaml` stores user choices only.

## Guide Contract

A Guide is a Markdown file under `.agents/knowledge/guides/`.

```yaml
---
kind: guide
status: active
scope:
  - "src/payments/**"
use_when:
  - "modifying payment processing"
  - "investigating refund failures"
review_when:
  - "payment configuration changes"
sources:
  - path: "src/payments/**"
    checked_at: "git:abc1234"
---
```

Required fields:

- `kind`: `guide`, `runbook`, `map`, or `policy`;
- `status`: `draft`, `active`, `superseded`, or `retired`;
- `scope`: a nonempty list of project-relative POSIX paths or globs;
- `use_when`: a nonempty list of concrete task conditions.

Optional fields:

- `review_when`: material conditions that should trigger review;
- `sources`: path and baseline pairs used for deterministic change signals.

Use `guide` for non-obvious understanding, `runbook` for a project operation, `map`
for stable navigation, and `policy` only for explicitly adopted governance. Only
`active` Guides enter the generated index. `draft` content may remain in place while
being reviewed; superseded or retired content should link to its replacement or move
to archive when historical lookup is the only remaining use.

Guide bodies are free form. Common sections include Purpose, Important Constraints,
How This Area Works, Known Failure Modes, Verification, Sources, and Uncertainties.
Use only sections with substantive project-specific content.

## Decision Contract

A Decision is a Markdown file under `.agents/knowledge/decisions/`.

```yaml
---
kind: decision
id: adr-014-valkey
status: accepted
date: 2026-07-30
scope:
  - "src/session/**"
supersedes: null
sources:
  - path: "src/session/config.ts"
    checked_at: "git:abc1234"
---
```

Required fields:

- `kind`: exactly `decision`;
- `id`: a repository-unique stable identifier;
- `status`: `proposed`, `accepted`, `superseded`, or `rejected`;
- `date`: an ISO `YYYY-MM-DD` date;
- `scope`: a nonempty list of project-relative POSIX paths or globs;
- `supersedes`: `null`, one Decision ID, or a list of Decision IDs.

`sources` is optional and uses the same path/baseline shape as Guides. Only accepted
Decisions enter the generated index. A superseded Decision remains immutable except
for status and a prominent body link to its replacement needed to make current
authority unambiguous. The replacing Decision records the old ID in `supersedes`.

Recommended body sections are Context, Decision, Alternatives Considered,
Consequences, Evidence, and Reconsider When.

## Observation Contract

Use one Markdown file per month under `.agents/knowledge/observations/`, named
`YYYY-MM.md`. Observations have no required frontmatter and never enter the index.

Each entry must include:

1. what was learned;
2. the future action it can change;
3. traceable evidence;
4. its likely destination or why no destination is known.

Do not write session-end markers, ordinary work summaries, temporary logs, or facts
already expressed adequately by code, tests, types, configuration, or existing docs.

## Generated Index

`index.yaml` is rebuildable output, not an authority source. It has no timestamp so
identical inputs produce byte-identical output.

```yaml
schema_version: "2.0"
documents:
  - path: "guides/payments.md"
    kind: guide
    status: active
    scope:
      - "src/payments/**"
    use_when:
      - "modifying payment processing"
  - path: "decisions/adr-014-valkey.md"
    kind: decision
    id: adr-014-valkey
    status: accepted
    date: 2026-07-30
    scope:
      - "src/session/**"
```

Paths are relative to `.agents/knowledge/`, normalized to POSIX separators, and
sorted lexically. Index only active Guides and accepted Decisions. Exclude
Observations, archive, generated content, drafts, retired Guides, rejected Decisions,
and superseded content.

## Settings

`.agents/settings.yaml` starts as:

```yaml
schema_version: "2.0"
routing:
  generate_scope_rules: false
adapters:
  active: {}
```

`routing.generate_scope_rules` is the user's explicit opt-in to generated rules.
`adapters.active` maps a supported tool name to booleans for `context_recovery` and
`post_task_reminder`. Consumers derive reminder state directly from these per-tool
feature choices. Defaults are disabled.

Example:

```yaml
adapters:
  active:
    opencode:
      context_recovery: true
      post_task_reminder: true
```

Do not add file counts, confidence distributions, health scores, staleness caches,
conflict caches, Skill installation state, timestamps, or derived status beyond the
installed feature booleans.

## Evidence and Status Rules

A source baseline item has exactly two fields:

```yaml
- path: "src/payments/**"
  checked_at: "git:abc1234"
```

Use `git:<commit>` for Git-tracked paths. For a non-Git single file, use
`sha256:<lowercase-hex-digest>`. Do not use SHA-256 baselines for globs. A baseline
means the declared source was reviewed at that revision; it does not prove every
claim correct.

Keep richer evidence in the body: symbols, line references, test names, runtime
observations, external contracts, approvals, limitations, and unchecked boundaries.
Material claims need stronger evidence than low-impact navigation hints.

Status answers lifecycle or authority questions, not confidence. `active` means a
Guide is currently consumable; `accepted` means a Decision was adopted. Neither
means all factual claims remain current. Verify against reality when consequences are
material.
