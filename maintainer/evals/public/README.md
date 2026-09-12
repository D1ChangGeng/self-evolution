# Public benchmark execution layer

The benchmark layer is an independent maintainer tool. It records pinned
upstream sources, environment probes, commands, raw outputs, and derived
metrics; it is not loaded by `skills/self-evolution/SKILL.md` and is not part of
project initialization.

## Layout

```text
public/
  PUBLIC-BENCHMARKS.md       # selection and gate policy
  RESULTS-1302-1.md          # host-specific execution receipt
  public.mjs                 # independent evidence validator
  public.test.mjs            # validator regression tests
  run_campaign.py            # resumable paired public benchmark runner
  run_engineering.py         # harness execution and review runner
  merge_campaigns.py        # aggregate three paired attempts
  pack_evidence.py          # offline release evidence archive
  evidence.bundle.json       # checked-in archive digest and schema
  evidence.bundle.tar.gz     # hash-bound raw run and engineering artifacts
  campaigns/<id>/             # ignored or external raw benchmark outputs
```

The runner translates a frozen public dataset into the skill contract and uses
the pinned upstream-compatible judging rubric. Core changes require three
complete paired runs and per-question majority aggregation. Each attempt covers
all 500 cleaned questions and all 451 questions from the pinned LongMemEval-V2
pilot with its official `small` 100-trajectory haystacks. The manifest contains:

- one or both benchmark declarations: cleaned requires dataset revision and
  V2 requires repository commit `2cc8c540bdb87fe6761629b585e727e1c4704520`;
- dataset hashes and license;
- host, OS, Python/Node/toolchain versions, model endpoint and model revision;
- exact command, prompt/template, context limit, seed, and start/end times;
- raw output paths and SHA-256 hashes;
- per-domain/per-ability accuracy, latency p50/p95, context volume, and
  availability states; and
- baseline comparison and gate status (`pass`, `fail`, `blocked`, or
  `not-comparable`).

No generic agent runtime is bundled: both benchmarks require external data and
model endpoints, while the V2 Codex module additionally requires a separately
installed Codex binary. Maintaining a second runtime here would duplicate host
harness behavior and distort the skill boundary. The independent validator
checks the manifest and can be used by a host-specific runner without changing
the distributed bundle.

For a release, package the final aggregate `evidence.json` and every referenced
prediction, judge, trace, protocol, question manifest, execution, review, and
engineering raw receipt in `evidence.bundle.tar.gz`. Set its `artifact_root` to
`.` inside the archive, record the archive SHA-256 in `evidence.bundle.json`,
and keep paths relative to the archive root. `run.mjs` verifies the archive hash,
extracts it to a temporary directory, derives metrics from the raw artifacts,
and removes the temporary directory. The remote full campaign remains the
system of record for logs, caches, and upstream data; the checked-in bundle
contains the evidence needed to reproduce the release gate offline.

## Run a paired campaign

Freeze the baseline and candidate `skills/self-evolution/` trees before the
run. The runner verifies their complete tree and bundle digests, uses the
official cleaned oracle file and the V2 small haystack, and writes resumable
per-question artifacts. Credentials stay in a host-local key file.

```text
python maintainer/evals/public/run_campaign.py \
  --campaign-id public-20260911-01 \
  --campaign-root <external-campaign-directory> \
  --baseline-skill <frozen-c998067-skill-directory> \
  --candidate-skill <frozen-candidate-skill-directory> \
  --cleaned-data <longmemeval_oracle.json> \
  --v2-root <longmemeval-v2-data-root> \
  --base-url <openai-compatible-base-url> \
  --api-key-file <host-local-key-file> \
  --model gpt-5.6-sol \
  --model-revision <provider-revision-or-observation-id> \
  --toolchain-revision <python-httpx-runner-version>
```

The V2 retrieval adapter creates a local compressed trajectory cache and
selects bounded state evidence with a fixed lexical procedure. It introduces no
runtime dependency into the distributed skill. The generated evidence remains
incomplete until the separate engineering execution and review receipts are
attached.

Validate a generated manifest with the subject digests from the frozen campaign:

```text
node maintainer/evals/public/validate_evidence.mjs \
  <campaign/evidence.json> \
  <baseline-subject-sha256> \
  <candidate-subject-sha256> \
  core
```

The command prints only derived summaries; the evaluator still reads and hashes
every referenced per-question artifact.

After all attempts finish, merge them under one artifact root:

```text
python maintainer/evals/public/merge_campaigns.py \
  --artifact-root <campaign-parent-directory> \
  --campaign public-20260911-01 \
  --campaign public-20260911-02 \
  --campaign public-20260911-03 \
  --campaign-id public-20260911-aggregate \
  --output <campaign-parent-directory>/evidence.json
```

Every nested artifact path is prefixed with its source campaign directory; the
individual manifests and raw evidence remain unchanged.

Run the engineering complement after the benchmark endpoint is idle:

```text
python maintainer/evals/public/run_engineering.py \
  --campaign-id <engineering-campaign-id> \
  --output-root <engineering-campaign-directory> \
  --subject <frozen-candidate-skill-directory> \
  --subject-sha256 <candidate-subject-sha256> \
  --codex-home-source <isolated-codex-config-directory> \
  --codex-bin <codex-binary> \
  --claude-bin <claude-code-binary> \
  --opencode-bin <opencode-binary> \
  --node-bin <node-binary> \
  --api-key-file <host-local-key-file> \
  --base-url <openai-compatible-base-url> \
  --anthropic-base-url <anthropic-compatible-base-url>
```

The six read-only tasks exercise both instruction loading and changed behavior
through Codex, Claude Code, and OpenCode. Each execution is checked against a
fixed rubric and reviewed by a separate model call; raw output and review
receipts remain hash-bound. Use `--task <id>` for a bounded diagnostic run.

Run the merge again with `--engineering <engineering-campaign>/engineering.json`
to attach the six execution/review pairs. Validate the aggregate manifest with
`validate_evidence.mjs`, then package the referenced artifacts:

```text
python maintainer/evals/public/pack_evidence.py \
  --evidence <campaign-parent-directory>/evidence.json \
  --archive <release-staging-directory>/evidence.bundle.tar.gz \
  --manifest <release-staging-directory>/evidence.bundle.json \
  --sensitive-value-file <host-local-key-file>
```

The packer checks every referenced digest and scans included bytes for the
provided sensitive value. The generated archive and manifest are release
artifacts to copy into `maintainer/evals/public/`; the remote campaign retains
logs, caches, and source data.

## Evidence shape

The validator accepts one benchmark for docs, routing, or migration changes and
both declarations for a core change. A minimal core manifest has this shape
(values are illustrative and must be replaced with measured evidence):

```json
{
  "schema_version": "2.0",
  "campaign_id": "public-20260909-01",
  "change_class": "core",
  "benchmark": [
    {
      "id": "longmemeval-cleaned",
      "repository": "xiaowu0162/LongMemEval",
      "dataset": "xiaowu0162/longmemeval-cleaned",
      "data_revision": "<HF revision>",
      "data_sha256": "<64 hex chars>"
    },
    {
      "id": "longmemeval-v2",
      "repository": "xiaowu0162/LongMemEval-V2",
      "commit": "2cc8c540bdb87fe6761629b585e727e1c4704520",
      "data_revision": "<HF revision>",
      "data_sha256": "<64 hex chars>"
    }
  ],
  "host": "1302-1",
  "artifact_root": ".",
  "runs": [
    {
      "benchmark_id": "longmemeval-cleaned",
      "tier": "full",
      "question_manifest": {
        "path": "manifests/cleaned-full.json",
        "sha256": "<64 hex chars>"
      },
      "protocol": {
        "path": "protocols/cleaned-full.json",
        "sha256": "<64 hex chars>"
      },
      "baseline": {
        "subject": {
          "commit": "c998067f73620a4721367e33a31063882896d476",
          "sha256": "<64 hex chars>"
        },
        "results": {
          "path": "results/cleaned-full-baseline.json",
          "sha256": "<64 hex chars>"
        }
      },
      "candidate": {
        "subject": {
          "sha256": "<sha256(stable-json({skill_tree_sha256,bundle_sha256}))>"
        },
        "results": {
          "path": "results/cleaned-full-candidate.json",
          "sha256": "<64 hex chars>"
        }
      }
    }
  ],
  "engineering": {
    "harnesses": [
      "<execution+review artifact refs for codex>",
      "<execution+review artifact refs for claude-code>",
      "<execution+review artifact refs for opencode>"
    ],
    "samples": ["<at least three execution+review artifact pairs>"]
  }
}
```

Each `results.questions[]` entry contains only its question id and references
to three hashed raw artifacts: `prediction`, `judge`, and `trace`. It must not
contain correctness, ability, domain, latency, context size, or aggregate
metrics. Correctness is derived from `judge.verdict`; ability and domain come
from the pinned official manifest; latency is the ordered
`trace.started_at`/`trace.ended_at` duration; context size is the UTF-8 byte
length of the trace's selected context items. The evaluator recomputes all
aggregate metrics from these artifacts.

Raw artifact contracts are intentionally small:

- `prediction`: `public-prediction/1`, question id, arm, subject and protocol
  digests, and the model answer;
- `judge`: `public-judge/1`, question id, arm, subject and protocol digests,
  prediction digest, evaluator identity, and `verdict: correct|incorrect`;
- `trace`: `public-trace/1`, question id, arm, subject and protocol digests,
  prediction digest, ordered timestamps, and `selected_context[]` entries with
  an id and text.

The loader owns its derived validation state. Evidence JSON must not contain
internal fields such as `_validatedRuns` or `_engineering`; those fields are
rejected before validation so a checked-in manifest cannot inject a result.

Baseline and candidate subjects are both required. The baseline must use the
frozen baseline commit and its digest must match the caller's
`baselineSubjectSha256`; the candidate digest is bound through
`subjectSha256`. A mismatch is `not-comparable`.

Engineering evidence is optional for profiles that do not require it. When it
is present, each review may be `pass` or `fail`; a valid `fail` review produces
an engineering `fail` result, while missing or malformed engineering evidence
remains `blocked`. This status is evaluated independently from public benchmark
status. Every execution and review receipt must name its harness, campaign,
task, and distinct executor/reviewer. Receipt bytes and task identifiers may
not be reused across harness labels or samples.

For a core release, add a second run with `benchmark_id:
"longmemeval-v2"`, `tier: "small"`, all 451 pinned question IDs, and both `web`
and `enterprise` domains.
Do not use zero placeholders in a real manifest; unavailable values must leave
the run blocked or not-measured until raw evidence exists.
