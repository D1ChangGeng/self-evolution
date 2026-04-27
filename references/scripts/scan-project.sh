#!/bin/sh
set -u

usage() {
  cat <<'EOF'
Usage: sh scan-project.sh [--output PATH] [--project-root PATH]

Arguments:
  --output PATH         Where to write the report (default: .agents/knowledge/reference/.project-scan.txt)
  --project-root PATH   Project root (default: CWD)
EOF
}

DEFAULT_OUTPUT='.agents/knowledge/reference/.project-scan.txt'
TOP_LEVEL_LIMIT=120
WORKFLOW_LIMIT=50
PROJECT_ROOT=$(pwd)
OUTPUT_PATH=
TIMEOUT_AVAILABLE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --output)
      shift
      [ $# -gt 0 ] || {
        usage
        exit 1
      }
      OUTPUT_PATH=$1
      ;;
    --project-root)
      shift
      [ $# -gt 0 ] || {
        usage
        exit 1
      }
      PROJECT_ROOT=$1
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

PROJECT_ROOT=$(cd "$PROJECT_ROOT" 2>/dev/null && pwd) || {
  printf 'Project root not found: %s\n' "$PROJECT_ROOT" >&2
  exit 1
}

if [ -z "$OUTPUT_PATH" ]; then
  OUTPUT_PATH=$PROJECT_ROOT/$DEFAULT_OUTPUT
fi

case "$OUTPUT_PATH" in
  /*) ;;
  *) OUTPUT_PATH=$PROJECT_ROOT/$OUTPUT_PATH ;;
esac

OUTPUT_DIR=${OUTPUT_PATH%/*}
[ "$OUTPUT_DIR" = "$OUTPUT_PATH" ] && OUTPUT_DIR=.
mkdir -p "$OUTPUT_DIR" || exit 1

if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_AVAILABLE=1
fi

project_name=${PROJECT_ROOT##*/}
[ -n "$project_name" ] || project_name=$PROJECT_ROOT
generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp_file=$OUTPUT_PATH.tmp.$$

trap 'rm -f "$tmp_file"' EXIT HUP INT TERM

run_find() {
  if [ "$TIMEOUT_AVAILABLE" -eq 1 ]; then
    timeout 8s find "$@"
  else
    find "$@"
  fi
}

scan_tree() {
  base=$1
  shift
  run_find "$base" \( -name .git -o -name node_modules -o -name __pycache__ -o -name .venv -o -name venv -o -name dist -o -name build -o -name target -o -name .next -o -name .nuxt \) -prune -o "$@"
}

trim_count() {
  sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

status_path() {
  path=$1
  label=$2
  if [ -e "$PROJECT_ROOT/$path" ]; then
    printf '[FOUND] %s\n' "$label"
  else
    printf '[NOT FOUND] %s\n' "$label"
  fi
}

status_glob() {
  pattern=$1
  label=$2
  set -- "$PROJECT_ROOT"/$pattern
  if [ -e "$1" ]; then
    printf '[FOUND] %s\n' "$label"
  else
    printf '[NOT FOUND] %s\n' "$label"
  fi
}

detect_primary_language() {
  if [ -f "$PROJECT_ROOT/Cargo.toml" ]; then
    printf 'Rust\n'
  elif [ -f "$PROJECT_ROOT/package.json" ]; then
    printf 'JavaScript/TypeScript\n'
  elif [ -f "$PROJECT_ROOT/go.mod" ]; then
    printf 'Go\n'
  elif [ -f "$PROJECT_ROOT/pyproject.toml" ] || [ -f "$PROJECT_ROOT/requirements.txt" ] || [ -f "$PROJECT_ROOT/setup.py" ] || [ -f "$PROJECT_ROOT/Pipfile" ]; then
    printf 'Python\n'
  elif [ -f "$PROJECT_ROOT/pom.xml" ] || [ -f "$PROJECT_ROOT/build.gradle" ] || [ -f "$PROJECT_ROOT/build.gradle.kts" ]; then
    printf 'Java/Kotlin\n'
  elif [ -f "$PROJECT_ROOT/Gemfile" ]; then
    printf 'Ruby\n'
  elif [ -f "$PROJECT_ROOT/composer.json" ]; then
    printf 'PHP\n'
  elif [ -f "$PROJECT_ROOT/CMakeLists.txt" ]; then
    printf 'C/C++\n'
  elif scan_tree "$PROJECT_ROOT" -name '*.csproj' -print 2>/dev/null | head -n 1 | grep . >/dev/null 2>&1; then
    printf 'C#\n'
  else
    printf 'Unknown\n'
  fi
}

git_remote='Unavailable'
if command -v git >/dev/null 2>&1; then
  remote_value=$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || true)
  if [ -n "$remote_value" ]; then
    git_remote=$remote_value
  else
    git_remote='Not available'
  fi
fi

printf '=== PROJECT SCAN ===\n' > "$tmp_file"
printf 'Generated: %s\n' "$generated_at" >> "$tmp_file"
printf 'Project Root: %s\n\n' "$PROJECT_ROOT" >> "$tmp_file"

printf '%s\n' '--- PROJECT IDENTITY ---' >> "$tmp_file"
printf 'Name: %s\n' "$project_name" >> "$tmp_file"
printf 'Git Remote: %s\n' "$git_remote" >> "$tmp_file"
printf 'Primary Language: %s\n\n' "$(detect_primary_language)" >> "$tmp_file"

printf '%s\n' '--- MANIFEST DETECTION ---' >> "$tmp_file"
status_path package.json package.json >> "$tmp_file"
status_path package-lock.json package-lock.json >> "$tmp_file"
status_path yarn.lock yarn.lock >> "$tmp_file"
status_path pnpm-lock.yaml pnpm-lock.yaml >> "$tmp_file"
status_path Cargo.toml Cargo.toml >> "$tmp_file"
status_path Cargo.lock Cargo.lock >> "$tmp_file"
status_path go.mod go.mod >> "$tmp_file"
status_path go.sum go.sum >> "$tmp_file"
status_path pyproject.toml pyproject.toml >> "$tmp_file"
status_path requirements.txt requirements.txt >> "$tmp_file"
status_path setup.py setup.py >> "$tmp_file"
status_path Pipfile Pipfile >> "$tmp_file"
status_path pom.xml pom.xml >> "$tmp_file"
status_path build.gradle build.gradle >> "$tmp_file"
status_path build.gradle.kts build.gradle.kts >> "$tmp_file"
status_path Gemfile Gemfile >> "$tmp_file"
status_path composer.json composer.json >> "$tmp_file"
status_path CMakeLists.txt CMakeLists.txt >> "$tmp_file"
status_path Makefile Makefile >> "$tmp_file"
if scan_tree "$PROJECT_ROOT" -name '*.csproj' -print 2>/dev/null | head -n 1 | grep . >/dev/null 2>&1; then
  printf '[FOUND] .csproj files\n\n' >> "$tmp_file"
else
  printf '[NOT FOUND] .csproj files\n\n' >> "$tmp_file"
fi

printf '%s\n' '--- DIRECTORY STRUCTURE ---' >> "$tmp_file"
top_level=$(run_find "$PROJECT_ROOT" -mindepth 1 -maxdepth 1 \( -name .git -o -name node_modules -o -name __pycache__ -o -name .venv -o -name venv -o -name dist -o -name build -o -name target -o -name .next -o -name .nuxt \) -prune -o -print 2>/dev/null | sort | head -n "$TOP_LEVEL_LIMIT" || true)
if [ -n "$top_level" ]; then
  printf '%s\n' "$top_level" | while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    name=${entry##*/}
    if [ -d "$entry" ]; then
      count=$(scan_tree "$entry" -type f -print 2>/dev/null | wc -l | trim_count)
      printf '%-15s %s files\n' "$name/" "$count"
    else
      printf '%-15s file\n' "$name"
    fi
  done >> "$tmp_file"
else
  printf '(unavailable)\n' >> "$tmp_file"
fi
total_files=$(scan_tree "$PROJECT_ROOT" -type f -print 2>/dev/null | wc -l | trim_count)
printf 'Total: %s files\n\n' "$total_files" >> "$tmp_file"

printf '%s\n' '--- CODE METRICS ---' >> "$tmp_file"
printf 'Top extensions by file count:\n' >> "$tmp_file"
extensions=$(scan_tree "$PROJECT_ROOT" -type f -print 2>/dev/null | sed 's#^.*/##' | sed '/\./!s#.*#[no extension]#; /\./s#.*\.##' | sort | uniq -c | sort -rn | head -10 || true)
if [ -n "$extensions" ]; then
  printf '%s\n' "$extensions" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    count=$(printf '%s\n' "$line" | sed 's/^[[:space:]]*\([0-9][0-9]*\)[[:space:]].*/\1/')
    ext=$(printf '%s\n' "$line" | sed 's/^[[:space:]]*[0-9][0-9]*[[:space:]]*//')
    printf '%-15s %s files\n' "$ext" "$count"
  done >> "$tmp_file"
else
  printf '(none)\n' >> "$tmp_file"
fi

printf '\nLargest files by line count:\n' >> "$tmp_file"
largest=$(scan_tree "$PROJECT_ROOT" -type f -exec wc -l {} \; 2>/dev/null | sort -rn | head -10 || true)
if [ -n "$largest" ]; then
  printf '%s\n' "$largest" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    count=$(printf '%s\n' "$line" | sed 's/^[[:space:]]*\([0-9][0-9]*\)[[:space:]].*/\1/')
    file=$(printf '%s\n' "$line" | sed 's/^[[:space:]]*[0-9][0-9]*[[:space:]]*//')
    case "$file" in
      "$PROJECT_ROOT"/*) file=${file#"$PROJECT_ROOT"/} ;;
    esac
    printf '%7s %s\n' "$count" "$file"
  done >> "$tmp_file"
else
  printf '(none)\n' >> "$tmp_file"
fi
printf '\n' >> "$tmp_file"

printf '%s\n' '--- EXISTING DOCUMENTATION ---' >> "$tmp_file"
status_path README.md README.md >> "$tmp_file"
status_path README.rst README.rst >> "$tmp_file"
status_path README.txt README.txt >> "$tmp_file"
status_path AGENTS.md AGENTS.md >> "$tmp_file"
status_path CLAUDE.md CLAUDE.md >> "$tmp_file"
status_path .claude .claude/ >> "$tmp_file"
status_path .cursor/rules .cursor/rules/ >> "$tmp_file"
status_path .cursorrules .cursorrules >> "$tmp_file"
status_path docs docs/ >> "$tmp_file"
status_path CONTRIBUTING.md CONTRIBUTING.md >> "$tmp_file"
status_path CHANGELOG.md CHANGELOG.md >> "$tmp_file"
printf '\n' >> "$tmp_file"

printf '%s\n' '--- CI/CD & INFRASTRUCTURE ---' >> "$tmp_file"
if [ -d "$PROJECT_ROOT/.github/workflows" ]; then
  printf '[FOUND] .github/workflows/\n' >> "$tmp_file"
  run_find "$PROJECT_ROOT/.github/workflows" -mindepth 1 -maxdepth 1 -type f -print 2>/dev/null | sed "s#^$PROJECT_ROOT/##" | sort | head -n "$WORKFLOW_LIMIT" >> "$tmp_file"
else
  printf '[NOT FOUND] .github/workflows/\n' >> "$tmp_file"
fi
status_path .gitlab-ci.yml .gitlab-ci.yml >> "$tmp_file"
status_path Dockerfile Dockerfile >> "$tmp_file"
status_path docker-compose.yml docker-compose.yml >> "$tmp_file"
status_path .env.example .env.example >> "$tmp_file"
status_path .env.template .env.template >> "$tmp_file"
status_path Makefile Makefile >> "$tmp_file"
printf '\n' >> "$tmp_file"

printf '%s\n' '--- TESTING ---' >> "$tmp_file"
status_path tests tests/ >> "$tmp_file"
status_path test test/ >> "$tmp_file"
status_path __tests__ __tests__/ >> "$tmp_file"
status_path spec spec/ >> "$tmp_file"
status_glob 'jest.config.*' 'jest.config.*' >> "$tmp_file"
status_glob 'vitest.config.*' 'vitest.config.*' >> "$tmp_file"
status_path pytest.ini pytest.ini >> "$tmp_file"
status_path .pytest_cache .pytest_cache/ >> "$tmp_file"
printf '\n' >> "$tmp_file"

printf '%s\n' '--- CONFIGURATION ---' >> "$tmp_file"
status_glob '.eslintrc*' '.eslintrc*' >> "$tmp_file"
status_glob '.prettierrc*' '.prettierrc*' >> "$tmp_file"
status_path biome.json biome.json >> "$tmp_file"
status_path tsconfig.json tsconfig.json >> "$tmp_file"
status_path jsconfig.json jsconfig.json >> "$tmp_file"
status_path .editorconfig .editorconfig >> "$tmp_file"
status_path config.yaml config.yaml >> "$tmp_file"
status_path config.json config.json >> "$tmp_file"
status_path config.toml config.toml >> "$tmp_file"
status_glob 'config.example.*' 'config.example.*' >> "$tmp_file"

# --- Section 9: Skill Recommendations ---
printf '\n--- DETECTED TECHNOLOGIES ---\n' >> "$tmp_file"

[ -f "$PROJECT_ROOT/Cargo.toml" ] && printf '[DETECTED] Rust (Cargo.toml)\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/package.json" ] && {
  printf '[DETECTED] Node.js (package.json)\n' >> "$tmp_file"
  grep -q '"vue"' "$PROJECT_ROOT/package.json" 2>/dev/null && printf '[DETECTED] Vue (package.json dependency)\n' >> "$tmp_file"
  grep -q '"react"' "$PROJECT_ROOT/package.json" 2>/dev/null && printf '[DETECTED] React (package.json dependency)\n' >> "$tmp_file"
  grep -q '"next"' "$PROJECT_ROOT/package.json" 2>/dev/null && printf '[DETECTED] Next.js (package.json dependency)\n' >> "$tmp_file"
  grep -q '"svelte"' "$PROJECT_ROOT/package.json" 2>/dev/null && printf '[DETECTED] Svelte (package.json dependency)\n' >> "$tmp_file"
  grep -q '"angular"' "$PROJECT_ROOT/package.json" 2>/dev/null && printf '[DETECTED] Angular (package.json dependency)\n' >> "$tmp_file"
  grep -q '"typescript"' "$PROJECT_ROOT/package.json" 2>/dev/null && printf '[DETECTED] TypeScript (package.json dependency)\n' >> "$tmp_file"
  grep -q '"tailwindcss"' "$PROJECT_ROOT/package.json" 2>/dev/null && printf '[DETECTED] Tailwind CSS (package.json dependency)\n' >> "$tmp_file"
}
[ -f "$PROJECT_ROOT/go.mod" ] && printf '[DETECTED] Go (go.mod)\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/pyproject.toml" ] || [ -f "$PROJECT_ROOT/requirements.txt" ] && printf '[DETECTED] Python (manifest detected)\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/pom.xml" ] || [ -f "$PROJECT_ROOT/build.gradle" ] && printf '[DETECTED] Java/Kotlin (build manifest detected)\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/Gemfile" ] && printf '[DETECTED] Ruby (Gemfile)\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/composer.json" ] && printf '[DETECTED] PHP (composer.json)\n' >> "$tmp_file"
[ -d "$PROJECT_ROOT/.github/workflows" ] && printf '[DETECTED] GitHub Actions CI/CD\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/.gitlab-ci.yml" ] && printf '[DETECTED] GitLab CI/CD\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/Dockerfile" ] && printf '[DETECTED] Docker (Dockerfile)\n' >> "$tmp_file"
[ -f "$PROJECT_ROOT/docker-compose.yml" ] || [ -f "$PROJECT_ROOT/docker-compose.yaml" ] && printf '[DETECTED] Docker Compose\n' >> "$tmp_file"
if ! grep -q '\[DETECTED\]' "$tmp_file" 2>/dev/null; then
  printf '(No specific technologies detected)\n' >> "$tmp_file"
fi

mv "$tmp_file" "$OUTPUT_PATH" || exit 1
printf 'Wrote project scan to %s\n' "$OUTPUT_PATH"
