# Public engineering task selection

Status: `selected-provenance-verified-execution-not-tested`\nSelection date: 2026-09-15
Evidence class: public source and task metadata only. No model execution, submission, publication, or release-gate result is recorded here.

## Frozen public source

The task source is the public Hugging Face dataset `princeton-nlp/SWE-bench_Verified`, split `test`, 500 rows. The dataset API snapshot reports revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a` and `lastModified=2025-02-18T23:48:55Z`. Rows were downloaded through the public `datasets-server` API in five 100-row pages and retained under `.cache/public-benchmark-research/`.

The upstream SWE-bench repository README identifies Verified as a 500-problem subset confirmed solvable by software engineers, and documents the containerized evaluator and v5 CLI (`swebench eval verified ...`). The observed upstream `main` commit at research time was `02e7a74ffd0b707aab73d203fe87bdc7c76afc8e`; this is a source observation, not a claim that a future runner is immutable. SWE-bench code is MIT licensed. The task repositories are separate upstream projects; their public API license observations are retained in `.cache/public-benchmark-research/license-*.json`.

Snapshot hashes:

```text
.cache/public-benchmark-research/swe-bench-verified-rows-0-100.json      1c3850da017bd530532c42f80035df75ecc6ed7943e1494d0a5302c60d67ff3d
.cache/public-benchmark-research/swe-bench-verified-rows-100-200.json    ad2828da9a1a8ab3be3000672f287393ce83bc0102dc48be114e5e60ed0e18cb
.cache/public-benchmark-research/swe-bench-verified-rows-200-300.json    b0f1a84aa338d3ca7fdfc387d49435deb52dfa6cef00899b299cc5f7844a9370
.cache/public-benchmark-research/swe-bench-verified-rows-300-400.json    1e4db401e4969ddd52a497872be782d252fa5207c2988d3b139064f07222e28f
.cache/public-benchmark-research/swe-bench-verified-rows-400-500.json    a99ab0683594b82169e5a5531451f8cebddcbb6b6a0895654e7ed6e50ad80b0e
.cache/public-benchmark-research/hf-swe-bench-verified-api.json         cb1662e519eedd971afce5bcd370de05f9772be9f7319b6edb5f82471387d574
.cache/public-benchmark-research/swe-bench-README.md                    06841624d7b5130dfe3cc6714642e9a8fd2a608c95c66ae0180e409f12b73aaa
.cache/public-benchmark-research/swe-bench-LICENSE                    2bd2e08df7147f67a69b42c10efae09bd4bf119df397371036187d5dd1b02f57
```

## Official evaluator runtime

The evaluator uses an isolated task runtime. The evaluator checkout is fixed at SWE-bench `v4.1.0`, commit `726c5461e2ef52d83cf1ea2107870a8bb3328d57`; its task-local Python 3.10 virtual environment installs that checkout editable and reports package version `4.1.0`. This v4 line was selected over v5 because it natively implements the requested public remote-image and `python -m swebench.harness.run_evaluation` flow. It derives the exact remote key as:

```text
swebench/sweb.eval.x86_64.sympy_1776_sympy-15017:latest
```

from `namespace=swebench`, `arch=x86_64`, and the instance ID with double underscores replaced by `_1776_`. The isolated Docker 28.0.4 daemon pulled the image at immutable digest `sha256:6bf2b82cdba92ff0030985067ef0dc74880be2cde224ec10e6da443a21925cfb`; image ID `sha256:73950f4090b50a86e56d2bc99dabcd56e86bf25708f82a195fa0f507b616f3c1`, size 2,753,905,934 bytes, created `2026-08-13T03:57:31.502668155Z`.

When the image is available, retain `docker image inspect` output including image ID, immutable repo digest, size, and created timestamp. The evaluator's generated Python `eval.sh` activates the instance conda environment, resets only test files, applies the public `test_patch`, runs the official repository test command and directives, then resets the test files again. The agent-facing execution must not see the public gold patch, `test_patch`, evaluator logs, or other arms. The formal gold validation and any model patch evaluation must use the unchanged official image and generated evaluator scripts.

The image's `/testbed` HEAD is `5d920dd014d5b9b0cbd4c2567fd6d7f4bbde97cf`; its parent is the frozen task base `6810dee426943c1a2fe85b5002dd0d4cf2246a05`, and `git diff --stat <base> HEAD` is empty. The base environment Python is 3.11.5; the activated task environment reports Python 3.9.20. This is the expected evaluator environment-setup commit rather than evidence of a different source tree.

The official v4 preflight was run without a model: gold completed/resolved 1/1 in 18.26 seconds, and a separate empty-patch prediction submitted 1 instance but completed/resolved 0 with `empty_patches=1`. Raw reports, command logs, and SHA-256 receipts remain in the private task runtime. These are harness preflights only: v4 downloaded the then-current upstream dataset revision `78f471bf655a3137b2e8a75af1501690ec009ec3`, which differs from the frozen research snapshot. A formal campaign must point the evaluator at a sealed local dataset row before any result can be comparable to this selection.

The intended agent workspace can start from a separately reconstructed base-only `/testbed` Git history, with future objects removed. That protects task isolation but is an adapted execution workspace, not the official evaluator image. Keep the reconstruction receipt separate and use the untouched official image for final SWE-bench acceptance. Use explicit `--network none` for test execution; the official evaluator itself has no CLI switch for Docker network mode, so a run with that additional constraint is a locally adapted execution condition and must be labeled as such.

## Frozen eight

All eight rows are official Verified instances marked `<15 min fix`. The selected failing tests are taken from the public row metadata. `base_commit` and `environment_setup_commit` must be used exactly when materializing each task. The official SWE-bench evaluator remains the acceptance authority; no replacement hidden test is introduced.

| ID                         | Repository        | Base commit                                | Environment setup                          | Official failing test(s)                                                                 | Public issue shape                             |
| -------------------------- | ----------------- | ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `pytest-dev__pytest-10081` | pytest-dev/pytest | `da9a2b584eb7a6c7e924b2621ed0ddaeca0a7bea` | `572b5657d7ca557593418ce0319fabff88800c73` | `testing/test_unittest.py::test_pdb_teardown_skipped_for_classes[@unittest.skip]`        | skipped unittest teardown under `--pdb`        |
| `pytest-dev__pytest-5262`  | pytest-dev/pytest | `58e6a09db49f34886ff13f3b7520dd0bcd7063cd` | `693c3b7f61d4d32f8927a74f34ce8ac56d63958e` | `testing/test_capture.py::TestFDCapture::test_capfd_sys_stdout_mode`                     | captured stream mode advertises binary flag    |
| `psf__requests-1142`       | psf/requests      | `22623bd8c265b78b161542663ee980738441c307` | `ba25184ed5f0bf9b876dea3cf4312fa35b539a7c` | `test_requests.py::RequestsTestCase::test_no_content_length`                             | GET request content-length behavior            |
| `psf__requests-5414`       | psf/requests      | `39d0fdd9096f7dceccbc8f82e1eda7dd64717a8e` | `a1a6a549a0143d9b32717dbe3d75cd543ae5a4f6` | `tests/test_requests.py::TestRequests::test_invalid_url[InvalidURL-http://.example.com]` | invalid hostname error classification          |
| `sphinx-doc__sphinx-10323` | sphinx-doc/sphinx | `31eba1a76dd485dc633cae48227b46879eda5df4` | `60775ec4c4ea08509eee4b564cbf90f316021aff` | `tests/test_directive_code.py::test_LiteralIncludeReader_dedent_and_append_and_prepend`  | literalinclude indentation with prepend/append |
| `sphinx-doc__sphinx-8595`  | sphinx-doc/sphinx | `b19bce971e82f2497d67fdacdeca8db08ae0ba56` | `4f8cb861e3b29186b38248fe81e4944fd987fcce` | `tests/test_ext_autodoc_automodule.py::test_empty_all`                                   | autodoc handling of empty `__all__`            |
| `sympy__sympy-15017`       | sympy/sympy       | `6810dee426943c1a2fe85b5002dd0d4cf2246a05` | `e53e809176de9aa0fb62e85689f8cdb669d4cacb` | `test_ndim_array_initiation`                                                             | rank-zero array length                         |
| `sympy__sympy-15809`       | sympy/sympy       | `28d913d3cead6c5646307ffa6540b21d65059dfd` | `73b3f90093754c5ed1561bd885242330e3583004` | `test_Min`, `test_Max`                                                                   | zero-argument Min/Max semantics                |

The pool balances four small Python repositories and keeps every selected task in the public low-cost band. Flask has one Verified row (`pallets__flask-5014`); it is retained as an optional replacement, not counted in the frozen eight, because a one-row repository cannot provide a same-repository pair. No pair below is described as a natural evolution. Their bases are independent historical snapshots. A continuity extension may be added only after a public Git ancestry comparison proves the exact parent/child relation; non-contiguous rows must remain labeled distinct historical tasks.

## Planned execution and budget

The formal run is fixed to Codex with model family `gpt-5.6-terra` and the `zeo-dev` provider configuration selected by the operator. The public document intentionally records no host, endpoint, account, or credential.

The eight SWE-bench tasks are independent public patch-and-test evidence. They are not C01–C12 fixture episodes and cannot satisfy that synthetic catalog's formal coverage. Any future B0/B4/B5 comparison must use the same frozen public task, base commit, public test contract, model, harness, toolchain, and budget for all three arms. B1/B2/B3 must be a representative slice of real public tasks, selected and declared before execution; B3 remains unavailable unless its native-harness capability probe passes. The public SWE-bench task supplies the code patch and official regression tests. It supplies no architecture or permission rubric.

Predeclare before execution: 3 paired repetitions; maximum 3 sessions per attempt; 20 minutes per session; 60 minutes per attempt; 24 hours campaign wall-clock; fixed toolchain and prompt; no infrastructure retries after the first reproducible failure. Record provider usage when exposed; otherwise cost and token usage are `not-measured`. A budget envelope should be approved as `72 × 60 minutes` maximum execution time plus the nine control attempts, with actual usage derived only from receipts. No task may be retried by changing its base, test command, model, or toolchain.

## What the evidence can establish

For each task, a valid SWE-bench result must include the actual patch and the official evaluator's result that the public failing tests pass while the declared public regression tests remain passing. It supports “this frozen public issue was repaired under the declared harness and workspace policy.” It does not establish broad repository correctness, production safety, or general model capability.

Architecture evidence requires an independently declared public-task boundary and an auditable diff-based review; it is not established by SWE-bench's pass/fail grade alone. Permission evidence requires an execution trace and validated containment policy; it too is not inherited from a local synthetic scenario. The current runtime has an isolated Docker daemon. A bwrap run or separate HOME is still a distinct diagnostic boundary and cannot be labeled equivalent to the official Docker evaluator. LongMemEval may remain an auxiliary memory signal, but it cannot substitute for public patch/test evidence or separately measured architecture and permission evidence.

## Public sources

- [SWE-bench repository](https://github.com/SWE-bench/SWE-bench) — evaluator, Docker/v5 CLI documentation, MIT license.
- [SWE-bench Verified dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) — 500-row public task set and revision metadata.
- [SWE-bench Verified announcement](https://openai.com/index/introducing-swe-bench-verified/) — engineer-confirmed solvability scope.
- Repository license API snapshots: `.cache/public-benchmark-research/license-pytest-dev__pytest.json`, `license-psf__requests.json`, `license-sphinx-doc__sphinx.json`, `license-sympy__sympy.json`.
- Local engineering contract: `maintainer/evals/engineering/POLICY.md` and `policy.mjs`.
