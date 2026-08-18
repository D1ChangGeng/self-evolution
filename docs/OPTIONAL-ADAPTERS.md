# Optional Adapters

Adapters are explicit project-local integrations. Self-Evolution installs none
by default, and onboarding never requires an adapter decision.

## Features

| Feature | Behavior | Knowledge writes |
|---|---|---|
| Context recovery | After compaction, reminds the agent to re-read `AGENTS.md` and relevant Guides | None |
| Post-task reminder | Asks whether to correct knowledge, write a valuable Observation, or save nothing | None |

The reminder does not inspect backlog pressure, elapsed days, confidence, or a
health score. Both features are advisory, always non-blocking, and contain no
semantic knowledge logic.

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

1. parse the existing file rather than replace it with a template;
2. preserve the semantic content of providers, models, plugins, MCP servers,
   and unrelated hooks; JSONC comments and formatting may be normalized;
3. create a backup before a material modification;
4. write atomically;
5. verify the installed registration by reading it back;
6. remain idempotent when the requested state already exists;
7. remove only entries attributable to Self-Evolution.

If an existing registration cannot be merged safely, installation stops and
reports the conflict. It does not discard user configuration or fall back to a
global install.

## Runtime Assets

The distributed skill provides pure Node.js adapter helpers for context
recovery, post-task reminders, and OpenCode event routing. They do not require
POSIX `sh`, write Observations, or invoke the knowledge maintenance workflow.

Generated project assets live under `.agents/generated/adapters/` when the host
tool supports that layout. Tool-specific registration may also reference those
assets from the host's project configuration.

## Migration from v1 Hooks

v1 Hook configuration may append session markers, check health thresholds, or
invoke shell scripts. Migration never carries this behavior forward silently.

For each detected tool that had v1 Hooks explicitly enabled, choose one:

- **convert**: preserve the explicit opt-in but replace v1 behavior with the
  selected non-writing v2 features;
- **disable**: remove the owned v1 registration and leave v2 adapters off.

Migration apply stops until every detected enabled tool has a reviewed choice.
The backup and rollback journal include every tool configuration that apply may
change.

## Operational Verification

After installation:

- run adapter status;
- inspect the host project configuration for the owned registration;
- trigger the relevant lifecycle event if the tool supports a safe test;
- confirm the message appears and no knowledge file changes;
- rerun install to verify idempotence;
- remove and confirm unrelated configuration remains.

Do not describe an adapter as active merely because helper files exist. Active
means the host configuration is registered and status verification succeeds.
