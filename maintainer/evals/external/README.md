# External real-task comparison

This harness runs the external v1/v2 pilot described by the maintainer plan.
It is deliberately separate from `evidence/integrated-gates.json`: external
results do not change the release gate or `release_ready`.

## Commands

```text
npm run eval:external -- prepare
npm run eval:external -- run
npm run eval:external -- review
npm run eval:external -- verify
npm run eval:external -- report
```

Use `--campaign <id>` to select a campaign and `--output <absolute-dir>` to
override the default coordinator root
`D:\Chatgpt\self-evolution-campaigns\external`. Set
`SELF_EVOLUTION_EXTERNAL_EXECUTION_ROOT` (or pass the harness execution-root
option) to place Agent-visible workspaces under a different absolute root; the
default is `D:\Chatgpt\self-evolution-execution`. `run` and `review` also
accept `--task`, `--attempt`, and `--arm` filters. `run`, `review`, `verify`,
and `report` require an explicit `--campaign`; implicit selection of the latest
directory is disabled so an obsolete formal campaign cannot be resumed by
accident. Completed phases are not rerun.

Campaign ids must be safe single directory names beginning with `external-`;
path separators and parent-directory traversal are rejected.

`prepare` freezes both subjects, creates opaque arms and a sealed mapping,
materializes each base and oracle commit without upstream history, freezes
lockfiles, and refuses to start a campaign until every preflight contract
passes. After `preflight.json` records the command output and result, the four
preflight workspaces discard only their installed `node_modules`; source,
lockfiles, hidden-test copies, and command evidence remain available for audit.
Model execution is intentionally a separate step.

## Coordinator evidence and execution trees

The harness uses two physically separate trees:

- The coordinator evidence tree contains `campaign.json`, task contracts,
  prepared bases and oracles, sealed mappings, frozen subjects, raw evidence,
  blind bundles, verdicts, checksums, and reports.
- The external execution tree contains only the smoke, unit, and review
  workspaces needed by model processes.

The two roots must be absolute and neither may be the other root or an
ancestor of it. `campaign.json` binds both as `campaign_root` and
`execution_root`, binds the source checkout as `repository_root_sha256`, and
the mutable state repeats all three values. A resume, run, review, verify, or
report operation fails if any binding drifts. The repository digest excludes
only `.git` and `node_modules`; it prevents a later command from silently
evaluating a different harness or subject tree.

## Evidence layout

Coordinator evidence is stored as:

```text
campaign.json
schedule.json
state.json
sealed/arm-mapping.json
subjects/
prepared/
bindings/
smoke/smoke.json
smoke/environment.json
runs/<task>/<attempt>/<opaque-arm>/
blind/<task>/<attempt>/
summary.json
report.zh-CN.md
SHA256SUMS
```

Agent-visible workspaces are stored outside that tree as:

```text
<execution-root>/<campaign-id>/smoke/workspace/
<execution-root>/<campaign-id>/units/<task>/<attempt>/<opaque-arm>/
<execution-root>/<campaign-id>/reviews/<task>/<attempt>/
```

The sealed mapping must not be given to the reviewer. Blind bundles are checked
for literal version and subject-path leaks before review.

## Execution-assurance boundary

Formal OpenCode launches run through the Codex `external-opencode` profile and
the `windows-restricted-token` contract. A reversible Windows ACL lease adds a
precise deny rule for `CodexSandboxUsers` to the coordinator-only `contracts`,
`prepared`, `sealed`, and `subjects` directories. Every launch records the
before/after target hashes and the `acl-applied.json` and `acl-restored.json`
receipts. ACL application snapshots each target's access-control SDDL and
restores that exact descriptor on partial failure or launch completion; any
failure to restore the exact prior state is fatal and the harness fails closed.

The Windows confinement canary proves all of the following from the restricted
process before model execution is accepted:

- the external workspace remains writable;
- a direct absolute-path read of coordinator-only data is denied;
- the same read through .NET APIs is denied;
- `forbidden_junction_read` is denied through a workspace junction.

Inside WSL, every allowed `node`, `npm`, `npx`, `sh`, `bash`, `python`, and
`python3` entrypoint is a workspace-specific Windows shim. The shim starts
`wsl-bwrap`, unshares the user, PID, network, UTS, and IPC namespaces, mounts
the pinned Node 22.13.1/npm 10.9.2 toolchain read-only at `/toolchain`, binds
only the current workspace writable at `/workspace`, binds the current frozen
subject read-only at `/subject`, clears the environment, and disables WSL
interop. Node, Python, and shell-wrapper socket canaries must all pass for both
execution and review probes. The frozen constants are
`wsl-bwrap-unshare-user-net` and
`opencode-config-shell-to-wsl-bwrap-unshare-user-net`; unavailable bwrap,
mount, namespace, or canary support stops preparation.

Before a new campaign directory is created, `prepare` first runs the fixed
`wsl.exe --distribution <pinned-distro> --exec /bin/true` probe as
`CodexSandboxOnline` with that account's Windows profile loaded. The harness
reads the existing DPAPI-protected sandbox credential and constructs the process
credential in memory; plaintext is not written, passed in argv/environment, or
returned as evidence. It then independently launches
`wsl.exe --distribution <pinned-distro> --exec /usr/bin/id` through the actual
Codex restricted profile in an ephemeral workspace below the separate execution
root, not below the coordinator user's temporary directory. Both probes are
fail-closed and also run before a diagnostic blocked-smoke resume. A per-user WSL registration
failure is reported explicitly as `distro-not-found` or `no-distributions` and
cannot be masked as a later workspace-edit gateway failure.

Formal model phases also deny Task/subagent sessions and use a deny-first bash
policy. The only allowed shell commands are narrow read-only repository probes,
the frozen arm's knowledge lifecycle commands, and, during repair, the focused
and full commands copied from the frozen task contract. `npm ci`, dependency
installation, arbitrary `node -e`/Python execution, web tools, and other
network-capable commands remain denied inside model sessions.

Provider credentials use `isolated-disk-only` transport. The isolated OpenCode
configuration and auth material are written with restricted permissions below
the per-launch runtime root. On Windows that runtime root is created outside
the system temporary directory (under the coordinator root's parent) because
OpenCode refuses to create helper binaries below `%TEMP%`; it is removed after
each launch. Credential content is not passed through
`OPENCODE_CONFIG_CONTENT`, `OPENCODE_AUTH_CONTENT`, or provider-secret
environment variables. The resolved config probe must match the disk config.

The environment artifact also binds the project instruction route as the exact
`AGENTS.md` path and SHA-256, plus the generated shell-wrapper path digest and
its invocation-receipt digest. `campaign.json` binds both `smoke/smoke.json`
and `smoke/environment.json` independently with SHA-256. The semantic smoke
gate then requires passed execution and review probes, per-response usage,
exact v1/v2 subject discovery, the frozen assurance constants, restricted-token
and ACL restoration evidence, Windows and WSL canaries, disk-only credentials,
the `AGENTS.md` digest, and shell-wrapper evidence. It also invokes the frozen
`/harness/workspace-edit` gateway through the restricted process, requires one
canonical receipt, removes the neutral probe file, and binds the gateway
runtime digest. Two valid file hashes alone are not enough.

Each phase records the frozen subject digest, effective-config digest, exact
loaded `SKILL.md` path, skill-discovery probe digest, shim digest, randomness as
`seed_support: not-supported` / `seed: not-measured` / `variant: null`, and the
transport retry eligibility boundary. Malformed JSONL, a
non-newline-terminated malformed final record, a child-session tool event, an
escaped path, or a mutated subject fails the phase closed.

The assurance classification is
`windows-restricted-token+wsl-bwrap-user-net+deny-first-command-allowlist` for
network entrypoints and
`windows-restricted-token+reversible-forbidden-acl+wsl-bwrap-bind-map` for
filesystem confinement. This is not a syscall audit and not a host firewall
claim: the Windows OpenCode process remains online for provider requests, and
filesystem traces remain `opencode-tool-event-derived`, corroborated by final
byte snapshots and patches rather than an operating-system syscall trace.

## Aggregation and reporting

`report` derives efficiency totals from every arm's hashed phase
`evidence.json`; cached `run.json.metrics` values must match that derivation. A
metric is numeric only when all nine runs for that version contain valid
non-negative measurements. Otherwise the value is `not-measured` with
measured/expected run coverage, never zero.

The report includes onboarding and total tokens, elapsed time,
selected-context bytes, knowledge bytes written, and Capture item counts.
Low-value Capture stays `not-measured` unless the blind reviewer supplies a
complete item-level label set for every Capture item with no unresolved
verdict. These efficiency fields are descriptive only and never participate in
the correctness-first winner calculation. The Chinese report also lists each
task/attempt verdict artifact and its SHA-256 after the sealed verdict set is
revealed.
