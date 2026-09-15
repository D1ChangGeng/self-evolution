---
kind: guide
status: draft
scope:
  - "path/to/relevant/**"
use_when:
  - "performing a specific future task"
review_when:
  - "a material source or integration changes"
---

# Guide Title

## Purpose

Explain the future task this Guide improves.

## Important Constraints

Record only constraints that change implementation, verification, or risk decisions.

## How This Area Works

Explain the non-obvious model needed to act correctly. Point to primary sources.

## Known Failure Modes

Record trigger, applicable conditions, observed symptom, evidence, changed action
and recovery verification. Keep unconfirmed causes uncertain. Name when changed
conditions permit reconsideration; a past failure is not a permanent prohibition.

## Verification

Link the smallest current regression test, type/interface or dependency check
that enforces the lesson. State the command, expected behavior, applicable
revision and unchecked boundaries. Put executable constraints in code/tests;
keep reasons and navigation here. A historical pass needs a new run on a new tree.
