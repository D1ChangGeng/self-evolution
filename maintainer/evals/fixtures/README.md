# Fixture Guidance

Fixtures must be public or synthetic, deterministic, secret-free, and small
enough to inspect. Each numbered fixture directory includes:

- `README.md`: task, expected retrieval, material claims, and expected outcome;
- `fixture.json.setup.files`: the immutable synthetic input, including each
  file's path, role, and exact content;
- `fixture.json.setup.assertions`: self-checks that prove the declared input
  actually contains each intended conflict, boundary, or absence after the
  input is materialized byte-for-byte in an isolated directory;
- `fixture.json.verifier`: a declared focused command entry that must execute
  against the materialized starting state, with an explicit expected initial
  status so defect fixtures prove they actually fail before repair;
- `fixture.json.action_rubric`: required and forbidden actions with evidence
  types from raw retrieval logs, transcripts, patches, tests, diffs, commands,
  snapshots, judgments, and final delivery;
- provenance and license notes for non-synthetic input.

Do not tune a fixture to exact wording from one model. Assert paths selected,
claims verified, unsafe actions avoided, files changed, tests passed, and
whether Capture occurred.

The migration probes cover every supported v1 knowledge category in one
complete fixture, plus malformed input, CRLF, special paths, interrupted apply,
input changes, repeated prepare/apply/rollback, host registrations with missing
or corrupt manifests, and full pre-migration versus post-rollback project
snapshots. A separate migration semantic corpus requires explicit disposition
of user-owned rules and Hooks, duplicate-authority consolidation, and applied-
state review. Empty or partial v1 installations are not release claims until
separate executable cases are added. Adapter probes preserve unrelated config,
exercise feature downgrade, and verify that remove deletes only entries owned
by Self-Evolution.

Never place credentials, internal repositories, real infrastructure addresses,
or private operational data in a fixture.

The contract tests and every `run.mjs` mode materialize all 13 fixture setups
and run each declared verifier. `run.mjs` also validates the contracts and records a SHA-256 over
the canonical `fixture.json` plus its README. A setup or rubric edit therefore
makes `--verify` stale until `--record` is intentionally reviewed. Some fixtures
also have executable CLI probes. A fixture whose core judgment requires a model
or blinded reviewer remains pending until its run records are added; metadata
completeness alone is never scored as task success.
