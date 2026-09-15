#!/usr/bin/env python3
"""Read-only, explicit-activation smoke checks; no engineering outcome claim."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx

from run_campaign import artifact_ref, sha256_file, subject_facts, write_json
from workspace_snapshot import executable_identity, workspace_compliance, workspace_snapshot


TASKS = [
    {
        "id": "codex-routing",
        "section": "harness",
        "harness": "codex",
        "files": {
            "AGENTS.md": """# Retry service\n\n## Where to Look\n\n| Scope | Read |\n|---|---|\n| Retry behavior | `.agents/knowledge/guides/retries.md` |\n\nVerify material claims against current project files.\n""",
            ".agents/knowledge/guides/retries.md": """---\nkind: guide\nstatus: active\nscope: [\"config/retries.yaml\"]\nuse_when: [\"checking settlement retry behavior\"]\n---\n\nSettlement retries use jittered exponential backoff capped at 4 attempts.\n""",
            "config/retries.yaml": "max_attempts: 4\n",
        },
        "prompt": "Use $self-evolution. Read AGENTS.md, the self-evolution SKILL.md available to this harness, and the routed guide. What is the verified settlement retry cap? Return concise JSON with answer and evidence path only.",
        "required": [r"\b4\b", r"(?:config/retries\.yaml|guides/retries\.md)"],
        "forbidden": [],
    },
    {
        "id": "claude-stale-source",
        "section": "harness",
        "harness": "claude-code",
        "files": {
            "AGENTS.md": """# Service project\n\n## Where to Look\n\n| Scope | Read |\n|---|---|\n| Service port | `.agents/knowledge/guides/service.md`, then `config/service.yaml` |\n\nCurrent configuration is authoritative for observed behavior.\n""",
            "CLAUDE.md": "@AGENTS.md\n",
            ".agents/knowledge/guides/service.md": """---\nkind: guide\nstatus: active\nscope: [\"config/service.yaml\"]\nuse_when: [\"checking the service port\"]\nsources:\n  - path: \"config/service.yaml\"\n    checked_at: \"sha256:04eeaa6d3c2a66678af8514f5c8777a8889296f351c790bd3fa21ed2f9dd482e\"\n---\n\nThe service listens on port 8080.\n""",
            "config/service.yaml": "port: 9090\n",
        },
        "prompt": "Use $self-evolution. Read CLAUDE.md, AGENTS.md, the self-evolution SKILL.md, the routed guide, and current config. Return concise JSON with current_port, knowledge_status, and evidence path.",
        "required": [r"9090", r"(?i)(source_changed|source changed|stale)", r"config/service\.yaml"],
        "forbidden": [],
    },
    {
        "id": "opencode-capture-none",
        "section": "harness",
        "harness": "opencode",
        "files": {
            "AGENTS.md": """# Package project\n\n## Where to Look\n\n| Scope | Read |\n|---|---|\n| Package identity | `package.json` |\n\nKeep durable knowledge only when it changes a future action.\n""",
            "package.json": '{"name":"widget-core","version":"1.0.0"}\n',
        },
        "prompt": "Use the self-evolution skill. Read AGENTS.md, the harness skill file, and package.json. This task only confirms the already-authoritative package name. Decide Capture at close. Return concise JSON with package, capture, and evidence path; do not edit files.",
        "required": [r"widget-core", r'(?i)capture[\"\s:]+none', r"package\.json"],
        "forbidden": [],
    },
    {
        "id": "codex-bounded-evidence",
        "section": "sample",
        "harness": "codex",
        "files": {
            "AGENTS.md": """# Hardware list diagnostic\n\n## Where to Look\n\n| Scope | Read |\n|---|---|\n| Search dropdown behavior | `evidence/hardware-search.md` |\n\nUse the exact observed state as the factual boundary.\n""",
            "evidence/hardware-search.md": "The crash is expected when the top search selector changes from `for text` to the reference field `Assigned to`. Keep the default `for text` search for this lookup.\n",
        },
        "prompt": "Use $self-evolution. Read AGENTS.md, the self-evolution SKILL.md, and the routed evidence. Give only the most likely explanation or one action for the observed crash. Return one concise sentence plus the evidence path.",
        "required": [r"for text", r"hardware-search\.md"],
        "forbidden": [r"(?i)defect", r"(?i)filter builder"],
    },
    {
        "id": "claude-authority-boundary",
        "section": "sample",
        "harness": "claude-code",
        "files": {
            "AGENTS.md": """# Feature service\n\n## Where to Look\n\n| Question | Read |\n|---|---|\n| Runtime behavior | `config/feature.yaml` |\n| Adopted intent | `.agents/knowledge/decisions/feature.md` |\n\nReport observed behavior and adopted intent separately.\n""",
            "CLAUDE.md": "@AGENTS.md\n",
            "config/feature.yaml": "enabled: false\n",
            ".agents/knowledge/decisions/feature.md": """---\nkind: decision\nid: adr-feature-rollout\nstatus: accepted\ndate: 2026-09-01\nsupersedes: null\nscope: [\"config/feature.yaml\"]\n---\n# Adopt feature rollout\n\nThe project adopted enabling the feature after rollout validation.\n\nReconsider when rollout completes.\n""",
        },
        "prompt": "Use $self-evolution. Read CLAUDE.md, AGENTS.md, the self-evolution SKILL.md, runtime config, and accepted Decision. Return concise JSON separating observed behavior from adopted intent, with both evidence paths.",
        "required": [r"(?is)(behavior|observed).*(false|off)", r"(?is)(intent|adopted).*(true|on|enabl)", r"config/feature\.yaml", r"decisions/feature\.md"],
        "forbidden": [],
    },
    {
        "id": "opencode-continuity",
        "section": "sample",
        "harness": "opencode",
        "files": {
            "AGENTS.md": """# Migration project\n\nUse the host task state for current-task continuity and the wiki only for durable cross-task knowledge.\n""",
            "TASK-STATE.md": """Objective: migrate the billing schema.\nConstraint: preserve rollback data.\nVerified state: backup checksum matches.\nOpen risk: dry-run has not executed.\nNext action: run the migration dry-run.\nNext verification: compare the dry-run plan with the approved schema.\n""",
        },
        "prompt": "Use the self-evolution skill. Read AGENTS.md, the harness skill file, and TASK-STATE.md as restored task state after compaction. Return concise JSON with next_action, next_verification, and persistence_destination. Do not edit files.",
        "required": [r"(?is)run.*migration.*dry-run", r"(?i)compare the dry-run plan", r"(?i)(task state|TASK-STATE)"],
        "forbidden": [r"(?i)knowledge/(guides|decisions|observations)"],
    },
]


def extract_texts(value: Any) -> list[str]:
    result: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"text", "result", "content"} and isinstance(item, str):
                result.append(item)
            else:
                result.extend(extract_texts(item))
    elif isinstance(value, list):
        for item in value:
            result.extend(extract_texts(item))
    return result


def final_from_json_lines(output: str) -> str:
    texts: list[str] = []
    for line in output.splitlines():
        try:
            texts.extend(extract_texts(json.loads(line)))
        except json.JSONDecodeError:
            continue
    return texts[-1].strip() if texts else output.strip()


def answer_text(raw_final: str) -> str:
    """Separate a provider reasoning prelude from its displayed answer."""
    return re.sub(r"\A\s*<think>.*?</think>\s*", "", raw_final, count=1, flags=re.S).strip()


def run_process(command: list[str], cwd: Path, env: dict[str, str], timeout: float) -> tuple[int, str, str]:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        return completed.returncode, completed.stdout, completed.stderr
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout.decode() if isinstance(error.stdout, bytes) else error.stdout
        stderr = error.stderr.decode() if isinstance(error.stderr, bytes) else error.stderr
        return 124, stdout or "", (stderr or "") + f"\nTimed out after {timeout} seconds."


def endpoint_review(
    client: httpx.Client,
    base_url: str,
    key: str,
    model: str,
    task: dict[str, Any],
    final_text: str,
    checks: list[dict[str, Any]],
) -> tuple[bool, str, str]:
    prompt = (
        "You are an independent engineering-output reviewer. Judge the output only against the "
        "task, required evidence patterns, forbidden patterns, and deterministic check results. "
        "Return JSON only with label 1 for pass or 0 for fail and a short reason.\n\n"
        f"Task: {task['prompt']}\nRequired patterns: {task['required']}\n"
        f"Forbidden patterns: {task['forbidden']}\nChecks: {checks}\n"
        f"Harness output:\n{final_text}\n\n"
        'Output: {"label":0 or 1,"reason":"short rationale"}'
    )
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            response = client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_completion_tokens": 256,
                    "reasoning_effort": "low",
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            raw = response.json()["choices"][0]["message"]["content"]
            match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
            if not match:
                raise RuntimeError("reviewer returned no JSON object")
            payload = json.loads(match.group(0))
            if payload.get("label") not in {0, 1, "0", "1"}:
                raise RuntimeError("reviewer returned no binary label")
            return bool(int(payload["label"])), str(payload.get("reason", "")), raw
        except Exception as error:  # noqa: BLE001 - bounded provider retry
            last_error = error
            if attempt < 4:
                time.sleep(min(20, 2**attempt))
    raise RuntimeError(f"review endpoint failed after retries: {last_error}")


def prepare_workspace(root: Path, task: dict[str, Any], subject: Path) -> Path:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", task["id"]):
        raise ValueError("unsafe task id")
    workspace = root / "workspaces" / task["id"]
    if workspace.exists():
        raise FileExistsError("Use a fresh attempt output root; preserve previous workspace evidence")
    workspace.mkdir(parents=True)
    for relative, content in task["files"].items():
        path = workspace / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    skill_root = {
        "claude-code": workspace / ".claude" / "skills" / "self-evolution",
        "opencode": workspace / ".opencode" / "skills" / "self-evolution",
    }.get(task["harness"])
    if skill_root:
        shutil.copytree(subject, skill_root)
    return workspace


def task_file_digests(workspace: Path, task: dict[str, Any]) -> dict[str, Any]:
    # Compatibility entry point; the entire tree is now covered, including
    # installed skill files, directories, deletions and link/type changes.
    return workspace_snapshot(workspace)


def run_harness(
    args: argparse.Namespace,
    task: dict[str, Any],
    workspace: Path,
    codex_home: Path,
    api_key: str,
) -> tuple[list[str], int, str, str, str]:
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([str(args.node_bin.parent), str(args.opencode_bin.parent), env.get("PATH", "")])
    if task["harness"] == "codex":
        last_message = args.output_root / "runtime" / f"{task['id']}-last-message.txt"
        last_message.parent.mkdir(parents=True, exist_ok=True)
        env["CODEX_HOME"] = str(codex_home)
        command = [
            str(args.codex_bin),
            "exec",
            "--json",
            "--ephemeral",
            "--skip-git-repo-check",
            "-C",
            str(workspace),
            "-s",
            "read-only",
            "-m",
            args.model,
            "-c",
            'model_reasoning_effort="low"',
            "-o",
            str(last_message),
            task["prompt"],
        ]
        task["snapshot_before"] = task_file_digests(workspace, task)
        code, stdout, stderr = run_process(command, workspace, env, args.timeout)
        final = last_message.read_text(encoding="utf-8").strip() if last_message.exists() else final_from_json_lines(stdout)
    elif task["harness"] == "claude-code":
        env["ANTHROPIC_BASE_URL"] = args.anthropic_base_url
        env["ANTHROPIC_AUTH_TOKEN"] = api_key
        env["ANTHROPIC_API_KEY"] = api_key
        command = [
            str(args.claude_bin),
            "-p",
            task["prompt"],
            "--output-format",
            "stream-json",
            "--verbose",
            "--no-session-persistence",
            "--model",
            args.model,
            "--effort",
            "low",
            "--permission-mode",
            "dontAsk",
            "--permission-prompts",
            "none",
            "--setting-sources",
            "project",
            "--strict-mcp-config",
            "--tools",
            "Read,Glob,Grep",
        ]
        task["snapshot_before"] = task_file_digests(workspace, task)
        code, stdout, stderr = run_process(command, workspace, env, args.timeout)
        final = final_from_json_lines(stdout)
    else:
        env["SELF_EVOLUTION_API_KEY"] = api_key
        write_json(
            workspace / "opencode.json",
            {
                "$schema": "https://opencode.ai/config.json",
                "provider": {
                    "self-evolution-eval": {
                        "npm": "@ai-sdk/openai-compatible",
                        "name": "Self-Evolution Eval",
                        "options": {
                            "baseURL": args.base_url,
                            "apiKey": "{env:SELF_EVOLUTION_API_KEY}",
                        },
                        "models": {
                            "gpt-5.6-sol": {
                                "name": "GPT-5.6 Sol",
                                "id": args.model,
                                "options": {
                                    "request": {
                                        "body": {"reasoning_effort": "low"}
                                    }
                                },
                            }
                        },
                    }
                },
            },
        )
        command = [
            str(args.opencode_bin),
            "run",
            "--pure",
            "--format",
            "json",
            "--dir",
            str(workspace),
            "--model",
            args.opencode_model,
            "--variant",
            "low",
            "--auto",
            task["prompt"],
        ]
        task["snapshot_before"] = task_file_digests(workspace, task)
        code, stdout, stderr = run_process(command, workspace, env, args.timeout)
        final = final_from_json_lines(stdout)
    return command, code, stdout, stderr, final


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--subject", type=Path, required=True)
    parser.add_argument("--subject-sha256", required=True)
    parser.add_argument("--codex-home-source", type=Path, required=True)
    parser.add_argument("--codex-bin", type=Path, required=True)
    parser.add_argument("--claude-bin", type=Path, required=True)
    parser.add_argument("--opencode-bin", type=Path, required=True)
    parser.add_argument("--node-bin", type=Path, required=True)
    parser.add_argument("--api-key-file", type=Path, required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--anthropic-base-url", required=True)
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument(
        "--opencode-model", default="self-evolution-eval/gpt-5.6-sol"
    )
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--task", action="append")
    args = parser.parse_args()

    args.output_root.mkdir(parents=True, exist_ok=True)
    facts = subject_facts(args.subject)
    if facts["subject_sha256"] != args.subject_sha256:
        raise RuntimeError("engineering subject does not match expected digest")
    key = args.api_key_file.read_text(encoding="utf-8").strip()
    if not key:
        raise RuntimeError("API key file is empty")

    codex_home = args.output_root / "codex-home"
    codex_home.mkdir(exist_ok=True)
    for name in ("config.toml", "models.json"):
        source = args.codex_home_source / name
        if source.exists():
            shutil.copy2(source, codex_home / name)
    target_skill = codex_home / "skills" / "self-evolution"
    if target_skill.exists():
        shutil.rmtree(target_skill)
    target_skill.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(args.subject, target_skill)

    harness_items = []
    sample_items = []
    failed_tasks: list[str] = []
    with httpx.Client(timeout=300) as reviewer:
        selected_tasks = [
            task for task in TASKS if not args.task or task["id"] in set(args.task)
        ]
        if args.task and len(selected_tasks) != len(set(args.task)):
            raise RuntimeError("one or more requested engineering task IDs are unknown")
        for task in selected_tasks:
            workspace = prepare_workspace(args.output_root, task, args.subject)
            binary = {"codex": args.codex_bin, "claude-code": args.claude_bin, "opencode": args.opencode_bin}[task["harness"]]
            identity = executable_identity(binary)
            before = task_file_digests(workspace, task)
            started = time.time()
            command, code, stdout, stderr, raw_final = run_harness(
                args, task, workspace, codex_home, key
            )
            final = answer_text(raw_final)
            before = task["snapshot_before"]
            after = task_file_digests(workspace, task)
            compliance = workspace_compliance(before, after, "read-only")
            identity_after = executable_identity(binary)
            toolchain_unchanged = identity == identity_after
            duration_ms = round((time.time() - started) * 1000)
            checks = [
                {
                    "pattern": pattern,
                    "kind": "required",
                    "pass": re.search(pattern, final) is not None,
                }
                for pattern in task["required"]
            ] + [
                {
                    "pattern": pattern,
                    "kind": "forbidden",
                    "pass": re.search(pattern, final) is None,
                }
                for pattern in task["forbidden"]
            ] + [
                {
                    "kind": "invariant",
                    "pattern": "controlled workspace remains unchanged",
                    "pass": compliance["pass"],
                }
            ]
            deterministic_pass = code == 0 and bool(final) and all(
                item["pass"] for item in checks
            ) and toolchain_unchanged
            reviewer_pass, reviewer_reason, reviewer_raw = endpoint_review(
                reviewer,
                args.base_url,
                key,
                args.model,
                task,
                final,
                checks,
            )

            evidence_path = args.output_root / "evidence" / f"{task['id']}.json"
            write_json(
                evidence_path,
                {
                    "task_id": task["id"],
                    "evidence_class": "read-only-explicit-activation-smoke",
                    "workspace_before": before,
                    "workspace_after": after,
                    "workspace_compliance": compliance,
                    "toolchain": identity,
                    "harness": task["harness"],
                    "command": command,
                    "exit_code": code,
                    "duration_ms": duration_ms,
                    "stdout": stdout,
                    "stderr": stderr,
                    "raw_final": raw_final,
                    "final": final,
                    "checks": checks,
                    "reviewer_response": reviewer_raw,
                },
            )
            execution_path = args.output_root / "executions" / f"{task['id']}.json"
            write_json(
                execution_path,
                {
                    "schema_version": "public-engineering-execution/1",
                    "status": "completed" if code == 0 else "failed",
                    "host": platform.node() or "unavailable",
                    "exit_code": code,
                    "campaign_id": args.campaign_id,
                    "task_id": task["id"],
                    "harness": {
                        "name": task["harness"],
                        **identity,
                    },
                    "executor_id": f"{task['harness']}-execution",
                    "subject_sha256": args.subject_sha256,
                    "command": " ".join(command),
                    "events": [
                        {"type": "process-completed", "duration_ms": duration_ms},
                        {
                            "type": "raw-evidence",
                            "sha256": sha256_file(evidence_path),
                        },
                    ],
                },
            )
            review_path = args.output_root / "reviews" / f"{task['id']}.json"
            passed = deterministic_pass and reviewer_pass
            if not passed:
                failed_tasks.append(task["id"])
            write_json(
                review_path,
                {
                    "schema_version": "public-engineering-review/1",
                    "verdict": "pass" if passed else "fail",
                    "host": platform.node() or "unavailable",
                    "campaign_id": args.campaign_id,
                    "task_id": task["id"],
                    "harness": task["harness"],
                    "reviewer_id": f"{args.model}-independent-review",
                    "rationale": (
                        f"deterministic={deterministic_pass}; reviewer={reviewer_pass}; "
                        f"{reviewer_reason}"
                    ),
                    "evidence_refs": [artifact_ref(args.output_root, evidence_path)],
                    "execution_sha256": sha256_file(execution_path),
                    "subject_sha256": args.subject_sha256,
                },
            )
            item = {
                "execution": artifact_ref(args.output_root, execution_path),
                "review": artifact_ref(args.output_root, review_path),
            }
            if task["section"] == "harness":
                harness_items.append({"name": task["harness"], **item})
            else:
                sample_items.append(
                    {"id": task["id"], "harness": task["harness"], **item}
                )
            print(
                json.dumps(
                    {
                        "task": task["id"],
                        "harness": task["harness"],
                        "exit_code": code,
                        "deterministic_pass": deterministic_pass,
                        "reviewer_pass": reviewer_pass,
                    },
                    sort_keys=True,
                ),
                flush=True,
            )

    output_name = "engineering.json" if not args.task else "engineering.partial.json"
    write_json(
        args.output_root / output_name,
        {
            "campaign_id": args.campaign_id,
            "harnesses": harness_items,
            "samples": sample_items,
        },
    )
    if not args.task and (len(harness_items) != 3 or len(sample_items) != 3):
        raise RuntimeError("engineering campaign did not produce six required tasks")
    if not args.task and failed_tasks:
        raise RuntimeError(
            "engineering campaign failed tasks: " + ", ".join(failed_tasks)
        )


if __name__ == "__main__":
    main()
