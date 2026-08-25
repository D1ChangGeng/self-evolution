# Current v2 Evaluation Results

Artifact: `2.0.0-rc.1`
Bundle SHA-256: `0b720b6a4a82b3f23dda70cfdafaf33c365201b564b63c208e18bef0954a95ad`
Fixtures: 13/13
Release ready: **no**

| Gate                            | State   | Judge                       | Evidence                                                                                                                                        |
| ------------------------------- | ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| skill-lines                     | pass    | program                     | 435 lines; maximum 450                                                                                                                          |
| initialized-file-count          | pass    | program                     | 7 -> 3 files (57.1% reduction)                                                                                                                  |
| initialization-protocol-tokens  | pending | program-plus-maintainer     | This gate requires exact, versioned tokenizer counts for both onboarding protocols.                                                             |
| metadata-writes                 | pending | program-plus-maintainer     | This gate requires integrated task transcripts with task-time metadata writes.                                                                  |
| low-value-capture               | pending | program-plus-blinded-review | Three paired Capture judgments are required for this gate.                                                                                      |
| irrelevant-context              | pending | program-plus-blinded-review | This gate requires selected-context records for three paired attempts.                                                                          |
| retrieval-and-task-quality      | pending | blinded-review              | This gate requires frozen v1/v2 model runs with blinded judgments.                                                                              |
| no-capture-write-free           | pending | program-plus-blinded-review | This gate requires three paired routine-task runs whose workspace traces contain no project-knowledge writes.                                   |
| source-change-detection         | pass    | program                     | SOURCE_CHANGED emitted: true                                                                                                                    |
| wrong-knowledge-detection       | pending | model-plus-blinded-review   | The deterministic boundary probe covers CLI semantics; three integrated model runs provide the wrong-knowledge judgment.                        |
| high-risk-material-verification | pending | model-plus-blinded-review   | This gate requires three integrated high-risk agent runs with material-claim verification.                                                      |
| migration-input-accounting      | pass    | program                     | Input-to-trace coverage: true; semantic review links: true; applied rule/Hook bytes match reviewed targets: true; apply input validation: true. |
| migration-rollback-identity     | pass    | program                     | Pre-migration project snapshot restored: true; input-integrity checks: true                                                                     |
| migration-semantic-preservation | pending | maintainer-review           | This gate requires a reviewed migration corpus covering applied-state traceability and semantic preservation.                                   |
| cli-and-adapter-idempotency     | pass    | program                     | Repeated init/install/remove/prepare/apply/rollback operations preserve their configured state.                                                 |
| default-adapters-off            | pass    | program                     | 0 active adapters and 0 optional payloads after init                                                                                            |
| removed-v1-default-mechanisms   | pass    | program-plus-code-review    | Default v2 init contains the three-file contract: AGENTS.md, settings.yaml, and index.yaml.                                                     |

## Interpretation

Deterministic probes establish artifact and safety facts. Outcome gates
use the frozen three-run v1/v2 task evidence and blinded judgments defined
in `README.md`; each gate advances when its evidence is complete.
