# Self-Evolution v1 Archive

This directory preserves the last v1 distribution for migration support during
the complete `2.x` release line. It is historical evidence, not an installable
skill and not a supported runtime.

## Layout

- `skill/SKILL.v1.md` is the original v1 skill entry, renamed so skill
  discovery cannot load a second `self-evolution` skill.
- `skill/EVOLUTION-SPEC.md` and `skill/references/` preserve the v1 design,
  scripts, hooks, adapters, templates, and detailed reference documents.
- `PROJECT-README.v1.md` and `docs/` preserve the public v1 documentation.

## Support Boundary

- v2 migration tooling reads project-local v1 data such as
  `.agents/knowledge/`, `.agents/rules/`, `.agents/hooks/`, and tool adapter
  configuration. It does not execute this archive.
- The archive is read-only. Fixes belong in the v2 implementation or its
  migration tooling.
- v1 detection, prepare/apply/rollback migration, and rollback support remain
  available throughout `2.x`. Removal is reserved for `3.0`.
- Do not rename `SKILL.v1.md` back to `SKILL.md`; doing so can make this archive
  discoverable as a duplicate skill.
- Links inside preserved v1 documents retain their original repository-relative
  targets and may not resolve from this archive location. The bytes are kept
  unchanged so migration investigations can compare against the v1 release.

When investigating a migration discrepancy, compare the original project
artifact with the matching template or script here, then record the behavior as
a fixture or failure case in the v2 maintainer system.
