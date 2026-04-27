#!/bin/sh
set -u

usage() {
  cat <<'EOF'
Usage: sh audit-agents.sh [--file PATH] [--output PATH]

Arguments:
  --file PATH     AGENTS.md to audit (default: ./AGENTS.md)
  --output PATH   Where to write report (default: .agents/knowledge/reference/agents-audit.md)
EOF
}

AGENTS_FILE=./AGENTS.md
OUTPUT_PATH=.agents/knowledge/reference/agents-audit.md

while [ $# -gt 0 ]; do
  case "$1" in
    --file)
      shift
      [ $# -gt 0 ] || { usage; exit 1; }
      AGENTS_FILE=$1
      ;;
    --output)
      shift
      [ $# -gt 0 ] || { usage; exit 1; }
      OUTPUT_PATH=$1
      ;;
    -h|--help)
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

[ -f "$AGENTS_FILE" ] || {
  printf 'AGENTS.md not found: %s\n' "$AGENTS_FILE" >&2
  exit 1
}

OUTPUT_DIR=${OUTPUT_PATH%/*}
[ "$OUTPUT_DIR" = "$OUTPUT_PATH" ] && OUTPUT_DIR=.
mkdir -p "$OUTPUT_DIR" || exit 1

tmp_file=$OUTPUT_PATH.tmp.$$
trap 'rm -f "$tmp_file"' EXIT HUP INT TERM

trim_count() {
  sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

count_pattern() {
  pattern=$1
  file=$2
  grep -E -c "$pattern" "$file" 2>/dev/null || true
}

has_pattern() {
  pattern=$1
  file=$2
  grep -E "$pattern" "$file" >/dev/null 2>&1
}

section_status() {
  label=$1
  pattern=$2
  if has_pattern "$pattern" "$AGENTS_FILE"; then
    printf '| %s | FOUND |\n' "$label" >> "$tmp_file"
    score=$((score + 1))
  else
    printf '| %s | MISSING |\n' "$label" >> "$tmp_file"
  fi
}

line_count_file() {
  file=$1
  if [ -f "$file" ]; then
    wc -l < "$file" | trim_count
  else
    printf '0'
  fi
}

rel_path() {
  path=$1
  case "$path" in
    ./*) printf '%s\n' "$path" ;;
    *) printf './%s\n' "$path" ;;
  esac
}

artifact_row() {
  artifact=$1
  location=$2
  lines=$3
  printf '| %s | %s | %s |\n' "$artifact" "$location" "$lines" >> "$tmp_file"
}

marker_count() {
  marker=$1
  grep -r --include='*.c' --include='*.cc' --include='*.cpp' --include='*.cs' --include='*.go' --include='*.h' --include='*.hpp' --include='*.java' --include='*.js' --include='*.jsx' --include='*.kt' --include='*.lua' --include='*.php' --include='*.py' --include='*.rb' --include='*.rs' --include='*.sh' --include='*.ts' --include='*.tsx' --include='*.vue' "$marker" . 2>/dev/null | head -100 | wc -l | trim_count
}

marker_samples() {
  marker=$1
  files=$(grep -r -l --include='*.c' --include='*.cc' --include='*.cpp' --include='*.cs' --include='*.go' --include='*.h' --include='*.hpp' --include='*.java' --include='*.js' --include='*.jsx' --include='*.kt' --include='*.lua' --include='*.php' --include='*.py' --include='*.rb' --include='*.rs' --include='*.sh' --include='*.ts' --include='*.tsx' --include='*.vue' "$marker" . 2>/dev/null | sed 's#^./##' | head -3 | paste -sd ', ' -)
  if [ -n "$files" ]; then
    printf '%s\n' "$files"
  else
    printf '—\n'
  fi
}

TODAY=$(date -u +%Y-%m-%d)
LINES=$(line_count_file "$AGENTS_FILE")
H2_COUNT=$(count_pattern '^##[[:space:]]+' "$AGENTS_FILE" | trim_count)
FENCE_LINES=$(count_pattern '^```' "$AGENTS_FILE" | trim_count)
CODE_BLOCKS=$((FENCE_LINES / 2))
TABLE_ROWS=$(count_pattern '^|' "$AGENTS_FILE" | trim_count)
DIRECTIVES=$(count_pattern '\b(DO NOT|NEVER|ALWAYS|MUST)\b' "$AGENTS_FILE" | trim_count)
PATH_REFS=$(count_pattern '(^|[^[:alnum:]_./-])([.][A-Za-z0-9_-]+/|src/|lib/|app/|bin/|cmd/|pkg/|docs/|tests/|test/|ui/|server/|client/|config/)' "$AGENTS_FILE" | trim_count)
SECRET_FLAGS=$(count_pattern '(API_KEY|SECRET|PASSWORD|TOKEN)[[:space:]]*[:=]' "$AGENTS_FILE" | trim_count)
ABS_PATHS=$(count_pattern '(/home/|/Users/|/root/)' "$AGENTS_FILE" | trim_count)
INTERNAL_URLS=$(count_pattern '(https?://)?(192\.168\.|10\.|localhost|[^[:space:]]*internal[^[:space:]]*)' "$AGENTS_FILE" | trim_count)

line_status='OK — target 150-250'
if [ "$LINES" -gt 300 ]; then
  line_status='BLOATED — over 300 lines'
elif [ "$LINES" -lt 30 ]; then
  line_status='SPARSE — under 30 lines'
elif [ "$LINES" -lt 150 ] || [ "$LINES" -gt 250 ]; then
  line_status='OK — outside ideal 150-250'
fi

printf '# AGENTS.md Quality Audit\n\n' > "$tmp_file"
printf 'File: %s\n' "$AGENTS_FILE" >> "$tmp_file"
printf 'Audited: %s\n' "$TODAY" >> "$tmp_file"
printf 'Lines: %s\n\n' "$LINES" >> "$tmp_file"

printf '## Structure Score\n\n' >> "$tmp_file"
printf '| Section | Status |\n' >> "$tmp_file"
printf '|---------|--------|\n' >> "$tmp_file"
score=0
section_status 'IDENTITY' '(^##[[:space:]]+(IDENTITY|Identity|Overview|OVERVIEW)\b|^##[[:space:]]+)'
section_status 'COMMANDS' '^##[[:space:]]+.*(COMMANDS|Commands)\b'
section_status 'STRUCTURE' '^##[[:space:]]+.*(STRUCTURE|Structure)\b'
section_status 'WHERE TO LOOK' '(WHERE TO LOOK|Where to Look|routing table|Routing Table)'
section_status 'CORE INVARIANTS' '(CORE INVARIANTS|Core Invariants|invariants|rules section|Rules)'
section_status 'CRITICAL ANTI-PATTERNS' '(CRITICAL ANTI-PATTERNS|Critical Anti-Patterns|anti-pattern|warnings|Warnings)'
section_status 'SESSION START' '(SESSION START|Session Start)'
section_status 'CODING DISCIPLINE' '(CODING DISCIPLINE|Coding Discipline)'
section_status 'POST-TASK CHECKLIST' '(POST-TASK CHECKLIST|Post-Task Checklist)'
section_status 'SELF-EVOLUTION RULES' '(SELF-EVOLUTION RULES|Self-Evolution Rules|knowledge management|Knowledge Management)'
printf '\nStructure: %s/10 sections present\n\n' "$score" >> "$tmp_file"

printf '## Signal Quality\n\n' >> "$tmp_file"
printf -- '- Lines: %s (%s)\n' "$LINES" "$line_status" >> "$tmp_file"
printf -- '- Sections (h2): %s\n' "$H2_COUNT" >> "$tmp_file"
printf -- '- Code blocks: %s\n' "$CODE_BLOCKS" >> "$tmp_file"
printf -- '- Table rows: %s\n' "$TABLE_ROWS" >> "$tmp_file"
printf -- '- Directives (MUST/NEVER/ALWAYS): %s\n' "$DIRECTIVES" >> "$tmp_file"
printf -- '- File path references: %s\n\n' "$PATH_REFS" >> "$tmp_file"

printf '## Risk Flags\n\n' >> "$tmp_file"
printf -- '- Potential secrets: %s\n' "$SECRET_FLAGS" >> "$tmp_file"
printf -- '- Absolute paths: %s\n' "$ABS_PATHS" >> "$tmp_file"
printf -- '- Internal URLs: %s\n\n' "$INTERNAL_URLS" >> "$tmp_file"

printf '## Knowledge Artifact Inventory\n\n' >> "$tmp_file"
printf '| Artifact | Location | Lines |\n' >> "$tmp_file"
printf '|----------|----------|-------|\n' >> "$tmp_file"
find . -name AGENTS.md -type f 2>/dev/null | sort | head -10 | while IFS= read -r f; do
  artifact_row 'AGENTS.md' "$f" "$(line_count_file "$f")"
done
[ -f ./CLAUDE.md ] && artifact_row 'CLAUDE.md' './CLAUDE.md' "$(line_count_file ./CLAUDE.md)"
if [ -d ./.claude/commands ]; then
  count=$(find ./.claude/commands -name '*.md' -type f 2>/dev/null | wc -l | trim_count)
  artifact_row '.claude/commands/*.md' "$count files" '—'
fi
if [ -d ./.claude/rules ]; then
  count=$(find ./.claude/rules -name '*.md' -type f 2>/dev/null | wc -l | trim_count)
  artifact_row '.claude/rules/*.md' "$count files" '—'
fi
if [ -d ./.cursor/rules ]; then
  count=$(find ./.cursor/rules -type f 2>/dev/null | wc -l | trim_count)
  artifact_row '.cursor/rules/' "$count files" '—'
fi
if [ -d ./docs ]; then
  count=$(find ./docs -maxdepth 1 -type f 2>/dev/null | wc -l | trim_count)
  artifact_row 'docs/' "$count files" '—'
fi
[ -f ./CONTRIBUTING.md ] && artifact_row 'CONTRIBUTING.md' './CONTRIBUTING.md' "$(line_count_file ./CONTRIBUTING.md)"
[ -f ./CHANGELOG.md ] && artifact_row 'CHANGELOG.md' './CHANGELOG.md' "$(line_count_file ./CHANGELOG.md)"
printf '\n' >> "$tmp_file"

printf '## Code Comment Markers\n\n' >> "$tmp_file"
printf '| Marker | Count | Sample files |\n' >> "$tmp_file"
printf '|--------|-------|--------------|\n' >> "$tmp_file"
for marker in TODO FIXME HACK XXX; do
  count=$(marker_count "$marker")
  samples=$(marker_samples "$marker")
  printf '| %s | %s | %s |\n' "$marker" "$count" "$samples" >> "$tmp_file"
done
printf '\n' >> "$tmp_file"

rating=GOOD
recommendation='AGENTS.md is well-structured; keep it concise and evidence-linked.'
if [ "$SECRET_FLAGS" -gt 0 ] || [ "$ABS_PATHS" -gt 0 ] || [ "$INTERNAL_URLS" -gt 0 ]; then
  rating=RISKY
  recommendation='Remove sensitive-looking values, machine-specific paths, or internal URLs.'
elif [ "$score" -lt 6 ] || [ "$LINES" -lt 30 ]; then
  rating=INCOMPLETE
  recommendation='Add missing operating sections and routing guidance.'
elif [ "$LINES" -gt 300 ] || [ "$DIRECTIVES" -gt 40 ]; then
  rating=NOISY
  recommendation='Compress low-value detail and reduce directive overload.'
fi

printf '## Assessment\n\n' >> "$tmp_file"
printf 'Rating: %s\n' "$rating" >> "$tmp_file"
printf 'Recommendation: %s\n\n' "$recommendation" >> "$tmp_file"

printf '## Audit Limitations\n\n' >> "$tmp_file"
printf 'This audit checks structural patterns and keyword density. It cannot assess:\n' >> "$tmp_file"
printf '%s\n' '- Whether claims in AGENTS.md are factually correct (verify against source code)' >> "$tmp_file"
printf '%s\n' '- Whether the routing table covers all active project areas' >> "$tmp_file"
printf '%s\n' '- Whether invariants and anti-patterns reflect real project constraints vs generic advice' >> "$tmp_file"
printf '%s\n' '- Whether the AGENTS.md structure fits this specific project type' >> "$tmp_file"
printf '\n' >> "$tmp_file"
printf 'LLM action after reading this audit:\n' >> "$tmp_file"
printf '1. Spot-check 2-3 claims from AGENTS.md against actual source files\n' >> "$tmp_file"
printf '2. Verify that WHERE TO LOOK paths exist and point to current files\n' >> "$tmp_file"
printf '3. If this project has unusual structure (monorepo, multi-language, etc.),\n' >> "$tmp_file"
printf '   check whether the audit missed important structural signals\n' >> "$tmp_file"

mv "$tmp_file" "$OUTPUT_PATH" || exit 1
printf 'Wrote audit report: %s\n' "$OUTPUT_PATH"
