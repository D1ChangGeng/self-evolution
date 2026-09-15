# Public engineering results

Status: `public-engineering-scope-passed`; standard full-matrix effect gate remains `pending`.

The primary source is SWE-bench Verified at frozen revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`. Execution uses Codex CLI 0.152.1, model `gpt-5.6-terra`, provider alias `zeo-dev`, and SWE-bench v4.1.0 evaluator commit `726c5461e2ef52d83cf1ea2107870a8bb3328d57`.

## Measured pilot

SymPy `sympy__sympy-15017` ran once for B0, B4 and B5. Each used two fresh Codex processes with isolated task workspaces, network-disabled task containers, dropped capabilities, no Docker socket, and a coordinator-only inference gateway. All three attempts passed evidence integrity validation, but official FAIL_TO_PASS was 0/1 and PASS_TO_PASS was 14/14 for each arm; `resolved=false`.

Pytest `pytest-dev__pytest-10081` completed one B0/B4/B5 repetition. All three official evaluations resolved successfully with FAIL_TO_PASS 1/1 and PASS_TO_PASS 63/63.

These six attempts are a measured pilot, not the required release matrix. The initial B5 run lacked the container command-host binary; that infrastructure failure and its single permitted retry remain recorded.

## Limits

Official gold preflight passed for six selected SWE-bench tasks plus the SymPy task above. `requests-5414` is environment-blocked because required public test dependencies are absent and daemon network behavior changes the expected timeout. The remaining task queue and receipts are recorded in the private runtime.

SWE-ContextBench source pairs are frozen in `CONTINUITY-SOURCES.md`, but its experience image is not published in the author's registry, so provision is blocked. No pre-generated trajectory or gold patch is used.

This pilot does not establish broad engineering effectiveness, architecture correctness, permission safety, or cross-harness continuity. Architecture and permission outcomes are reported only from bound sandbox probes and workspace snapshots. LongMemEval remains auxiliary diagnostic evidence.

Attempts where the provider returned a capacity error before any model response
are classified as infrastructure or model availability failures. They remain in
campaign denominators and are not converted into empty patch task results.

## Release interpretation

The bounded `public-engineering` profile returns `release_ready=true` for the declared pytest task triplet after hash-bound official evidence and review. The standard full-matrix profile remains `release_ready=false` until its larger paired repetitions, controls and continuity evidence are complete.
