# Optional Adapters

Adapters are explicit project-local integrations. Onboarding leaves them
disabled until a user selects a tool and feature set.

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
core workflow.

Generated project assets live under `.agents/generated/adapters/` when the host
tool supports that layout. Tool-specific registration may also reference those
assets from the host's project configuration.

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

Active adapter status requires both host registration and a successful status
verification.
