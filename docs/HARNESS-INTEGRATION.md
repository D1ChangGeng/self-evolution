# Harness Integration

Self-Evolution is a project wiki and routing contract. The host harness owns
the conversation, context window, tools, permissions, subprocesses, and task
lifecycle. Self-Evolution supplies durable project knowledge and concise
instructions for retrieving, checking, and maintaining it.

This split lets the same project knowledge work in Codex, Claude Code,
OpenCode, or another agentic coding harness without pretending that all hosts
have the same hooks or configuration files.

## Common contract

Every supported harness should be able to perform this sequence:

```text
start task
  -> load the nearest applicable AGENTS.md files
  -> select the smallest matching Guides and Decisions
  -> verify material claims against current project evidence
  -> plan, execute, test, and inspect the resulting state
  -> at a task boundary, correct durable knowledge or leave the source alone
```

The contract is intentionally expressed in natural language. A harness may
automate a reminder or a routing hint, but the adapter must never decide that
a finding is correct, durable, safe to publish, or worth recording. Those are
semantic decisions made by the agent with evidence from the current task.

The project tree is the shared interface:

```text
AGENTS.md                       # short, high-attention router
.agents/knowledge/index.yaml   # generated retrieval metadata
.agents/knowledge/guides/      # durable procedures, maps, and policies
.agents/knowledge/decisions/   # adopted choices and rationale
.agents/knowledge/observations/# temporary findings awaiting a destination
.agents/knowledge/archive/     # historical material outside normal retrieval
.agents/settings.yaml          # explicit optional integration choices
```

`AGENTS.md` is the shared project route where the host supports it. A host
specific instruction file may point to that route, but must not become a second
knowledge base. If a host has no automatic instruction loading, the user can
issue the equivalent retrieval prompt manually from the project root.

## Host boundaries

### Codex

Codex should use the repository's native instruction loading and task context.
Keep the root `AGENTS.md` short and route to `.agents/knowledge`; do not install
a Self-Evolution hook merely to repeat text that Codex already loads. The
bundled `kb` CLI is invoked explicitly when deterministic checks, indexing,
adapter management, or migration are needed.

For long or delegated tasks, preserve continuity in the host task itself:
carry the objective, constraints, decisions, unresolved questions, and
verification state in the task conversation or its supported handoff/context
mechanism. Promote only cross-task facts into a Guide or Decision. A compacted
or resumed task must reread `AGENTS.md` and the relevant Guide before acting on
old assumptions.

### Claude Code

Claude Code loads `CLAUDE.md` and `CLAUDE.local.md` files by scope. It does not
automatically treat `AGENTS.md` as a project instruction file. Keep one shared
source by committing a small `CLAUDE.md` bridge containing `@AGENTS.md`, then
place any Claude-specific additions below the import. On Windows, the import
is preferable to a symlink because symlink creation may require elevated
privileges or Developer Mode. Confirm the bridge loaded with Claude Code's
`/context` command.

Minimal bridge:

```markdown
@AGENTS.md
```

Add Claude-specific guidance below the import only when it cannot be expressed
as shared project guidance. Keep `CLAUDE.local.md` for uncommitted personal
preferences.

Claude Code's auto memory under `~/.claude/projects/<project>/memory/` is
machine-local and separate from the repository wiki. Do not copy auto-memory
files into `.agents/knowledge/`; promote a finding only after the normal
evidence and future-action tests. The optional `claude-code` adapter adds only
non-writing lifecycle reminders to the project settings file selected by the
CLI. It does not replace host instruction precedence, permissions, skills, MCP
configuration, or session state.

Enable it only when a reminder provides value that the host does not already
provide:

```text
kb adapter install claude-code --features context-recovery,post-task-reminder
kb adapter status claude-code
```

If the host's settings schema or hook behavior differs from the adapter's
supported contract, leave the adapter disabled and use the normal retrieval
prompt. An unsupported host update is an integration result of `unavailable`,
not a reason to weaken the project knowledge model.

### OpenCode

OpenCode loads project `AGENTS.md` rules while traversing the directory tree.
When no project `AGENTS.md` is present, it supports `CLAUDE.md` as a Claude Code
compatibility fallback. OpenCode also supports an `instructions` list in its
configuration for explicit project files or globs; use that only to reference
the same canonical Guides and rules, not to duplicate them. Its Claude Code
compatibility path can discover `.claude/skills` and `~/.claude/skills` unless
disabled by the host environment. The generated project plugin remains
optional. The `opencode` adapter is event-driven and advisory:
it prepends a context-recovery reminder during compaction and emits a
post-task reminder when the session becomes idle. It does not write knowledge,
inspect hidden state, or run a health workflow.

Use an `instructions` entry only to route to the canonical router or to a
task-specific Guide when native rule discovery is insufficient. Prefer an
explicit, narrow path selected for the current task; do not configure a
repository-wide glob that loads every Guide into every task:

```json
{
  "instructions": ["AGENTS.md", ".agents/knowledge/guides/payments.md"]
}
```

Replace `payments.md` with the smallest Guide selected for the task. If no
Guide is needed, keep only `AGENTS.md`; use the generated index as a route and
ask the agent to read the selected document when the host cannot narrow the
configuration dynamically.

```text
kb adapter install opencode --features context-recovery,post-task-reminder
kb adapter status opencode
```

The registration is project-scoped and owned by Self-Evolution. The adapter
must preserve unrelated providers, models, plugins, MCP servers, and hooks;
the CLI backs up and atomically updates the supported configuration. If the
plugin cannot be registered or loaded, continue with manual retrieval and
report the adapter as unavailable. Do not count a reminder as evidence that a
Guide was read or that a task was verified.

## Capability matrix

| Capability                   | Codex                                                       | Claude Code                                                                  | OpenCode                                                                             | Fallback                                       |
| ---------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Project instruction loading  | native project instruction route; verify host configuration | `CLAUDE.md` / `CLAUDE.local.md`; bridge with `@AGENTS.md` for a shared route | `AGENTS.md`, then `CLAUDE.md` compatibility fallback; optional `instructions` config | ask the agent to read `AGENTS.md`              |
| Context recovery reminder    | host task/context; adapter normally unnecessary             | optional `context-recovery`                                                  | optional `context-recovery` plugin event                                             | manual reread after compaction/resume          |
| Post-task Capture reminder   | host task closeout                                          | optional `post-task-reminder`                                                | optional `post-task-reminder` idle event                                             | ask the three Capture questions                |
| Deterministic checks         | explicit `kb` command                                       | explicit `kb` command                                                        | explicit `kb` command                                                                | run Node.js CLI from installed skill path      |
| Knowledge writes             | agent chooses and performs                                  | agent chooses and performs                                                   | agent chooses and performs                                                           | edit the authoritative Guide/Decision directly |
| Semantic conflict resolution | agent + current evidence                                    | agent + current evidence                                                     | agent + current evidence                                                             | stop and record the unresolved conflict        |

The matrix describes the integration contract, not a promise about every host
version. Verify actual host behavior when installing or upgrading an adapter.

## Continuity and feedback

Use three distinct records so a long task does not pollute durable knowledge:

1. **Task state** — the host conversation or handoff carries the current goal,
   constraints, plan, decisions, pending checks, and rollback information.
2. **Project wiki** — Guides and Decisions capture facts and choices that a
   later task can retrieve and act on. Each entry names its scope, evidence,
   applicability, and review trigger.
3. **Skill evolution** — maintainer proposals, evaluations, and release notes
   change the distributed skill. A project task may suggest a change, but does
   not silently alter the installed skill or its release policy.

At each meaningful boundary, connect feedback to an action:

```text
plan -> execute -> verify -> inspect failure or surprise
     -> correct current source or knowledge -> rerun the relevant check
     -> record a scoped, evidenced future action when justified
```

An adapter may remind the agent at compaction or idle time. It must not turn
that reminder into an automatic write, a periodic poller, or a second index.

## Installation and compatibility procedure

Before enabling an adapter:

1. Confirm the project root and read the host's current project configuration.
2. Run `kb adapter install` with only the requested features.
3. Run `kb adapter status <tool>` and inspect the owned registration and
   generated files.
4. Trigger one safe lifecycle event supported by the host (for example, a
   compaction or idle transition) and verify that the advisory text appears.
5. Confirm that knowledge files and unrelated host configuration retain their
   intended content. Repeat installation to check idempotence.
6. If the host rejects the registration, restore the backup or run
   `kb adapter remove <tool>`, then use the documented manual fallback.

Only perform installation or removal when the task scope authorizes changing
the project's host configuration. Preserve a backup before mutation and stop
after one failed repair attempt; a second attempt needs fresh evidence or an
explicitly broadened task scope.

For a host upgrade, rerun this procedure in a disposable project first. A
successful parse of a configuration file is insufficient; status and one
real lifecycle event are required for `available`. Distinguish these states:

- `available`: registration, payloads, and a safe event were verified;
- `disabled`: no adapter was requested, or the user intentionally removed it;
- `unavailable`: the host or its schema cannot satisfy the contract;
- `not-tested`: dependencies, credentials, or a lifecycle event were not
  available in the current environment.

None of these states changes the validity of the project wiki. They only state
how much host integration was verified.

## Source checks

The host behavior above was checked against public documentation on **September
9, 2026**. Host versions may change; repeat the compatibility procedure when
upgrading.

- Claude Code memory and instruction loading: `https://code.claude.com/docs/en/memory`
- OpenCode rules, precedence, Claude Code compatibility, and `instructions`:
  `https://opencode.ai/docs/rules/`
- Codex project instruction behavior should be confirmed from the installed
  Codex release documentation and a fresh task; this repository does not make
  a stronger host-version claim than the local `AGENTS.md` contract.

## Migration and ownership

When migrating v1 hooks, review each detected host integration as `convert` or
`disable` before applying the migration. Conversion maps only to the selected
non-writing v2 reminders. Hook scripts, global settings, provider credentials,
MCP servers, sessions, and unrelated host state remain outside the v2 knowledge
system unless the user explicitly owns and requests their migration.

The generated adapter files and host registrations are disposable integration
outputs. `.agents/knowledge/` and adopted project documentation are the durable
sources. Remove or regenerate outputs from `.agents/settings.yaml`; do not edit
generated files as a second source of truth.

## No-Negative-Echo in harness integration

Use direct, useful instructions in reminders and handoffs: name the next
document to read, the evidence to inspect, and the check to run. When a host
fails to support an adapter, record the affected capability, host/version
boundary, and manual route; omit repeated speculation or discarded designs.
Retain negative wording when it carries a safety or diagnostic boundary, such
as “the adapter never writes knowledge” or “a failed lifecycle probe is
`not-tested`, not a passing result.”
