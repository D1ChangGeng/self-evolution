# Self-Evolution Repository Context

## Project Purpose

Self-Evolution is a repository-local context skill for coding agents. The
distributed v2 skill, deterministic `kb` CLI, migration support, optional
adapters, maintainer evaluations, and frozen v1 baseline are developed and
verified together in this repository.

## Essential Commands

```text
npm ci
npm run ci
npm run eval:external:test
node skills/self-evolution/references/bin/kb.mjs check --project-root .
```

## Critical Rules

- Treat `skills/self-evolution/` and its bundled CLI as one release subject;
  rebuild and verify the bundle whenever CLI source changes.
- Keep `legacy/v1/` byte-preserved against
  `maintainer/evals/baseline/v1.json`; the evaluator needs complete Git history
  to verify its source commit.
- Keep integrated outcome gates pending until their required model runs and
  blinded evidence exist. Deterministic checks establish structural and safety
  facts only.
- Keep external real-task campaigns separate from formal release gates; their
  reports do not change `release_ready`.
- Preserve unrelated worktree changes. Stage release files through an explicit
  allowlist and inspect the exact staged or remote tree before publication.

## Where to Look

| Task or scope | Read |
|---|---|
| Product overview and public behavior | `README.md`, `docs/ARCHITECTURE.md`, `docs/USAGE-GUIDE.md` |
| Distributed skill behavior | `skills/self-evolution/SKILL.md`, `skills/self-evolution/references/` |
| CLI implementation and tests | `tools/kb/src/`, `tools/kb/test/` |
| v1-to-v2 migration | `README.md`, then `docs/MIGRATION.md` |
| Release gates and current evidence | `maintainer/evals/SPEC.md`, `maintainer/evals/RESULTS.md` |
| External real-task campaigns | `maintainer/evals/external/README.md`, `.agents/knowledge/guides/evaluation-and-release.md` |
| Project knowledge index | `.agents/knowledge/index.yaml` |

## Knowledge Rule

Use project knowledge as routing and decision support, then verify material
claims against current code, tests, configuration, runtime evidence, or
authoritative documentation. Correct the authoritative knowledge document when
reality disagrees. Add knowledge only when it will change a plausible future
action and has a clear consumer.
