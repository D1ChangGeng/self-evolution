# Optional Adapters

Adapters are explicit project-local integrations. Onboarding leaves them
disabled until a user selects a tool and feature set. They bridge lifecycle
events that a host already exposes; they do not implement a second memory
engine or task controller. See [Harness Integration](HARNESS-INTEGRATION.md)
for the common contract, capability states, and manual fallbacks.

## Features

| Feature            | Behavior                                                                                               | Knowledge writes |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ---------------- |
| Context recovery   | After compaction, reminds the agent to re-read `AGENTS.md` and relevant Guides                         | None             |
| Post-task reminder | Asks whether to correct knowledge, write a valuable Observation, or keep the source of truth unchanged | None             |

The reminder focuses on the current task boundary. Both features are advisory,
always non-blocking, and delegate semantic knowledge decisions to the core
workflow.

## Management

Use the bundled CLI through the skill:

```text
kb adapter install <tool> [--features context-recovery,post-task-reminder]
kb adapter status [tool]
kb adapter remove <tool>
```

Supported tool values are `claude-code`, `cursor`, `opencode`, and `augment-code`.
Codex normally uses its native `AGENTS.md` and task context, so no Codex adapter
is required for the core workflow. Install an adapter only when a host lifecycle
reminder is missing and the project explicitly wants that reminder.

Installing the `claude-code` adapter does not make Claude Code load `AGENTS.md`.
For shared retrieval, add a project `CLAUDE.md` containing `@AGENTS.md` (and
verify it with Claude Code `/context`) before relying on Claude Code sessions.

Select the host tool and requested features explicitly. Installation records
the choice in `.agents/settings.yaml` and creates only the generated runtime
assets needed by that tool. Status verifies both settings and actual host
configuration. Remove deletes only configuration owned by Self-Evolution.

Settings record each feature as a boolean using underscore keys:

```yaml
adapters:
  active:
    opencode:
      context_recovery: true
      post_task_reminder: false
```

## Safety Contract

For supported JSON or JSONC host configuration, adapter management must:

1. parse and merge the existing file;
2. preserve the semantic content of providers, models, plugins, MCP servers,
   and unrelated hooks; JSONC comments and formatting may be normalized;
3. create a backup before a material modification;
4. write atomically;
5. verify the installed registration by reading it back;
6. remain idempotent when the requested state already exists;
7. remove only entries attributable to Self-Evolution.

If an existing registration has a merge conflict, installation reports the
conflict and preserves the current project and global configuration.

## Runtime Assets

The distributed skill provides pure Node.js adapter helpers for context
recovery, post-task reminders, and OpenCode event routing. The helpers run
independently of POSIX `sh` and leave knowledge writes and maintenance to the
core workflow. A reminder is advisory evidence only: it does not prove that
the agent read a Guide, verified a claim, or completed a task.

Generated project assets live under `.agents/generated/adapters/` when the host
tool supports that layout. Tool-specific registration may also reference those
assets from the host's project configuration. For Claude Code, keep the shared
instruction bridge in a committed `CLAUDE.md` with `@AGENTS.md`; for OpenCode,
prefer its native `AGENTS.md` loading or an `instructions` entry that points to
canonical project docs. Neither bridge nor `instructions` should duplicate the
wiki body.

## Migration from v1 Hooks

v1 Hook configuration may append session markers, check health thresholds, or
invoke shell scripts. Migration records each detected integration and applies a
reviewed convert or disable choice.

For each detected tool that had v1 Hooks explicitly enabled, choose one:

- **convert**: preserve the explicit opt-in and connect it to the selected
  non-writing v2 features;
- **disable**: record the reviewed retirement of the owned v1 registration.

Apply proceeds after every detected enabled tool has a reviewed choice. The
backup and rollback journal include every tool configuration that apply changes.

## Operational Verification

After installation:

- run adapter status;
- inspect the host project configuration for the owned registration;
- trigger the relevant lifecycle event if the tool supports a safe test;
- confirm the message appears and knowledge files retain their current bytes;
- rerun install to verify idempotence;
- remove and confirm unrelated configuration remains.

For Claude Code, also run `/context` and confirm the project `CLAUDE.md` bridge
was loaded. For OpenCode, confirm the project `AGENTS.md` (or explicit
`instructions` entry) is present in the session context. These host checks are
separate from `kb adapter status` and should be recorded as `not-tested` when
the host is unavailable.

Active adapter status requires both host registration and a successful status
verification. For release or upgrade checks, also trigger one safe lifecycle
event and classify the result as `available`, `disabled`, `unavailable`, or
`not-tested`; a parsed config alone is not runtime compatibility evidence.
