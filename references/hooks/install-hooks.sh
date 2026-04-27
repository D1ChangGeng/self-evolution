#!/bin/sh

usage() {
  cat <<'EOF'
Usage: sh install-hooks.sh [--project-root PATH] [--tool auto|claude-code|cursor|opencode|augment]

Arguments:
  --project-root PATH   Project root (default: CWD)
  --tool TOOL           Which tool to install for (default: auto-detect)
EOF
}

say() {
  printf '%s\n' "$1"
}

warn() {
  printf 'warning: %s\n' "$1" >&2
}

copy_file_if_safe() {
  source_file=$1
  target_file=$2
  label=$3

  if [ -f "$target_file" ]; then
    if cmp -s "$source_file" "$target_file" 2>/dev/null; then
      say "skipped $label: already up to date"
      return 0
    fi

    warn "$label already exists at $target_file; leaving it unchanged"
    return 1
  fi

  cp "$source_file" "$target_file" || return 1
  say "installed $label: $target_file"
  return 0
}

append_hooks_section() {
  target_file=$1
  adapter_file=$2
  tmp_file=$target_file.tmp.$$
  hooks_file=$target_file.hooks.$$

  if grep -Eq '^[[:space:]]*\{[[:space:]]*\}[[:space:]]*$' "$target_file" 2>/dev/null; then
    cp "$adapter_file" "$target_file" || return 1
    return 0
  fi

  if ! awk '
    {
      lines[NR] = $0
    }
    END {
      last = NR
      while (last > 0 && lines[last] ~ /^[[:space:]]*$/) {
        last--
      }
      if (last == 0 || lines[last] !~ /^[[:space:]]*}[[:space:]]*$/) {
        exit 2
      }
      if (last == 1) {
        exit 2
      }
      for (i = 1; i < last; i++) {
        print lines[i]
      }
    }
  ' "$target_file" > "$tmp_file"; then
    rm -f "$tmp_file" "$hooks_file"
    return 1
  fi

  if ! awk '
    NR == 1 {
      next
    }
    {
      lines[NR] = $0
    }
    END {
      for (i = 2; i < NR; i++) {
        print lines[i]
      }
    }
  ' "$adapter_file" > "$hooks_file"; then
    rm -f "$tmp_file" "$hooks_file"
    return 1
  fi

  if grep -Eq '^[[:space:]]*"[^"]+"[[:space:]]*:' "$target_file" 2>/dev/null; then
    printf ',\n' >> "$tmp_file"
  else
    printf '\n' >> "$tmp_file"
  fi

  cat "$hooks_file" >> "$tmp_file"
  printf '\n}\n' >> "$tmp_file"

  if mv "$tmp_file" "$target_file"; then
    rm -f "$hooks_file"
    return 0
  fi

  rm -f "$tmp_file" "$hooks_file"
  return 1
}

merge_settings_hooks() {
  tool_name=$1
  adapter_file=$2
  target_file=$3

  if [ ! -f "$target_file" ]; then
    cp "$adapter_file" "$target_file" || return 1
    say "installed $tool_name hooks: $target_file"
    return 0
  fi

  if grep -Eq '"hooks"[[:space:]]*:' "$target_file" 2>/dev/null; then
    warn "$tool_name settings already contain a hooks key; skipping merge for $target_file"
    return 1
  fi

  if append_hooks_section "$target_file" "$adapter_file"; then
    say "merged $tool_name hooks into $target_file"
    return 0
  fi

  warn "could not safely merge hooks into $target_file"
  return 1
}

detect_tool() {
  root=$1

  if [ -d "$root/.claude" ]; then
    printf '%s\n' 'claude-code'
    return 0
  fi

  if [ -d "$root/.cursor" ]; then
    printf '%s\n' 'cursor'
    return 0
  fi

  if [ -d "$root/.opencode" ]; then
    printf '%s\n' 'opencode'
    return 0
  fi

  if command -v augment >/dev/null 2>&1; then
    printf '%s\n' 'augment'
    return 0
  fi

  return 1
}

project_root=$(pwd)
tool=auto

while [ $# -gt 0 ]; do
  case "$1" in
    --project-root)
      shift
      if [ $# -eq 0 ]; then
        usage
        exit 1
      fi
      project_root=$1
      ;;
    --tool)
      shift
      if [ $# -eq 0 ]; then
        usage
        exit 1
      fi
      tool=$1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

case "$tool" in
  auto|claude-code|cursor|opencode|augment)
    ;;
  *)
    usage
    exit 1
    ;;
esac

if [ ! -d "$project_root" ]; then
  printf 'Project root does not exist: %s\n' "$project_root" >&2
  exit 1
fi

project_root=$(CDPATH= cd -- "$project_root" 2>/dev/null && pwd)
script_dir=$(CDPATH= cd -- "$(dirname "$0")" 2>/dev/null && pwd)

if [ -z "$project_root" ] || [ -z "$script_dir" ]; then
  printf 'Could not resolve install paths.\n' >&2
  exit 1
fi

if [ "$tool" = auto ]; then
  if ! tool=$(detect_tool "$project_root"); then
    printf 'No supported tool detected. Use --tool to specify.\n' >&2
    exit 1
  fi
fi

hooks_dir=$project_root/.agents/hooks
mkdir -p "$hooks_dir" || exit 1
copy_file_if_safe "$script_dir/session-end.sh" "$hooks_dir/session-end.sh" 'session-end hook script'
copy_file_if_safe "$script_dir/stop.sh" "$hooks_dir/stop.sh" 'stop hook script'
copy_file_if_safe "$script_dir/compact-recovery.sh" "$hooks_dir/compact-recovery.sh" 'compact-recovery hook script'
chmod +x "$hooks_dir/session-end.sh" "$hooks_dir/stop.sh" "$hooks_dir/compact-recovery.sh" 2>/dev/null || true

case "$tool" in
  claude-code)
    mkdir -p "$project_root/.claude" || exit 1
    merge_settings_hooks 'Claude Code' "$script_dir/adapters/claude-code.json" "$project_root/.claude/settings.json"
    ;;
  cursor)
    mkdir -p "$project_root/.cursor" || exit 1
    copy_file_if_safe "$script_dir/adapters/cursor.json" "$project_root/.cursor/hooks.json" 'Cursor hooks configuration'
    ;;
  opencode)
    mkdir -p "$project_root/.opencode" || exit 1
    copy_file_if_safe "$script_dir/adapters/opencode-plugin.mjs" "$hooks_dir/opencode-plugin.mjs" 'OpenCode native plugin'
    plugin_uri="file://$project_root/.agents/hooks/opencode-plugin.mjs"
    opencode_config="$project_root/.opencode/opencode.json"
    if [ -f "$opencode_config" ]; then
      if grep -q 'opencode-plugin\.mjs' "$opencode_config" 2>/dev/null; then
        say "OpenCode config already references the plugin; skipping"
      else
        warn "Add this to your opencode.json plugin array: \"$plugin_uri\""
      fi
    else
      say "note: register the plugin by running: opencode plugin \"$plugin_uri\""
      say "  or add to your opencode.json: { \"plugin\": [\"$plugin_uri\"] }"
    fi
    ;;
  augment)
    mkdir -p "$project_root/.augment" || exit 1
    merge_settings_hooks 'Augment' "$script_dir/adapters/augment.json" "$project_root/.augment/settings.json"
    ;;
esac

say "tool selected: $tool"
say "hooks directory: $hooks_dir"
exit 0
