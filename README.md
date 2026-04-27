# Self-Evolution Skill

An agent skill for creating and maintaining a project-local knowledge base under `.agents/knowledge/`.

## What This Does

Self-Evolution gives coding agents a persistent memory system for a repository. It initializes project knowledge, captures lessons during work, evolves raw notes into structured documentation, checks knowledge health, and crystallizes repeated workflows into reusable skill material.

The current skill has a 1360-line `SKILL.md` with 7 explicit modes plus 1 ambient mode, 29 skill files, 3 lifecycle hooks, 4 tool integration layers, 3 POSIX scripts, and 10 templates.

## Why This Exists

| Gap | Problem | Response |
|-----|---------|----------|
| Reality gap | The code changes faster than the docs. | Capture observations during real work, then evolve them into domain files. |
| Access gap | Useful knowledge exists but isn't loaded when needed. | Route from `AGENTS.md` to scope rules, domain files, references, and local overlays. |
| Trust gap | Old guesses and proven facts can look the same. | Track confidence as `observed`, `verified`, or `canonical`, with cited sources. |

## Quick Start

Install the skill:

```bash
npx skills add D1ChangGeng/self-evolution-skill --skill self-evolution -g -y
```

Update an existing installation to the latest version:

```bash
npx skills add D1ChangGeng/self-evolution-skill --skill self-evolution -g -y
```

The install command is also the update command — it overwrites the skill files with the latest version. Project knowledge under `.agents/knowledge/` is never affected because the skill and project data live in separate directories.

Initialize a project by telling your agent:

```text
Initialize the knowledge base for this project.
```

The skill auto-detects project state:

- Empty project: creates a skeleton knowledge system.
- Existing project: scans the codebase, records detected technologies, creates initial domain knowledge, and writes `AGENTS.md`.

## What Gets Created

```text
your-project/
├── AGENTS.md
└── .agents/
    ├── knowledge/
    │   ├── README.md
    │   ├── manifest.json
    │   ├── SKILL-LOCAL.md
    │   ├── inbox/
    │   ├── domains/
    │   ├── reference/
    │   ├── decisions/
    │   ├── patterns/
    │   ├── crystallized/
    │   └── archive/
    ├── rules/
    └── hooks/
        ├── session-end.sh
        ├── stop.sh
        └── compact-recovery.sh
```

`SKILL-LOCAL.md` is a project-local specialization overlay. It acts like fine-tuning for this skill inside one repository without changing the distributed skill.

## Modes

| User says | Mode | What happens |
|-----------|------|--------------|
| "initialize", "init", "set up knowledge base" | Initialize | Auto-detects empty vs existing project, then creates the knowledge system. |
| "deep init", "brownfield onboarding" | Deep Brownfield Init | 6-phase audit-extract-migrate-restructure for projects with extensive existing `AGENTS.md` or knowledge. |
| "evolve", "update knowledge", "compress inbox" | Evolve | Processes inbox notes, fixes tagged domain corrections, promotes stable knowledge, and updates health metadata. |
| "check health", "KB health" | Health Check | Reports inbox load, staleness, source quality, routing quality, and priority actions. |
| "crystallize", "turn this into a workflow" | Crystallize | Converts repeated workflows into reusable executable documentation or skill material. |
| "improve the skill", "skill maintenance" | Skill Maintenance | Runs Capability Radar with 3 searches, up to 5 candidates, and a 30 minute budget. |
| Explicit project knowledge correction | Targeted Correction | Updates the right knowledge file while preserving source evidence and confidence state. |
| Explicit local specialization request | Project-Local Specialization | Updates `.agents/knowledge/SKILL-LOCAL.md` for repository-specific behavior. |
| Completing a non-trivial task | Capture (ambient) | Writes useful lessons to inbox before reporting the capture decision. |

## Key Features

### Knowledge Management

- Write-first capture protocol: write the inbox entry now, then state `Capture:` after the write.
- `[DOMAIN-FIX: domains/X.md]` tags mark corrections that should be applied at a natural task boundary.
- Confidence ladder keeps raw observations separate from verified and canonical knowledge.
- `skills.pending_review` stores skill-discovery candidates as a write-ahead record during immersive work.
- Optional capture channel markers: `[ERROR]`, `[DECISION]`, `[INCIDENT]` prefixes when the entry type is obvious. Never required.
- Security default: all knowledge is internal by default. Public-facing documents require explicit review before including knowledge content.
- Recurring theme detection during evolve: themes appearing 3+ times across sessions are reported as promotion or crystallization signals.

### Execution Quality

- Context Familiarity rule: if the agent cannot cite the file and line that govern the behavior, it doesn't know enough yet.
- The rule fires on domain transitions, not trivial local edits.
- Activation sentence: bias toward caution over speed, for trivial, local tasks, use judgment.
- Infrastructure verification rule: before external-system operations, verify the domain file, target, version consistency, planned action, and result.
- No partial delivery rule: complete every requested step before final response unless blocked or explicitly asked for incremental work.
- Initialization Quality Contract enforces Read-Before-Write, Placeholder Rejection, Concurrent Exploration, Verification, Anti-Shallow-Work patterns, and minimum content thresholds.
- `scan-project.sh` outputs tech stack facts and repository structure, not skill recommendations.
- Script Adaptation Protocol: scripts output HEURISTIC GAPS sections listing what they could not detect, guiding the LLM to fill gaps manually and feed improvements back via `[SKILL-IDEA]`.
- Metadata Discipline rule: no global-consistency metadata unless script-generated. Classification happens during evolve, not during capture.

### Self-Improvement

- Skill Feedback tags route improvements back into the skill: `[SKILL-FIX]`, `[SKILL-IDEA]`, and `[SKILL-COMPAT]`.
- Mode 7, Skill Maintenance, includes Capability Radar with 3 searches, 5 candidates, and a 30 minute budget.
- Meta-skills only: `find-skills` for discovery and `skill-creator` for creation. No concrete implementation skill names are referenced.
- EVOLUTION-SPEC covers 9 dimensions for checking whether the skill design still fits current agent practice.

### Automation

- 3 lifecycle hooks: `session-end.sh`, `stop.sh`, and `compact-recovery.sh`.
- `compact-recovery.sh` provides a post-compaction re-read directive so the agent reloads project routing after context compression.
- `init-scaffold.sh` copies hook scripts from `references/hooks/` instead of embedding them, ensuring hooks stay in sync with the skill package.
- 4 tool integration layers: JSON adapters for Claude Code, Cursor, and Augment, native ESM plugin for OpenCode.
- 3 POSIX scripts: `init-scaffold.sh`, `scan-project.sh`, and `audit-agents.sh`.
- EVOLUTION-SPEC uses a dual-file architecture: a 130-line root template for distribution and a 228-line `references/` runtime version that is user-local and gitignored when installed into projects.

## Documentation Links

| Document | What it covers |
|----------|----------------|
| [Architecture](docs/ARCHITECTURE.md) | Skill structure, data flow, lifecycle, and extension points. |
| [Usage Guide](docs/USAGE-GUIDE.md) | Mode-by-mode usage and examples. |
| [Hooks Guide](docs/HOOKS-GUIDE.md) | Hook installation, adapters, and automation behavior. |
| [Philosophy](references/philosophy.md) | The three gaps, failure modes, and design rationale. |
| [Lifecycle](references/lifecycle.md) | Capture, organize, verify, promote, compress, and retire flow. |
| [Health Check](references/health-check.md) | Knowledge base metrics and scoring. |
| [Evolution Spec](EVOLUTION-SPEC.md) | Distributable 9-dimension template. |
| [Runtime Evolution Spec](references/EVOLUTION-SPEC.md) | Runtime 9-dimension spec used during skill operation. |

## Skill File Reference

| File | Role |
|------|------|
| `SKILL.md` | 1360-line operating manual with 7 explicit modes plus 1 ambient mode. |
| `EVOLUTION-SPEC.md` | 130-line distributable template for the 9-dimension evolution check. |
| `references/EVOLUTION-SPEC.md` | 228-line runtime evolution spec for user-local skill operation. |
| `references/philosophy.md` | Rationale for the knowledge system and its trust model. |
| `references/lifecycle.md` | Detailed lifecycle rules for capture through retirement. |
| `references/health-check.md` | Health metrics, thresholds, and reporting format. |
| `references/init-deep-reference.md` | Deep initialization and project scanning reference. |
| `references/scripts/init-scaffold.sh` | POSIX scaffold generator for directories and boilerplate files. |
| `references/scripts/scan-project.sh` | POSIX project scanner that reports tech facts and structure. |
| `references/scripts/audit-agents.sh` | AGENTS.md quality audit for brownfield onboarding. |
| `references/hooks/README.md` | Hook system overview. |
| `references/hooks/install-hooks.sh` | Hook installer. |
| `references/hooks/session-end.sh` | Session-end capture reminder hook. |
| `references/hooks/stop.sh` | Stop hook for health and capture checks. |
| `references/hooks/compact-recovery.sh` | Compaction recovery hook with re-read directive. |
| `references/hooks/adapters/claude-code.json` | Claude Code hook adapter. |
| `references/hooks/adapters/cursor.json` | Cursor hook adapter. |
| `references/hooks/adapters/opencode.json` | OpenCode hook adapter (legacy hooks.json format). |
| `references/hooks/adapters/opencode-plugin.mjs` | OpenCode native ESM plugin (recommended — all 3 hooks supported). |
| `references/hooks/adapters/augment.json` | Augment Code hook adapter. |
| `references/templates/root-agents-empty.md` | `AGENTS.md` template for empty projects. |
| `references/templates/root-agents-existing.md` | `AGENTS.md` template for existing projects. |
| `references/templates/knowledge-readme.md` | Knowledge base README template. |
| `references/templates/manifest-schema.json` | Manifest schema template. |
| `references/templates/topic-template.md` | Domain topic template. |
| `references/templates/reference-template.md` | Stable reference template. |
| `references/templates/decision-template.md` | Decision record template. |
| `references/templates/pattern-template.md` | Reusable pattern template. |
| `references/templates/crystallized-template.md` | Crystallized workflow template. |
| `references/templates/skill-local-template.md` | Project-local specialization template. |

## Design Principles

1. Write useful notes before structuring them.
2. Keep project memory local to the repository.
3. Make confidence visible and evidence-based.
4. Route agents to the smallest relevant knowledge file.
5. Treat skill improvement as normal knowledge work.
6. Automate reminders, not judgment.
7. Enforce deep work quality at initialization boundaries.
8. Use technology-neutral examples in all templates.

## License

[Business Source License 1.1](LICENSE) — Free for personal use, open-source, education, and small teams (<10 employees). Commercial use by organizations with 10+ employees requires a [commercial license](mailto:D1ChangGeng@users.noreply.github.com). Converts to Apache 2.0 on 2030-04-27.
