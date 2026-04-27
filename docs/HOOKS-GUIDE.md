# Hooks Guide

This guide covers hook setup, tool compatibility, and how to adapt the shipped scripts for the self-evolution skill.

## What Are Hooks

Hooks are shell scripts that run at specific lifecycle events, such as task completion, session end, or context compaction.

They are deterministic. They execute because the host tool starts a shell process, regardless of what the LLM remembers or chooses to follow.

The key distinction:

- `AGENTS.md` rules are advisory. The LLM decides whether to follow them.
- Hooks are mandatory. The shell executes them when the configured event fires.

Hooks turn critical reminders into runtime behavior instead of prompt text.

## Why Hooks Matter for Knowledge Management

Long sessions are a poor place to rely on prompt-only rules.

Research and field testing show that:

- System prompt attention can degrade to about 1% after 50K+ tokens.
- Behavioral constraints can show up to 61.8% performance variance.
- After context compaction, rules are often effectively lost.

Hooks solve this by enforcing checks at the moments that matter most: session end, task completion, and post-compaction recovery.

They don't replace `AGENTS.md`. They backstop it with deterministic enforcement.

## The Three Hooks

### `session-end.sh`

**When:** Session terminates.

**What:** Appends a capture reminder to the knowledge inbox.

**Why:** Ensures the next session checks for missed knowledge, even if the previous session ended abruptly or skipped capture.

**How it works:** Reads session JSON from `stdin`, computes the current month, and writes to:

```text
.agents/knowledge/inbox/{YYYY-MM}.md
```

### `stop.sh`

**When:** Agent completes a task.

**What:** Checks `.agents/knowledge/manifest.json` for `inbox_count` and `days_since_evolution`.

**Why:** Gives a deterministic nudge without relying on the LLM to remember `SESSION START`.

**How it works:** Uses `grep` and `sed` to extract JSON values, then prints warnings to `stderr` when inbox or evolution thresholds are exceeded.

### `compact-recovery.sh`

**When:** Context is compacted, usually configured as `SessionStart` with matcher `compact`.

**What:** Injects a directive telling the agent to re-read `AGENTS.md`.

**Why:** Prevents post-compaction rule amnesia.

**How it works:** Outputs directive text to `stdout`. Tools that support context injection add that output back into the agent context.

## Tool Compatibility Table

| Tool | Hook Support | Config Format | Adapter |
|------|-------------|---------------|---------|
| Claude Code | Full (27+ events) | `settings.json` | `adapters/claude-code.json` |
| Cursor | Full (CC compatible) | `.cursor/hooks.json` | `adapters/cursor.json` |
| OpenCode | Full (plugin system) | `.opencode/hooks.json` | `adapters/opencode.json` |
| Augment Code | Full (CC compatible) | `settings.json` | `adapters/augment.json` |
| Gemini CLI | Partial | `.gemini/settings.json` | Not shipped yet |
| Codex CLI | Partial (expanding) | `hooks.json` | Not shipped yet |
| Windsurf | No | N/A | N/A |
| Cline/Roo | No | N/A | N/A |
| Aider | No | N/A | N/A |

All shipped adapters use the Claude Code JSON shape.

## Installation

Run the installer from the self-evolution skill directory.

### Auto-detect

```bash
sh references/hooks/install-hooks.sh --project-root /path/to/project
```

### Specify tool

```bash
sh references/hooks/install-hooks.sh --project-root /path/to/project --tool claude-code
```

Supported `--tool` values are `claude-code`, `cursor`, `opencode`, and `augment`.

### What the installer does

1. Detects the tool by checking for `.claude/`, `.cursor/`, `.opencode/`, or `augment` in `PATH`.
2. Copies `session-end.sh`, `stop.sh`, and `compact-recovery.sh` to `.agents/hooks/`.
3. Makes the copied scripts executable.
4. Installs the matching adapter JSON config.

Keep `.agents/hooks/` under version control if you want every contributor and agent session to share the same lifecycle behavior.

## Adding Custom Hooks

Add custom hooks by editing the adapter JSON for your tool and adding another entry under the relevant event.

Example: auto-format after file edits in a Claude Code compatible config.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "sh .agents/hooks/format-after-edit.sh"
          }
        ]
      }
    ]
  }
}
```

Recommended patterns:

- Keep hooks fast. Aim for under one second.
- Keep hooks non-blocking. Warn instead of stopping work.
- Exit `0` unless failure must block the event.
- Write diagnostics to `stderr`.
- Prefer wrapper scripts over long inline commands.

## Disabling Hooks

### Option 1: Remove hook entries from tool config

Edit the tool config and remove entries that call `.agents/hooks/` scripts.

### Option 2: Remove execute permission

```bash
chmod -x .agents/hooks/session-end.sh
chmod -x .agents/hooks/stop.sh
chmod -x .agents/hooks/compact-recovery.sh
```

## Forward Compatibility

AGENTS.md spec proposal #167 discusses lifecycle commands, including bootstrap and post-chat events.

The shipped hooks align with that direction:

- `compact-recovery.sh` maps to bootstrap or session start recovery.
- `stop.sh` maps to post-chat or task completion checks.
- `session-end.sh` maps to session close or transcript finalization.

If native lifecycle command support becomes common, these scripts remain useful as command payloads. The adapter layer may change, but the shell scripts can stay small and portable.

## Troubleshooting

### Hook not firing?

Check that the config is in the location your tool reads:

- Claude Code: `settings.json`
- Cursor: `.cursor/hooks.json`
- OpenCode: `.opencode/hooks.json`
- Augment Code: `settings.json`

Also confirm the script path in the adapter matches your project layout.

### Hook errors appear in output?

The shipped scripts always exit `0`. Check `stderr` for warnings or path problems. You can test a script manually from the project root:

```bash
sh .agents/hooks/stop.sh
```

### Adapter format wrong?

All adapters use the Claude Code JSON shape. If your tool expects another schema, keep the scripts and write a thin adapter that maps your tool's events to the same commands.

### Inbox warning never appears?

Check that `.agents/knowledge/manifest.json` exists and contains `inbox_count` and `days_since_evolution`.

### Compact recovery text not injected?

Confirm your tool supports injecting hook `stdout` into context. Some tools can run hooks but don't add output back into the model context.
