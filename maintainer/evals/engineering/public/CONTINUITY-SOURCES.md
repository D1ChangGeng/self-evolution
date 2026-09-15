# Public continuity sources

Status: `frozen-public-source-pairs-not-executed`

Research date: 2026-09-15. This document records public benchmark provenance and two low-cost task pairs. It does not report model performance. The experience task must be solved afresh by the evaluated Codex run; the packaged `Lite Past Experience/*.jsonl` trajectories are not used as the project's memory.

## Primary source: SWE-ContextBench

SWE-ContextBench is the only examined public source with an explicit machine-readable prior-task to related-later-task mapping. The public dataset is [jiayuanz3/SWEContextBench](https://huggingface.co/datasets/jiayuanz3/SWEContextBench), revision `5bec275a2095768a53ac804ae4fdf90b1723b8af`. The paper is [arXiv:2602.08316](https://arxiv.org/abs/2602.08316). The evaluator source is [jiayuanz3/SWEContextBench](https://github.com/jiayuanz3/SWEContextBench), observed main commit `31bb04155f52b184bf31b220e3cff0607ac9c953`.

The HF dataset exposes 2,251 rows: 1,100 `Experience`, 376 `Related`, and the corresponding relationship records (the Lite task files are a 300-row experience pool and 99 related rows). `SWEContextBench_Relationship.parquet` has the fields `related_instance_id`, related issue/PR URL, `experience_instance_id`, and experience issue/PR URL. The task rows retain SWE-bench fields: repository, base commit, environment setup commit, issue statement, gold patch, test patch, `FAIL_TO_PASS`, and `PASS_TO_PASS`. The relationship is therefore grounded in real GitHub issue/PR references; it is not a synthetic injected task.

License evidence is split deliberately. The HF dataset card declares `MIT`; the paper is CC BY 4.0; GitHub reports no detected license for the evaluator repository and its tree has no `LICENSE`. Every underlying repository/task remains subject to its own upstream license. The two selected repositories below are public Python projects; Astropy reports BSD-3-Clause through the GitHub API, and SymPy publishes a `LICENSE` file (GitHub API SPDX detection is `NOASSERTION`).

## Frozen low-cost pairs

These are source-frozen pairs, not claims of natural project evolution. The relationship table is the authority for the edge; the independent repository compare is retained as additional chronology evidence.

### Pair A — Astropy mask propagation to collapse masks

| role       | instance                 | repo              | base commit                                | environment setup                          | version | created    | official failing test                                                                                                             |
| ---------- | ------------------------ | ----------------- | ------------------------------------------ | ------------------------------------------ | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| experience | `astropy__astropy-14995` | `astropy/astropy` | `b16c7d12ccbc7b2d20364b89fb44285bcbfede54` | `362f6df12abf9bd769d4915fabf955c993ea22cf` | 5.2     | 2023-06-27 | `astropy/nddata/mixins/tests/test_ndarithmetic.py::test_nddata_bitmask_arithmetic`                                                |
| related    | `astropy__astropy-15082` | `astropy/astropy` | `c5e2521db013d9641999be9c79d1d807741bc39a` | `c5e2521db013d9641999be9c79d1d807741bc39a` | 5.3.2   | 2023-07-21 | `astropy/nddata/mixins/tests/test_ndarithmetic.py::test_collapse_masks[0-mask_sum0-Jy]`, `[1-mask_sum1-None]`, `[2-mask_sum2-Jy]` |

Relationship: [PR #14995](https://github.com/astropy/astropy/pull/14995), issue #14978 → [PR #15082](https://github.com/astropy/astropy/pull/15082), issue #15082. GitHub compare reports the related base is 91 commits ahead of the experience base (`b16c7d1...` → `c5e2521...`). The pair is small enough for a first run (experience patch 16 lines; related patch 34 lines) and both tasks exercise the same NDData mask subsystem. Astropy's upstream license is BSD-3-Clause.

### Pair B — SymPy sign/absolute-value reasoning to simplification

| role       | instance             | repo          | base commit                                | environment setup                          | version | created    | official failing test                                     |
| ---------- | -------------------- | ------------- | ------------------------------------------ | ------------------------------------------ | ------- | ---------- | --------------------------------------------------------- |
| experience | `sympy__sympy-19487` | `sympy/sympy` | `25fbcce5b1a4c7e3956e6062930f4a44ce95a632` | `cffd4e0f86fefd4802349a9f9b19ed70934ea354` | 1.7     | 2020-06-04 | `test_sign`                                               |
| related    | `sympy__sympy-19484` | `sympy/sympy` | `4fa55af041c632f522e622de4b175f03927a7f95` | `4fa55af041c632f522e622de4b175f03927a7f95` | 1.7     | 2020-06-19 | `sympy/simplify/tests/test_simplify.py::test_issue_19484` |

Relationship: [PR #19487](https://github.com/sympy/sympy/pull/19487), issue #19277 → [PR #19596](https://github.com/sympy/sympy/pull/19596), issue #19484. GitHub compare reports the related base is 491 commits ahead of the experience base. The experience patch is 13 lines and the related patch 34 lines; both concern `sign`, `Abs`, and symbolic simplification. SymPy's repository publishes a `LICENSE` file; GitHub's license detector returns `NOASSERTION`, so retain the upstream license text in any redistribution audit rather than asserting an SPDX identifier.

## Fresh-run protocol

1. Materialize the experience row at its exact `base_commit` and `environment_setup_commit`; run the official failing test and the declared `PASS_TO_PASS` set through the benchmark harness. Codex writes only its own compact continuity record after the experience attempt (issue summary, diagnosis, changed paths, tests and exits, patch hash, base commit, and verifier receipt).
2. Materialize the related row independently at its exact base and setup commits. In the treatment arm, provide only the Codex-generated record from step 1; in the control arm, provide no prior record. Do not copy the benchmark's packaged trajectories or gold patch into either arm.
3. Apply the Codex patch and invoke the author-provided verifier. Preserve raw logs, patch bytes, task IDs, relationship row, image digest, and test exits. A result is valid only if the related `FAIL_TO_PASS` tests pass and the declared `PASS_TO_PASS` tests remain passing.

The author-provided evaluator is `swebench_memory.harness.run_evaluation` via `evaluation.sh`. For a prepared predictions directory, the direct command is:

```bash
export PATH=<EVAL_RUNTIME>/toolchain/docker:$PATH
export DOCKER_HOST=unix://<EVAL_RUNTIME>/docker.sock
cd /path/to/jiayuanz3/SWEContextBench
./evaluation.sh continuity-a full predictions
```

The script combines JSON instance rows and predictions, pulls `jiayuanz3/swecontextbench:<instance-tag>` images, applies the model patch and official test patch, and checks `FAIL_TO_PASS`/`PASS_TO_PASS`. For the frozen pairs, the expected image tags follow the evaluator's implementation: `jiayuanz3/swecontextbench:astropy.astropy-15082` and `jiayuanz3/swecontextbench:sympy.sympy-19484` for related-task evaluation. Manifest inspection succeeded for both tags through the validated Docker socket. Experience-task images use the analogous instance tag; if an experience tag is unavailable, the run is blocked rather than silently rebuilt with a different task environment.

The evaluator code uses Docker containers and may perform dependency/image preparation. Its acceptance authority is the SWE-ContextBench evaluator for these rows; this does not establish Docker equivalence for the project's separate architecture/permission harness. Architecture, write authorization, scope confinement, and OS isolation remain separate evidence dimensions and are not supplied by this public benchmark.

## Limits and rejected substitutes

SWE-Bench Pro (Scale AI, MIT) supplies real long-horizon issue-to-patch tasks and a Docker verifier, but no public experience-to-related relation table or ordered continuity protocol. SWE-rebench-v2 (MIT) supplies real issue/PR tasks, image builders, and log-parser evaluation, but no explicit prior-to-later relation. Exact public implementations for `SWE-Mem`/`SWE-MeM` and `SWE-Bench-SR` were not verified. `SWE-Explore` measures repository exploration/localization, not prior-task reuse. None of these can replace SWE-ContextBench for continuity evidence.

## Cached source material

All source snapshots and selected rows are under `.cache/public-continuity-research/`:

- `SWEContextBench_Relationship.parquet` — SHA-256 `4BCBE81657A58AD3349AE97C8FF836ED154D3E30D98DE2207B1BC5309843CE93`
- `SWEContextBench_Related_Lite.parquet` — SHA-256 `1930B392F7BEB17A0D87C2E79D1EB889AF2C5996B23A003386651BA64A68B8F3`
- `SWEContextBench_Lite_Experience.parquet` — public HF file, 300 rows
- `selected-pairs-full.jsonl` — complete frozen pair rows, including patches/tests and relation URLs
- `lite-pairs-with-experience.jsonl` — all 116 Lite rows with an available experience row
- `swe-contextbench-hf-api.json`, `swe-contextbench-datasets-server-info.json`, `swe-contextbench-repo-README.md`, `swe-contextbench-evaluation.sh`, and `swe-contextbench-swebench_memory_harness_run_evaluation.py`
