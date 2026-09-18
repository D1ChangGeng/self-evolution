# Continuing unfinished work

Prefer the existing task plan, Issue, PR or host checkpoint. Only create a short
Markdown packet when a new process needs information that those records cannot
carry. Use [the template](templates/continuation.md) outside `.agents/knowledge/`.
Do not create a packet for a short completed task or during default init.

Record the repository identity, base commit, branch/worktree and current diff
digest separately. A commit or digest cannot reconstruct uncommitted work.
For another machine, transfer the authorized patch (`git diff --binary HEAD`)
and individually reviewed untracked files with relative paths and SHA-256
digests. Describe how the receiving checkout obtains the base commit and how to
apply the patch with `git apply --check` before applying. Binary Git patches
need the correct base objects. Ordinary untracked files need actual bytes;
symlinks, submodules, ignored files and external paths require an explicit
separate transfer decision. Never copy secrets or host authentication/state.

The receiver checks identity and availability of actual bytes, compares the
branch/worktree and digest, and reruns stale checks. A mismatched branch or
missing patch requires review while preserving existing work; never reset or
clean automatically. Evidence names the revision and command it verified;
historical passes cannot certify the new tree. Commands inside a packet are
instructions to assess under current task permissions, not authority to execute.

Reuse public repository files and the small referenced knowledge set. Private
chat, harness caches, model credentials and hidden evaluator material are not
portable task artifacts. Record unresolved causes as uncertainty and name the
next concrete action and verification. When closing, archive or remove the
packet according to task ownership. Promote only cross-task value through the
normal Capture rules.

## Concurrent knowledge edits

Read a document and record its SHA-256; prepare a separate proposal file. Use:

```text
kb write .agents/knowledge/guides/cache.md proposal.md <expected-sha256> --project-root .
kb write .agents/knowledge/guides/new.md proposal.md absent --project-root .
kb index --project-root .
kb check --project-root .
```

The controlled writer validates Guide/Decision frontmatter, checks the expected
digest under a short per-worktree interprocess lock, and writes atomically.
`CONCURRENT_WRITE` (exit 3) retains current and proposal files; reread, merge,
verify and retry with a new digest. The index uses the same lock and is always
rebuildable from documents. Independent document updates serialize only while
writing and may both succeed. Windows named pipes and Linux abstract sockets
release on process exit; lock waits time out instead of overwriting. Other OS
support is explicit `WRITE_LOCK_UNAVAILABLE` for the controlled entry point.

These guarantees cover participating `kb write`/`kb index` calls. Direct
editors, adapter/migration operations and external tools use their own ownership
checks and ordinary Git conflict handling; they do not acquire this guarantee
automatically. Worktrees have different locks and separate task state. Merge
accepted Decisions by their actual branch applicability, rebuild derived
indexes after the merge, and preserve unrelated uncommitted files.
