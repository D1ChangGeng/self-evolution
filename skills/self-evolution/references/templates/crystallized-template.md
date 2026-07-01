---
type: crystallized
confidence: observed
scope: []
sources: []
origin_sessions: []
first_extracted: {{DATE}}
last_refined: {{DATE}}
refinement_count: 1
skill_candidate: false
skill_path: null
---

# {{WORKFLOW_NAME}}

## Problem

Describe the recurring situation that triggers this workflow.

## Prerequisites

List what must already be true before starting.

- 

## Workflow

### Step 1: {{Action}}

{{STEP_DESCRIPTION}}

**Decision point**: If X, go to Step 2a. If Y, go to Step 2b.

### Step 2a: {{Action}}

Describe the path taken when the first condition is true.

### Step 2b: {{Action}}

Describe the path taken when the second condition is true.

### Step 3: {{Action}}

Describe how the workflow converges and how to verify progress before continuing.

## When to Apply

List the signals that indicate this workflow is appropriate.

- 

## When NOT to Apply

List the exclusion conditions that would make this workflow unsafe, wasteful, or misleading.

- 

## Edge Cases

Document the situations that commonly break the default flow.

- 

## Quality Checklist

- [ ] Prerequisites were checked before starting.
- [ ] Each decision point has a clear branching rule.
- [ ] Outputs are concrete and reviewable.
- [ ] Verification steps are executable.
- [ ] Failure and recovery paths are documented.

## Refinement Log

### v1 — {{DATE}}

Initial extraction from {{source}}

## Skill Readiness Assessment

- [ ] Tested in 3 or more distinct contexts.
- [ ] Edge cases are documented.
- [ ] Decision points are concrete.
- [ ] Prerequisites are enumerable.
- [ ] Output can be verified objectively.
