# Engineering continuity evaluation

This maintainer-only harness executes 24 C01–C12 A/B scenarios with real code
patches and external Node assertion scripts. `setup`, initial verifier and action
rubric retain the existing fixture contract; scenario extensions supply concrete
session objectives, deterministic test-only patches and protected behavior,
regression and architecture checks. Permission and Capture outcomes derive from
full workspace differences. The C06 variants are three-session L3 refactors;
C01/C04/C07/C08/C10 include actual process continuation and predecessor work.

```text
npm run eval:engineering:test
node maintainer/evals/engineering/campaign.mjs offline .cache/my-new-campaign
node maintainer/evals/engineering/campaign.mjs report .cache/my-new-campaign
node maintainer/evals/engineering/campaign.mjs plan
node maintainer/evals/run.mjs --release --profile=continuity --change-class=core
```

Output roots must be new. A failed attempt is preserved, not overwritten or
resampled. Every session runs in a new process and project, with its actual Git
binary patch restored at the exact base. Receiver checks reject wrong identity,
branch, missing/altered bytes and private extra artifacts. `continuation/1`
fields are portable; each historical verification retains its applicable
revision and triggers rechecking. C11 launches actual competing CLI writers and
separate Git worktrees. Forced interruption is an actual terminated child;
compaction requests currently record a normal process-close/restart surrogate,
not a claim that a host's compaction lifecycle event fired.

B0 keeps project code/docs/ADRs and common safety rules; B1 adds minimal rules;
B2 stores the same supplied history as ordinary Markdown. B4 restores the
byte-frozen starting distribution from `baseline/current.json.gz`; B5 uses the
candidate. Each has isolated preparation and per-session HOME/cache. B3 requires
a real host-native mechanism and is unavailable by default. In `equal-information`
mode history facts are shared among memory arms; `end-to-end` mode injects no
history and requires A to produce whatever B consumes. Deterministic patches are
test input only; their effects do not establish model Capture quality.

The fake CLI is labeled `fake-cli-orchestration` / `fixture-synthetic`. Actual
Codex, Claude Code and OpenCode commands have separate adapters, probe versions
and help from native binaries, and require explicit authorized configuration.
No API call runs during default CI. Model diagnostics need a JSON configuration
with `authorized`, `profile: "diagnostic"`, `name`, absolute native `binary`,
`model`, and `budget.max_sessions`, `budget.session_timeout_ms`,
`budget.total_timeout_ms`. Credentials are environment names supplied by the
operator, never values in the configuration. The optional `subsequent_harnesses`
array chooses a different host CLI for the next session of the same task.

```text
node maintainer/evals/engineering/campaign.mjs model .cache/new-model-campaign authorized-config.json
```

Model diagnostics cannot satisfy formal engineering release gates: this runner
does not attest its own OS isolation, and the available remote host's namespace
probe failed. Keep real runs pending/blocked until the necessary capability and
budget exist. End-to-end elapsed time includes preparation, development and
verification; token/cache usage comes from available provider trace fields.
Unavailable prices, exploration counts and rework are `not-measured`. Reports
include all attempts, amortized successful-task cost and both-successful pairs.

L2 selects eight actual historical pairs across three repositories, with GitHub
commit, ancestry, distinct-patch and pinned license evidence in `l2-pairs.json`.
Selection is not execution. `l2.mjs` reuses the existing external task schema:

```text
node maintainer/evals/engineering/l2.mjs plan
node maintainer/evals/engineering/l2.mjs export qs-encoding-boundaries experience .cache/new-l2-adapter
```

Unadapted follow-ups remain explicitly identified; do not stack earlier patches
onto unrelated future bases. See [POLICY.md](POLICY.md) for predeclared thresholds,
raw evidence requirements and historical compatibility.
