# 1302-1 public benchmark receipt

Date: 2026-09-10 (Asia/Shanghai)
Host: `1302-1` (`yue-Precision-3680`)
OS: Ubuntu 24.04, kernel `6.11.0-17-generic`

## Preparation completed

- SSH connectivity and host identity probe succeeded.
- Node.js `v18.19.1` and Python `3.12.3` are on the default PATH. The pinned
  Node.js `v24.11.1` runtime and Python `3.11.14` virtual environment are also
  available at `/home/changgeng/.nvm/versions/node/v24.11.1/bin/node` and
  `/home/changgeng/Alpha-agent/.venv/bin/python`.
- The official LongMemEval-V2 repository was cloned to `/tmp/longmemeval-v2`.
- Frozen repository commit: `2cc8c540bdb87fe6761629b585e727e1c4704520`.
- The official V2 dataset metadata was read through `https://hf-mirror.com`;
  its immutable dataset revision is `f152293e235517d504809563c833d7190b8c713b`.
- The pinned V2 dataset snapshot was completed under
  `/disk/djx/storage_for_changgeng/benchmarks/self-evolution-20260909/lme-v2`
  using `HF_ENDPOINT=https://hf-mirror.com`. The retry ran in tmux session
  `self-evolution-data`, exited `0`, and recorded its log, exit marker, and
  checksum report under the benchmark `logs/` directory. Both trajectory
  screenshot archives are present. The upstream checksum list passes for all
  listed files except `README.md`, whose downloaded SHA-256 is
  `c5de92eadfd8238802b476e446b05a766c312ab0f07518dbda434f914aa4df37` while
  the published list expects `bd0890407b11ea5e7f521f47f031823f58f77ac8c9e0b5837bb4cae9f6bc9837`;
  the data was not modified.
- An isolated Python `3.11.14` environment was created at
  `/disk/djx/storage_for_changgeng/benchmarks/self-evolution-20260909/venv`.
  Upstream requirements plus `httpx[socks]` were installed and imports for
  `data.public_data`, `evaluation.harness`, `evaluation.qa_eval_metrics`,
  `memory_modules.memory`, `memory_modules.no_retrieval`, and
  `memory_modules.codex` all passed. PyTorch was intentionally not installed.
- `data/prepare_data.py --mode symlink` materialized 984 enterprise trajectory
  directories. Full screenshot validation was not accepted because the web
  archive and enterprise patch set were not expanded into the complete
  `screenshots/` layout before the run was stopped; `validate_data.py --tier
small` reported 14,317 missing trajectory screenshots.
- The configured OpenAI-compatible endpoint was tested with a real
  `gpt-5.6-sol` chat and Responses requests. Both returned successfully with
  exact sentinel outputs. Credentials were read from the remote key file and
  were not printed.

## Execution status

Status: **blocked for the formal gate; modified-protocol smoke measured**.

The complete pinned V2 file snapshot and Python environment are present, but no
formal paired `longmemeval-v2/medium` campaign is claimed. The cleaned
500-question dataset was not materialized. The screenshot-dependent full data
validation was not completed, and the Codex memory backend did not produce its
required `memory_module_output.json` within a 240-second query timeout. These
are execution prerequisite blocks, not benchmark failures.

The following reader-only `no_retrieval` smoke runs did complete through the
upstream harness and the real `gpt-5.6-sol` endpoint. They use five selected
deterministic questions per domain from the V2 small haystack, so they are
**modified-protocol smoke evidence**, not official small-tier or release-gate
scores:

| Run        | Questions |                                                                     Result | Raw artifacts                                 |
| ---------- | --------: | -------------------------------------------------------------------------: | --------------------------------------------- |
| enterprise |         5 | overall accuracy `0.0`; 930 prompt tokens; 224 completion tokens; exit `0` | `run/no-retrieval-small-enterprise-5/output/` |
| web        |         5 | overall accuracy `0.2`; 985 prompt tokens; 252 completion tokens; exit `0` | `run/no-retrieval-small-web-5/output/`        |

The CodexMemory probe built a 100-trajectory workspace successfully, then its
single query timed out after 240 seconds with `status=missing_output_file`; the
upstream reader subsequently completed with an empty memory context. It is
retained as a failed compatibility probe and contributes no benchmark score.

## Bounded CodexMemory recovery probe

On 2026-09-10, one bounded diagnostic probe was run under the isolated root
`run/codex-skill-probe-20260910/`. The current distributed skill was copied to
`skill-snapshot/self-evolution/` without changing `/tmp/longmemeval-v2`, the
host Codex configuration, or any unrelated project. The snapshot contains 18
files; the recorded hashes are:

- `SKILL.md`: `ea35af4ef962b7b7eff63699d11dcda4f48602d387fbe5291d96bc8049e8dbab`
- bundled `kb.mjs`: `0b720b6a4a82b3f23dda70cfdafaf33c365201b564b63c208e18bef0954a95ad`

The final bounded attempt used only the single trajectory file
`1d56a4d6/trajectory.json`, restored the working Codex code-mode host settings,
closed stdin, and imposed a 150-second external timeout. Codex successfully
read `AGENTS.md`, the isolated self-evolution `SKILL.md`, and `question.json`,
then completed bounded inspection of the named trajectory and identified the
Incidents Filters menu state. It did not produce
`memory_module_output.json` before the timeout (`exit=124`). The raw receipt
and SHA-256 manifest remain at:

`run/codex-skill-probe-20260910/attempt-003/`

The probe is **diagnostic only** and contributes no benchmark score. Its input
question contained an accidental trailing quote and therefore is not a valid
official benchmark run. The stderr receipt also contains a host-side
`Failed to create unified exec process` event. This establishes that the skill
snapshot was read and the trajectory could be inspected, but the CodexMemory
output contract is still unresolved: a valid JSON memory output was not
written. A separate earlier retry with `code_mode_host=false` failed closed
with the expected host-disabled error and is not treated as evidence.

The formal CodexMemory compatibility status therefore remains **blocked**;
the bounded probe does not upgrade it to measured, comparable, or passing
evidence.

The benchmark root, virtual environment, logs, raw outputs, and SHA-256
manifests remain on 1302-1 for reproducibility. Relevant artifact hashes are
recorded in the task execution log; no credentials are included.

To unblock the formal gate, expand both screenshot archives into the complete
runtime layout, materialize the cleaned dataset or explicitly defer that
benchmark, resolve the CodexMemory subprocess output contract, and run paired
baseline/candidate campaigns with a fixed protocol and current subject digest.
Attach the raw outputs, `aggregated_metrics.json`, protocol, and SHA-256
manifest under an external campaign directory before making any regression or
release claim.

The public benchmark remains independent of `npm run eval`; deterministic and
fixture checks can continue to run without these external dependencies.
