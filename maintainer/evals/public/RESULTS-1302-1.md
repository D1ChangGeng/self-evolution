# 1302-1 public evaluation receipt

Date: 2026-09-13 (Asia/Shanghai)

Host: `1302-1` (`yue-Precision-3680`), Ubuntu 24.04

Release subject: `skills/self-evolution/` plus its bundled CLI, SHA-256
`315cb30f1bf7dbb0446a8ab5436764dbfb0ff830e5b95762b8300306b225f952`

Baseline: commit `c998067f73620a4721367e33a31063882896d476`, subject SHA-256
`d98caca0c6992ebc80035cf812a3df216cfd887c9c8baf1646d1757d6be634e7`

## Measured release evidence

Three paired attempts (`public-20260912-10`, `-11`, and `-12`) completed on
1302-1. The bundle contains 17,215 files. Its archive SHA-256 and all
referenced artifact SHA-256 values were verified before the evaluator derived
one majority verdict per question.
The candidate and baseline used the same data, model alias, prompt contract,
context budget, and evaluator within each benchmark. Cleaned predictions for
both arms were regenerated after the preference-question prompt correction;
V2 baseline predictions were reused only under the unchanged V2 protocol and
verified subject, prediction, and trace hashes.

| Benchmark and tier              | Questions | Baseline | Candidate |   Difference | Core gate |
| ------------------------------- | --------: | -------: | --------: | -----------: | --------- |
| LongMemEval cleaned, full       |       500 |   88.20% |    90.80% | +2.60 points | pass      |
| LongMemEval-V2, small haystacks |       451 |    9.31% |     7.32% | -2.00 points | pass      |

The V2 difference is `-0.0199556541`, narrowly inside the declared 2-point
overall regression limit. Its worst ability difference is `-0.0348837209`,
inside the 7-point core ability limit. Cleaned has no negative ability
difference. Candidate/baseline p95 request-latency ratios are `1.096` for
cleaned and `0.534` for V2; selected-context byte ratios are both `1.000`.
Latency covers endpoint requests and in-request retries; it excludes the
runner semaphore queue. These figures describe this fixed adapter and model
endpoint, not end-to-end harness task speed.

The six read-only engineering tasks in campaign
`public-20260913-engineering-v2` all exited `0`, passed fixed checks and
separate model review, and kept declared task files byte-identical. They cover
Codex routing and bounded-evidence behavior, Claude Code stale-source and
authority boundaries, and OpenCode Capture abstention and task continuity.
The aggregate validator returned `evaluation=pass` and `engineering=pass`.

## Reproduction contract

- Cleaned data revision:
  `98d7416c24c778c2fee6e6f3006e7a073259d48f`; combined data SHA-256:
  `0d3377e0f4481fac80abbc1c09b1a6fc10a0983a488786f760464b59905bc1dd`.
- V2 repository commit:
  `2cc8c540bdb87fe6761629b585e727e1c4704520`; data revision:
  `f152293e235517d504809563c833d7190b8c713b`; combined data SHA-256:
  `9963ed1aa353b28a3f6f243295c7b9418c9772feb0a56d81d0b64d99f08162e4`.
- Runner: Python 3.11.14, `httpx` 0.28.1, `self-evolution-public-runner/1`;
  frozen `run_campaign.py` SHA-256:
  `f88373ead58900a8253d420d3557ffa716e04f366b0bc5ff2b1bf1e47a78f5ed`.
  Judge revision: `self-evolution-public-judge/4`; paired neutral A/B judge
  calls use the pinned LongMemEval-compatible rubric.
- Model endpoint alias: `gpt-5.6-sol`, recorded revision
  `provider-alias-observed-2026-09-11`, temperature `0`, low reasoning.
  The provider exposed no immutable model fingerprint and repeated seed probes
  varied, so three complete paired attempts and per-question majority were
  required. The model revision is an observed alias, not a pinned model build.
- Prompt SHA-256: cleaned
  `dc9baee702742aadbf82daff7c3a94c740ca189fa17a7b2fd15f6698e27e1521`;
  V2 `cae2fd7439c64144353568ed0635adb6b3817a5317fef0e4cf9e20be6b9e256e`.
  V2 selected at most 12 trajectories and 10 states with a 40,000-character
  context budget. Each protocol, question manifest, prediction, judge, trace,
  execution, review, and raw engineering receipt is included in the bundle.
- Bundle: `evidence.bundle.tar.gz`, SHA-256
  `3b95f0a23a3342e60a435a33a78eaffc454019f1cf9e96062c62945c4c4a75e0`.
  Its `evidence.bundle.json` manifest and relative artifact paths let
  `node maintainer/evals/run.mjs --release --profile=standard --change-class=core`
  recompute the gate offline. The complete campaign, cache, upstream snapshot,
  logs, and executable environment remain under the 1302-1 benchmark root.

## Scope and limitations

LongMemEval cleaned measures conversation facts, updates, temporal reasoning,
and preference use. V2 small adds web and enterprise trajectory questions, but
this adapter uses bounded lexical trajectory selection and text state evidence;
it does not execute the upstream screenshot-dependent CodexMemory backend.
The V2 absolute score is low and its candidate result sits close to the
overall tolerance boundary. Neither benchmark proves project-wiki authority,
source-change correction, permission handling, or full engineering task quality;
the six harness tasks and repository checks cover selected paths only.

Earlier five-question `no_retrieval` smoke runs and a timed-out CodexMemory
compatibility probe remain diagnostic, outside the formal score. Upstream
full screenshot validation still reported 14,317 missing screenshot paths;
the text-based small-tier adapter does not require those files. The V2 dataset
snapshot passed listed data-file checksums while its upstream `README.md`
checksum differed; no dataset file was modified. The private integrated
campaign remains `pending` under the optional private profile.

The 7-point ability limit was set before these final attempts after identifying
that the smallest official ability bucket makes one question worth more than
3 points. It tolerates at most two question differences in that bucket while
the 2-point overall limit prevents broad regression. Future releases should
recheck this policy on a new model snapshot or additional held-out tasks.
