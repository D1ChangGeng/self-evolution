# Hooks for the self-evolution system

This directory packages lightweight lifecycle hooks for the self-evolution skill.

Hooks help the knowledge system in two places that are easy to forget during normal work:

- when a task stops, they can remind the operator that the knowledge base may need evolution
- when a session ends, they can leave a breadcrumb in the inbox so the next session checks for missed capture

The hooks are intentionally conservative. They are reminders, not blockers, and every script exits `0` so they cannot prevent a tool from stopping cleanly.

## Supported tools

- Claude Code
- Cursor
- OpenCode (native plugin — all 3 hooks supported)
- Augment Code
- Gemini CLI partial support only for now; no adapter file is shipped yet

Claude Code is the reference format. Cursor and Augment use the same hooks.json shape. OpenCode uses a native ESM plugin (`opencode-plugin.mjs`) that subscribes to OpenCode's plugin event system directly, which provides full coverage of all 3 lifecycle events.

## Files

- `session-end.sh` — appends a session-end reminder to `.agents/knowledge/inbox/{YYYY-MM}.md`
- `stop.sh` — checks `manifest.json` and warns when the inbox or evolution cadence looks unhealthy
- `compact-recovery.sh` — outputs a re-read directive after context compaction
- `install-hooks.sh` — detects the current tool and installs the matching adapter
- `adapters/*.json` — tool-specific hook payloads (Claude Code, Cursor, Augment)
- `adapters/opencode-plugin.mjs` — OpenCode native ESM plugin (replaces hooks.json for OpenCode)

## Install

If you already keep a project-local copy of the installer and adapters:

```sh
sh .agents/hooks/install-hooks.sh
```

If you are installing directly from the skill package:

```sh
sh /root/.agents/skills/self-evolution/references/hooks/install-hooks.sh --project-root /path/to/project
```

You can also force a target tool:

```sh
sh /root/.agents/skills/self-evolution/references/hooks/install-hooks.sh \
  --project-root /path/to/project \
  --tool claude-code
```

Auto-detection order is:

1. `.claude/`
2. `.cursor/`
3. `.opencode/`
4. `augment` in `PATH`

If nothing is detected, the installer exits with a message and asks you to use `--tool`.

## What each hook does

### `session-end.sh`

This script reads the session payload from stdin, extracts `session_id` if present, and appends a reminder entry to the current monthly inbox file.

It does not attempt to summarize the session. Its only job is to leave a deterministic marker so the next session can review the POST-TASK CHECKLIST and decide whether anything important was missed.

### `stop.sh`

This script reads `.agents/knowledge/manifest.json` and extracts `inbox_count` plus `days_since_evolution` with `grep` and `sed`.

If `inbox_count > 10` or `days_since_evolution > 14`, it prints a warning like this to stderr:

```text
[knowledge] inbox_count=15, days_since_evolution=21. Consider running 'evolve'.
```

This is a deterministic reminder. It exists so knowledge health does not depend on the model remembering the session-start protocol every time.

## How adapters work

Each adapter wires the same two commands:

- `sh .agents/hooks/stop.sh`
- `sh .agents/hooks/session-end.sh`

The installer copies the scripts into the target project's `.agents/hooks/` directory, makes them executable, and then applies the matching JSON adapter.

For Claude Code and Augment, the installer merges a `hooks` key into `settings.json` when that key does not already exist. If hooks already exist, it warns and leaves the file unchanged rather than risking corruption.

For Cursor, the installer copies `hooks.json` if it does not already exist. If the target file differs, it warns and skips.

For OpenCode, the installer copies `opencode-plugin.mjs` into `.agents/hooks/` and prints registration instructions. The plugin must be added to your `opencode.json` plugin array:

```json
{
  "plugin": [
    "file://.agents/hooks/opencode-plugin.mjs"
  ]
}
```

The native plugin subscribes directly to OpenCode's event system, mapping:

| OpenCode event | Hook script | Equivalent Claude Code event |
|---|---|---|
| `session.idle` | `stop.sh` | `Stop` |
| `session.deleted` | `session-end.sh` | `SessionEnd` |
| `experimental.session.compacting` | `compact-recovery.sh` | `SessionStart` + `compact` matcher |

This replaces the previous `hooks.json` approach for OpenCode, which did not reliably trigger `SessionStart` or `SessionEnd` events.

## Add custom hooks

Start from the adapter that matches your tool and add more entries in the same `hooks` object.

Recommended pattern:

1. keep these knowledge hooks in place
2. add new commands as separate hook entries
3. keep custom commands fast and non-blocking
4. avoid absolute paths so the config stays portable

If your team needs different behavior per tool, fork the matching adapter file instead of editing all four together.

## Disable hooks

You have two safe options:

1. remove the hook entries from the tool settings file
2. leave the config in place and run `chmod -x .agents/hooks/session-end.sh .agents/hooks/stop.sh`

Because the scripts are standalone and tool-agnostic, disabling them does not affect the rest of the knowledge system.

## Forward compatibility

These files are designed as a bridge until native lifecycle commands land more broadly.

AGENTS.md spec proposal #167 discusses first-class lifecycle command support. If that lands, these scripts should still remain useful as the command payloads or as a fallback for tools that only support command hooks.
