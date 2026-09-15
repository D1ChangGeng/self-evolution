# Public engineering campaign

Policy version: public-engineering/1
Recorded before the first public-task model execution.

## Purpose and population

The eight task IDs in ../PUBLIC-TASK-SELECTION.md are the primary public
engineering sample. The source is SWE-bench Verified at dataset revision
c104f840cc67f8b6eec6f759ebc8b2693d585d4a. The ordinary SWE-bench issue and base
source remain unchanged. This is a selected-subset experiment, not a leaderboard
submission or an estimate for the full 500-task population.

Synthetic C01-C12 scenarios remain L0 implementation and orchestration tests.
They supply no task content, hidden tests, or scores to this public campaign.
Historical LongMemEval results remain auxiliary diagnostics.

## Arms and sessions

B0: normal repository, existing source/docs/tests/Git and common constraints.
B1: B0 plus minimal project instructions about inspection and verification.
B2: B1 plus an optional ordinary Markdown note, produced by the executing agent.
B3: native Codex memory, only if the real CLI discovery/consumption probe works.
B4: the frozen starting self-evolution Skill.
B5: the candidate self-evolution Skill, hash frozen before task execution.

The core schedule is 8 public tasks x B0/B4/B5 x 3 repetitions: 72 attempts.
The first repetition is the diagnostic prefix of that schedule. Its failures
remain included. Controls B1/B2/B3 use pytest-5262, requests-5414 and sympy-15017.
Unsupported B3 is recorded unavailable and cannot satisfy a required native
control. Subject, task, prompt, toolchain, and budget changes create a new
campaign identity; they cannot relabel completed attempts.

Every attempt has two fresh Codex processes. A receives the public issue,
investigates and implements a patch. B receives the same issue and continues
from A's exact file state with an explicit instruction to review and verify
the unfinished engineering result. It receives no chat, hidden tests, oracle
patch, scores, private session cache or other arm's state. B4/B5 may carry
their own repository knowledge and continuation packet; B2 may carry its note.
B0/B1 carry ordinary project source/test/documentation changes. No history facts
are manually supplied to any arm.

These sessions measure restart/review continuity on one public task. They do
not by themselves establish transfer across different issues or counterfactual
policy evolution. A full solution in A remains a completed predecessor result;
do not describe a review-only B as new feature development.

## Inputs and assurance

Only problem_statement is extracted into the task prompt. Base source and
ordinary tests come from the official instance image. Git is materialized as
the exact base snapshot, with no remote or future objects. Input hashes retain
the upstream base identity and the local snapshot identity separately.

The agent uses the official instance environment in a container with no
network, dropped capabilities, no Docker socket, a read-only root, writable
task/home mounts and tmpfs. The only inference route is a task-specific Unix
socket gateway allowing the fixed model and Responses path. Credentials and
provider endpoint configuration remain outside the container. The gateway
records raw requests/responses and enforces request and time limits.

Before inference, a real sandbox probe checks allowed writes, forbidden
coordinator/other-arm reads, root writes, external sockets and mounted inference
transport. Snapshots and Docker differences corroborate tool-event traces.
This is namespace/mount/network isolation, not a complete syscall audit.

Gold and no-op preflight use the pinned official evaluator and test patches,
after the inference workspace has been separated. Protected evaluation runs
only after both model sessions end. Test results never enter a retry prompt.

## Limits and failure handling

Fixed inference model: gpt-5.6-terra. Fixed provider configuration: zeo-dev.
Codex CLI: 0.152.1. Reasoning effort: medium. No hosted web/image tools,
subagents, global memory, global plugins, or user configuration are inherited.

Each session: 300 seconds, 48 inference requests, at most 500000 reported input
tokens and 16000 reported output tokens. Limits apply when usage is observable;
the request/time bounds are always enforced. Each attempt: two sessions, at most
600 seconds model wall time. Campaign: at most 81 attempts, 24 hours total wall
time, 12 million reported input tokens and 500000 output tokens. Stop dispatch
when any aggregate limit is reached; unfinished coverage remains pending.
Prices and immutable upstream model revision are unavailable, not estimated.

One infrastructure retry is allowed only before any valid model-generated
patch exists and only for a demonstrated transport/container startup failure.
Preserve the original failure and its cost. A timeout, rejected model request,
wrong patch, official test failure or knowledge error is a recorded outcome;
it cannot be repaired using protected feedback and resubmitted as the same
attempt.

## Outcomes and interpretation

Report separately: patch presence; official FAIL_TO_PASS and PASS_TO_PASS;
public repository architecture/interface review; confined write/permission
outcome; delivery scope; continuation artifacts and actual read traces.
A missing official regression set is not a passing regression measurement.
Architecture review uses the upstream issue, base source and actual patch;
locally authored tests cannot replace an upstream acceptance check.

Every unit binds public data, image digest, evaluator commit, subject digest,
prompt, session PID/container ID, input/output snapshots, patch and usage.
Totals derive from hashed receipts, not model self-evaluation. All attempts
and failures remain in denominators. Report paired B4/B5 success differences,
both-successful costs, amortized costs, and task/repository clustering.
Repeated attempts are not independent tasks. This small sample supports
regression discovery and bounded release claims, not stable superiority.

A release record must distinguish L0 implementation, actual public task
results, native/cross-harness capability and unresolved continuity coverage.
No required evidence may be changed from missing or failed to passing.
