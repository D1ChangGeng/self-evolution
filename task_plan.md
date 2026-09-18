# Engineering upgrade plan

## Goal

Implement the owned offline engineering evaluation scope (SE-01/05/07,
evaluation-side SE-04/08): executable 24-episode contracts, protected
verifiers, six-arm preparation and subprocess/session orchestration, evidence
and cost derivation with tamper checks, L2/L3 paths, versioned policy/gates,
CI/docs, and bounded verification. Preserve coordinator-owned changes.

## Phases

1. [in_progress] Inspect current evaluator contracts, tests, and ownership.
2. [pending] Implement episode contracts, fixture/verifier support, and tests.
3. [pending] Implement six-arm runner, session transfer, isolation, evidence,
   tamper validation, and tests.
4. [pending] Add L2/L3 manifests, policy/version gates, package/CI/docs.
5. [pending] Run focused and repository checks, inspect allowlisted diff,
   commit owned files, and create a Git bundle.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `bwrap: setting up uid map: Permission denied` | prior wrapper | Thread recovered unwrapped; coordinator SSH path available. |
| patch expected pre-existing progress file | 1 | Create it as a new file. |
