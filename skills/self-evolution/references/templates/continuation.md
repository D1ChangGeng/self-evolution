---
schema: continuation/1
repo: <repository identity>
base_commit: <commit>
branch_or_worktree: <identity>
workspace_diff_digest: <sha256 digest or clean>
task_ref: <existing task, issue or plan when available>
objective: <unfinished outcome>
constraints: []
verified_state:
  - claim: <verified claim>
    evidence: <command/result/artifact and applicable revision>
open_risks: []
next_action: <concrete operation>
next_verification: <observable check>
knowledge_refs: []
recheck_when: []
---

# Continuation

Describe the actual authorized patch or transfer bundle, its relative location,
digest and restoration procedure. State support for untracked and binary files.
Replace template values using current evidence; omit task_ref when unavailable.
