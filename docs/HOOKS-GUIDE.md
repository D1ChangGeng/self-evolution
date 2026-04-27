# Hooks Guide

This guide explains the lifecycle hooks shipped with the self-evolution skill, how to install them, and how each supported tool maps hook events to the same project-local shell scripts.

Hooks are deterministic runtime behavior. `AGENTS.md` rules are advisory because the model chooses whether to follow them. A hook runs because the host tool starts a shell command.

The shipped hooks are intentionally safe by default. They always exit `0`, don't make network calls, and don't edit canonical knowledge directly.

## Why Hooks Matter

Prompt-only rules get weaker in long sessions.

- HumanLayer reports that system prompt attention can degrade to about 1% after 50K+ tokens.
- LIFBench, ACL 2025, reports up to 61.8% performance variance from behavioral constraints.
- Issue reports #26160 and #33603 describe rules being effectively lost after compaction.
- AGENTS.md rules are advisory. Hooks can be mandatory when a tool treats exit `2` or another nonzero exit as a blocking signal.
- AGENTS.md spec proposal #167 discusses native lifecycle commands, which matches this adapter plus script design.

This skill uses hooks for reminders and recovery, not hard enforcement.

## Files Installed

The installer copies the shipped scripts into the target project:

```text
.agents/hooks/session-end.sh
.agents/hooks/stop.sh
.agents/hooks/compact-recovery.sh
```

## Hook 1: `session-end.sh`

**Event:** `SessionEnd`

**Action:** Appends a capture reminder to `.agents/knowledge/inbox/{YYYY-MM}.md`.

**Design:** Reads session JSON from `stdin`, is tool-agnostic, and always exits `0`.

## Hook 2: `stop.sh`

**Event:** `Stop`

**Action:** Checks `.agents/knowledge/manifest.json` for maintenance thresholds.

It warns when:

- `inbox_count > 10`
- `days_since_evolution > 14`

**Design:** Parses JSON with `grep` and `sed`, prints warnings to `stderr`, and always exits `0`.

If the manifest is missing, the hook exits quietly.

## Hook 3: `compact-recovery.sh`

**Event:** `SessionStart`

**Matcher:** `compact`

**Action:** Outputs this directive to `stdout`:

```text
CONTEXT WAS COMPACTED. Re-read AGENTS.md...
```

**Design:** Always exits `0`, has 12 lines, and has zero dependencies.

This hook only fires after context compaction, when prompt rules are most likely to be missing or weakened.

## Updated Adapter Format

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "compact",
      "hooks": [{"type": "command", "command": "sh .agents/hooks/compact-recovery.sh", "timeout": 5000}]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "sh .agents/hooks/stop.sh", "timeout": 5000}]
    }],
    "SessionEnd": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "sh .agents/hooks/session-end.sh", "timeout": 5000}]
    }]
  }
}
```

Keep the `SessionStart` matcher as `compact`. If it is empty, the recovery directive may run at every session start.

## Tool Compatibility

| Tool | Hook Support | Config Format | Adapter |
|------|-------------|---------------|---------|
| Claude Code | Full (27+ events) | `.claude/settings.json` | `adapters/claude-code.json` |
| Cursor | Full (CC compatible) | `.cursor/hooks.json` | `adapters/cursor.json` |
| OpenCode | Full (plugin system) | `.opencode/hooks.json` | `adapters/opencode.json` |
| Augment Code | Full (CC compatible) | `settings.json` | `adapters/augment.json` |
| Gemini CLI | Partial | `.gemini/settings.json` | Not shipped |
| Codex CLI | Partial (expanding) | `hooks.json` | Not shipped |
| Windsurf | No | — | — |
| Cline/Roo | No | — | — |

## Installation

Run the installer from the self-evolution skill directory.

```bash
sh references/hooks/install-hooks.sh --project-root /path/to/project
```

Or specify the tool:

```bash
sh references/hooks/install-hooks.sh --project-root /path/to/project --tool claude-code
```

Installer steps:

1. Detects or uses the selected tool.
2. Creates `.agents/hooks/` if needed.
3. Copies `session-end.sh`, `stop.sh`, and `compact-recovery.sh`.
4. Marks the scripts executable.
5. Installs the matching adapter config.

Commit `.agents/hooks/` and any shared hook config file.

## Manual Installation

```bash
mkdir -p .agents/hooks
cp references/hooks/scripts/session-end.sh .agents/hooks/session-end.sh
cp references/hooks/scripts/stop.sh .agents/hooks/stop.sh
cp references/hooks/scripts/compact-recovery.sh .agents/hooks/compact-recovery.sh
chmod +x .agents/hooks/session-end.sh .agents/hooks/stop.sh .agents/hooks/compact-recovery.sh
```

## Custom Hooks

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|MultiEdit|Write",
      "hooks": [{"type": "command", "command": "sh .agents/hooks/format-after-edit.sh", "timeout": 5000}]
    }]
  }
}
```

- Avoid network calls.
- Use `stderr` for warnings.
- Use `stdout` only for text that should enter model context.
- Exit `0` unless you intentionally want the tool to block work.

## Troubleshooting

### Hook doesn't fire

- Claude Code: `.claude/settings.json`
- Cursor: `.cursor/hooks.json`
- OpenCode: `.opencode/hooks.json`
- Augment Code: `settings.json`

Then test from the project root:

```bash
sh .agents/hooks/stop.sh
```

### Compact recovery runs too often

Check the adapter. `SessionStart` must use matcher `compact`. An empty matcher can make `compact-recovery.sh` run on every session start.

### Compact recovery text isn't visible to the agent

Your tool may run hooks without injecting `stdout` into model context.

### Adapter JSON is rejected

Validate the top-level `hooks` object, commas, brackets, and string quoting.

## Safe Defaults

The default setup is conservative:

- No shipped hook blocks work.
- No shipped hook sends data over the network.
- No shipped hook needs external dependencies.
- `compact-recovery.sh` only fires for `SessionStart` with matcher `compact`.

These defaults keep the hook layer portable while protecting the self-evolution workflow at session end, task stop, and post-compaction recovery.
