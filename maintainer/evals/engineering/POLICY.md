# Engineering evaluation policy

Policy version: `engineering-policy/1.0.0`

## Change rationale

The earlier engineering episode file described scenarios but did not execute
them. This policy makes real code patches and five independent outcomes—the
requested function, prior regression, architecture, permission, and delivery
scope—the primary engineering result. Retrieval traces and prose remain process
diagnostics. LongMemEval remains a diagnostic benchmark and cannot substitute
for engineering outcomes.

## Evidence requirements

Each attempt binds the episode contract, fixture contract, evaluated subject,
arm, host executable version/hash when available, session receipts, workspace
snapshots, patch, tests, protected verifier version, and raw usage. Derived
costs come only from those raw receipts. Missing provider usage is
`not-measured`, never zero. Raw artifacts are hashed and sealed; changed bytes,
file sets, subject bindings, or protocol bindings invalidate the attempt.

Offline fixture runs are labeled `fixture-synthetic`. Fake or deterministic
drivers prove orchestration, state transfer, timeout/error handling, verifier
protection, and derivation only. They are not real-model performance evidence.
Unsupported filesystem/network sandboxing is `unavailable`; a worktree or
separate HOME alone is not a sandbox claim.

## Activation boundary

This policy applies to release candidates created after it is merged. It does
not relabel historical public smoke or integrated evidence. Core, lifecycle,
Capture, or handoff changes require fresh evidence bound to the current subject,
`engineering-episodes/2`, fixture hashes, and this policy. Missing real-model
or real-host results keep the engineering outcome gate `pending` or `blocked`.
The `continuity` release profile requires the engineering outcome gate and all
existing deterministic gates. `standard` and `private` preserve their historical
requirements and add engineering for core/routing changes. LongMemEval remains
visible diagnostic evidence in continuity; its failures still require analysis
and are not reclassified as passes. Historical reports remain hash-preserved.

Required real effects coverage is eight frozen core episodes, B0/B4/B5, three
paired attempts; B1/B2/B3 use the declared representative control slice. Missing
B3 capability leaves the profile blocked. Candidate episodes must meet every
function, regression, architecture, permission, scope and actual patch outcome.
Raw verifier exits, script bytes, snapshots and session traces are cross-bound.
The loader re-derives outcomes and provider usage; submitted aggregate values
are not evidence. Same-model/toolchain/budget pairing and per-tuple independent
review are required. Blinding and actor identity are maintainer-attested.
L0 safety, migration rollback, idempotency, three-file initialization, and
default-adapters-off gates remain required.

Paid campaigns require a predeclared model, endpoint, host, repetitions,
per-run tool/time/token limits, total budget, and explicit authorization. The
default offline CI never invokes a model endpoint.

The built-in model CLI path is diagnostic until an external execution boundary
can be validated. Developer execution does not establish Agent isolation.
A formal external receipt must use `real-harness-engineering` and
bind validated isolation; `fixture-synthetic` and `real-harness-diagnostic`
receipts cannot pass the release gate.

Release-candidate publication follows the separate policy in `../SPEC.md`.
It preserves stable readiness and all pending outcomes, and distributes the
candidate explicitly as a prerelease for evaluation.
