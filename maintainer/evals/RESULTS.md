# Current v2 Evaluation Results

Artifact: `2.0.0-rc.1`
Bundle SHA-256: `6eccbda3da357dc9c4024f0bf338601c206f08bf021cc0d151390a40bc9e15ad`
Fixtures: 13/13
Release ready: **no**

| Gate                            | State   | Judge                       | Evidence                                                                                                                                                                              |
| ------------------------------- | ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skill-lines                     | pass    | program                     | 450 lines; maximum 450                                                                                                                                                                |
| initialized-file-count          | pass    | program                     | 7 -> 3 files (57.1% reduction)                                                                                                                                                        |
| initialization-protocol-tokens  | pending | program-plus-maintainer     | Exact, versioned tokenizer counts for the complete v1 and v2 onboarding protocols have not been recorded.                                                                             |
| metadata-writes                 | pending | program-plus-maintainer     | Integrated task transcripts are required to count task-time metadata writes.                                                                                                          |
| low-value-capture               | pending | program-plus-blinded-review | Three-run v1/v2 Capture judgments have not been recorded.                                                                                                                             |
| irrelevant-context              | pending | program-plus-blinded-review | Three-run selected-context records have not been recorded.                                                                                                                            |
| retrieval-and-task-quality      | pending | blinded-review              | Frozen v1 and v2 model runs plus blinded judgments are missing.                                                                                                                       |
| no-capture-write-free           | pending | program-plus-blinded-review | The fixture contract is executable, but three v1 and v2 routine-task runs must prove that the agent completes the task without writing project knowledge.                             |
| source-change-detection         | pass    | program                     | SOURCE_CHANGED emitted: true                                                                                                                                                          |
| wrong-knowledge-detection       | pending | model-plus-blinded-review   | The deterministic boundary probe confirms that kb check does not judge prose correctness; three integrated model runs must prove that wrong knowledge is detected and not acted upon. |
| high-risk-material-verification | pending | model-plus-blinded-review   | Migration safety is probed, but three integrated high-risk agent runs are not recorded.                                                                                               |
| migration-input-accounting      | pass    | program                     | Exact input-to-trace coverage: true; semantic review links valid: true; applied rule/Hook bytes match reviewed targets: true; changed and malformed inputs are refused before apply.  |
| migration-rollback-identity     | pass    | program                     | Complete pre-migration project snapshot restored: true; changed input and malformed v1 are refused                                                                                    |
| migration-semantic-preservation | pending | maintainer-review           | Applied-state traceability and semantic preservation require a reviewed migration corpus; rollback identity does not prove them.                                                      |
| cli-and-adapter-idempotency     | pass    | program                     | Repeated init/install/remove/prepare/apply/rollback operations are unchanged.                                                                                                         |
| default-adapters-off            | pass    | program                     | 0 active adapters and 0 optional payloads after init                                                                                                                                  |
| removed-v1-default-mechanisms   | pass    | program-plus-code-review    | Default v2 init contains AGENTS.md, settings.yaml, and index.yaml only; no hooks, rules, manifest, counters, or confidence state.                                                     |

## Interpretation

Deterministic probes establish artifact and safety facts only. Pending gates
require the frozen three-run v1/v2 task evidence and blinded judgments defined
in `README.md`; they are release blockers, not assumed passes.
