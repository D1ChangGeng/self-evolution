# Self-Evolution Skill

A production-grade AI agent skill that creates and governs living project knowledge bases. Designed for any AI coding tool that supports the [Agent Skills](https://skills.sh/) ecosystem.

## What This Does

When an AI coding agent uses this skill, it gains the ability to:

- **Initialize** a hierarchical knowledge system for any project (empty or existing)
- **Capture** learnings automatically during normal development work
- **Evolve** accumulated knowledge through compression, verification, and promotion
- **Assess** knowledge health with quantitative metrics
- **Crystallize** repeated workflows into reusable executable documents

The knowledge base persists across sessions in `.agents/knowledge/`, giving every future session access to what previous sessions learned.

## Why This Exists

AI coding agents lose context between sessions. Every new session starts from scratch, re-discovering conventions, re-learning gotchas, and re-making mistakes that were already solved. Static documentation (README, comments) helps but doesn't evolve with the project.

This skill addresses three gaps:

| Gap | Problem | Solution |
|-----|---------|----------|
| **Reality** | Documentation lags behind code | Zero-friction capture during normal work |
| **Access** | Knowledge exists but can't be found at the right time | Layered routing (AGENTS.md → scope rules → domain files) |
| **Trust** | All text looks equally authoritative | Confidence ladder (observed → verified → canonical) |

## Quick Start

### Install the skill

```bash
npx skills add D1ChangGeng/self-evolution-skill --skill self-evolution -g -y
```

### Initialize a project

Tell your AI agent:

```
Initialize the knowledge base for this project.
```

The skill auto-detects whether the project is empty or existing and runs the appropriate initialization flow:

- **Empty project**: Creates AGENTS.md + knowledge directory skeleton
- **Existing project**: Scans codebase, generates domain files, builds AGENTS.md with project-specific content

### What gets created

```
your-project/
├── AGENTS.md                        # Thin router — project identity + navigation
└── .agents/
    ├── knowledge/
    │   ├── README.md                # System self-description
    │   ├── manifest.json            # Health dashboard
    │   ├── inbox/                   # Raw observations (zero-friction capture)
    │   ├── domains/                 # Organized knowledge by area
    │   ├── reference/               # Stable reference docs
    │   ├── decisions/               # Architecture Decision Records
    │   ├── patterns/                # Verified reusable conventions
    │   ├── crystallized/            # Executable workflows
    │   └── archive/                 # Retired knowledge
    ├── rules/                       # Scope-triggered knowledge discovery
    └── hooks/                       # Lifecycle automation scripts
        ├── session-end.sh
        ├── stop.sh
        └── compact-recovery.sh
```

## Modes

| User says | Mode | What happens |
|-----------|------|-------------|
| "initialize", "set up knowledge base" | **Initialize** | Creates full knowledge system |
| "evolve", "compress inbox", "promote" | **Evolve** | Processes inbox → compresses → verifies → promotes |
| "check health", "KB status" | **Health Check** | Reports metrics and priority actions |
| "crystallize", "formalize this process" | **Crystallize** | Turns repeated workflows into executable docs |
| *(after completing work)* | **Capture** | Automatically captures learnings to inbox |

## Key Features

### Deterministic Scaffold Scripts

Two POSIX shell scripts eliminate boilerplate generation overhead:

- `init-scaffold.sh` — Creates all directories + boilerplate files in one shot
- `scan-project.sh` — Collects structural metadata before the LLM reads any code

### Lifecycle Hooks

Tool-agnostic shell scripts that provide deterministic automation:

| Hook | Event | Action |
|------|-------|--------|
| `session-end.sh` | Session terminates | Appends capture reminder to inbox |
| `stop.sh` | Agent completes task | Checks manifest health, warns if overdue |
| `compact-recovery.sh` | Context compacted | Injects "re-read AGENTS.md" directive |

Supported tools: **Claude Code**, **Cursor**, **OpenCode**, **Augment Code**

### Meta-Evolution (Step 0)

Before every initialization, the skill evaluates its own design against 8 dimensions in `EVOLUTION-SPEC.md`. This prevents the skill itself from becoming stale as the industry advances.

### Knowledge Confidence Model

All AI-generated knowledge starts as `observed`. Promotion requires evidence:

```
observed (seen once) → verified (2+ sources) → canonical (human-approved)
```

### Write-Ahead Capture Protocol

Knowledge capture uses a write-first pattern to prevent declaration-without-execution:

```
1. Write inbox entry NOW (3 lines)
2. Tag domain corrections as [DOMAIN-FIX: domains/X.md]
3. State capture decision: "Capture: inbox (hidden assumption in auth)"
4. Apply domain corrections at natural task boundaries
```

## Documentation

| Document | What it covers |
|----------|---------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, file roles, data flow |
| [Usage Guide](docs/USAGE-GUIDE.md) | Mode-by-mode instructions with examples |
| [Hooks Guide](docs/HOOKS-GUIDE.md) | Hook setup, tool compatibility, custom hooks |

## Skill File Reference

| File | Lines | Role |
|------|-------|------|
| `SKILL.md` | 895 | Operating manual — 6 modes, all instructions |
| `references/EVOLUTION-SPEC.md` | 188 | Meta-evolution checkpoint (8 dimensions) |
| `references/philosophy.md` | 146 | Design rationale (3 gaps, 8 failure modes, 8 principles) |
| `references/lifecycle.md` | 269 | Detailed evolution mechanics |
| `references/health-check.md` | 171 | Health metrics and scoring |
| `references/init-deep-reference.md` | 147 | Scanning methodology reference |
| `references/scripts/init-scaffold.sh` | 571 | Deterministic scaffold creation |
| `references/scripts/scan-project.sh` | 291 | Project pre-scanner |
| `references/hooks/*` | 5 files | Lifecycle hook system |
| `references/templates/*` | 9 files | File templates for all knowledge types |

## Design Principles

1. **Low friction over perfect structure** — A messy inbox entry beats a perfectly structured doc that was never written
2. **Delayed structuring** — Let knowledge accumulate, then organize when patterns emerge
3. **Summaries must trace to details** — Every claim needs a `[source: file:line]` citation
4. **Confidence must be visible** — `observed` vs `verified` vs `canonical` is structural, not optional
5. **Structure serves retrieval** — Knowledge organized for finding, not for display
6. **Knowledge must be allowed to die** — Archive retires stale content without deleting history

## Competitive Analysis

This skill was developed through analysis of 8 competitor skills (25.7K+ installs combined), 10 web sources, 4 research papers, and validated against 15+ industry tools. Key differentiators:

- **Only skill with full knowledge lifecycle management** (capture → compress → verify → promote → crystallize → retire)
- **Only skill with confidence tracking** across all knowledge
- **Only skill with deterministic hooks** for capture enforcement
- **Only skill with meta-evolution** (skill evaluates its own design before each use)

## License

Private. Not for redistribution.
