# Failure Cases

Failure cases are the primary input to Self-Evolution design changes. Record an
observable mismatch between expected and actual behavior, not a feature wish or
a count of similar suggestions.

## Workflow

1. Copy `failure-cases/examples/FC-000-example.yaml` to the next stable ID.
2. Add task evidence that another maintainer can inspect or replay.
3. Separate the observed behavior from the proposed explanation.
4. Link a proposal only after the root cause is supported.
5. Add or update an eval fixture before accepting a behavior change.
6. Close the case with the release or commit that proves the regression is
   covered; retain rejected cases with a rejection reason.

Severity follows impact rather than frequency:

| Severity | Meaning |
|---|---|
| Critical | Data loss, unsafe migration, secret exposure, or consistently harmful guidance |
| High | Wrong task action, missed material constraint, or unrecoverable retrieval failure |
| Medium | Meaningful context waste, avoidable maintenance, or recoverable wrong routing |
| Low | Local friction with no observed task-quality effect |

One evidenced Critical or High failure can justify work. Repetition alone does
not make a low-value suggestion admissible.

The machine-readable schema is `failure-cases/schema.yaml`; the example is
deliberately synthetic and must not be treated as an open product defect.
