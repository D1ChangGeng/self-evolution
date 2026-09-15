"""Coordinator-only SWE-ContextBench continuity adapter.

This module owns public-source freezing, official evaluator/image provisioning,
and gold/no-op preflight dispatch.  It deliberately does *not* start a model.
Model sessions continue to use ``run_task.py`` so task isolation, provider
gateway, B0/B4/B5 subject handling, receipts, and patch export have one
implementation.

The related task is always materialized from its own upstream base.  The only
permitted cross-task input is a continuation record produced by the evaluated
Codex experience run.  Gold patches, test patches, packaged trajectories, and
evaluator feedback are coordinator-only and never become an agent prompt.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any


SOURCE_REVISION = "5bec275a2095768a53ac804ae4fdf90b1723b8af"
EVALUATOR_REPOSITORY = "https://github.com/jiayuanz3/SWEContextBench.git"
EVALUATOR_COMMIT = "31bb04155f52b184bf31b220e3cff0607ac9c953"
PAIRS = (
    ("astropy__astropy-14995", "astropy__astropy-15082"),
    ("sympy__sympy-19487", "sympy__sympy-19484"),
)
ARMS = ("B0", "B4", "B5")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def command(argv: list[str | Path], *, env: dict[str, str] | None = None,
            cwd: Path | None = None, timeout: int | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([str(item) for item in argv], cwd=cwd, env=env,
                          check=True, capture_output=True, timeout=timeout)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n")


def load_selected_rows(path: Path) -> dict[str, dict[str, dict[str, Any]]]:
    """Load exactly the four frozen rows from the cached public source."""
    rows: dict[str, dict[str, dict[str, Any]]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        role = item.get("which")
        row = {key: value for key, value in item.items() if key != "which"}
        identifier = row.get("instance_id")
        if role not in ("experience", "related") or not isinstance(identifier, str):
            continue
        if identifier in {value for pair in PAIRS for value in pair}:
            if identifier in rows and role in rows[identifier]:
                if rows[identifier][role] != row:
                    raise ValueError(f"conflicting cached row: {identifier}/{role}")
            rows.setdefault(identifier, {})[role] = row
    # The compact historical cache contains complete patches but omits some
    # row columns.  If its normalized parquet-derived companion is present,
    # use it only to fill those public source fields; never synthesize values.
    companion = path.with_name("selected-contextbench-rows-full.json")
    if companion.is_file():
        for item in json.loads(companion.read_text(encoding="utf-8")):
            role = item.get("continuity_role")
            identifier = item.get("instance_id")
            if role in ("experience", "related") and identifier in rows:
                merged = dict(rows[identifier].get(role, {}))
                merged.update(item)
                rows[identifier][role] = merged
    selected: dict[str, dict[str, dict[str, Any]]] = {}
    for experience, related in PAIRS:
        try:
            selected[experience] = {"experience": rows[experience]["experience"]}
            selected[related] = {"related": rows[related]["related"]}
        except KeyError as error:
            raise ValueError(f"required frozen source row missing: {error}") from error
    return selected


def image_tag(instance_id: str, role: str = "related") -> str:
    if "__" not in instance_id:
        raise ValueError(f"invalid instance id: {instance_id}")
    if role == "experience":
        owner, name_and_id = instance_id.split("__", 1)
        repo, number = name_and_id.rsplit("-", 1)
        return f"swebench/sweb.eval.x86_64.{owner}_1776_{repo}-{number}:latest"
    if role != "related":
        raise ValueError(f"invalid task role: {role}")
    return "jiayuanz3/swecontextbench:" + instance_id.replace("__", ".").lower()


def require_row_shape(row: dict[str, Any]) -> None:
    required = ("instance_id", "repo", "base_commit", "environment_setup_commit",
                "problem_statement", "patch", "test_patch", "FAIL_TO_PASS", "PASS_TO_PASS")
    missing = [key for key in required if not isinstance(row.get(key), str) or not row[key]]
    if missing:
        raise ValueError(f"public task row missing required fields: {missing}")
    if len(row["base_commit"]) != 40 or len(row["environment_setup_commit"]) != 40:
        raise ValueError("task commit is not a complete SHA-1")


def make_manifest(rows: dict[str, dict[str, dict[str, Any]]], selected_path: Path) -> dict[str, Any]:
    pairs = []
    for ordinal, (experience_id, related_id) in enumerate(PAIRS, start=1):
        experience = rows[experience_id]["experience"]
        related = rows[related_id]["related"]
        require_row_shape(experience)
        require_row_shape(related)
        if experience["repo"] != related["repo"]:
            raise ValueError(f"cross-repository frozen pair: {experience_id}/{related_id}")
        pairs.append({
            "pair_id": f"contextbench-{ordinal}",
            "source": {
                "dataset": "jiayuanz3/SWEContextBench",
                "revision": SOURCE_REVISION,
                "selected_rows_sha256": sha256_file(selected_path),
                "evaluator_repository": EVALUATOR_REPOSITORY,
                "evaluator_commit": EVALUATOR_COMMIT,
            },
            "experience": _task_descriptor(experience),
            "related": _task_descriptor(related),
            "protocol": {
                "experience_agent_input": "public issue and independently materialized exact base only",
                "related_agent_input_treatment": "fresh exact related base plus self-generated continuation record only",
                "related_agent_input_control": "fresh exact related base without continuation record",
                "forbidden_agent_inputs": [
                    "gold patch", "official test patch", "prepackaged Lite Past Experience trajectory",
                    "official evaluator output", "experience workspace or experience patch",
                ],
                "base_patch_rule": "never apply the experience patch onto the related base",
                "sessions_per_task": 2,
                "official_evaluation_feedback": "after both fresh related sessions; never retry same attempt from it",
            },
        })
    return {
        "schema": "contextbench-continuity-manifest/1",
        "status": "frozen-not-model-executed",
        "created_at": time.time(),
        "pairs": pairs,
    }


def _task_descriptor(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "instance_id": row["instance_id"],
        "repo": row["repo"],
        "base_commit": row["base_commit"],
        "environment_setup_commit": row["environment_setup_commit"],
        "image": image_tag(row["instance_id"], row.get("continuity_role", "related")),
        "row_sha256": sha256_bytes(json.dumps(row, sort_keys=True, separators=(",", ":")).encode()),
        "fail_to_pass": json.loads(row["FAIL_TO_PASS"]),
        "pass_to_pass_count": len(json.loads(row["PASS_TO_PASS"])),
    }


def docker_env(runtime: Path) -> tuple[Path, dict[str, str]]:
    docker = runtime / "toolchain" / "docker" / "docker"
    if not docker.is_file():
        raise FileNotFoundError(f"pinned Docker CLI unavailable: {docker}")
    env = dict(os.environ)
    env["DOCKER_HOST"] = "unix://" + str(runtime / "docker.sock")
    env["DOCKER_CONFIG"] = str(runtime / "docker-client")
    return docker, env


def provision_evaluator(runtime: Path, destination: Path) -> dict[str, Any]:
    """Fetch exactly the public evaluator commit, refusing a dirty replacement."""
    if destination.exists():
        head = command(["git", "-C", destination, "rev-parse", "HEAD"]).stdout.decode().strip()
        dirty = command(["git", "-C", destination, "status", "--porcelain"]).stdout
        if head != EVALUATOR_COMMIT or dirty:
            raise RuntimeError("existing evaluator does not match clean pinned source")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        command(["git", "clone", "--no-checkout", EVALUATOR_REPOSITORY, destination])
        command(["git", "-C", destination, "checkout", "--detach", EVALUATOR_COMMIT])
    return {
        "repository": EVALUATOR_REPOSITORY,
        "commit": EVALUATOR_COMMIT,
        "path": str(destination.resolve()),
        "readme_sha256": sha256_file(destination / "README.md"),
        "evaluation_script_sha256": sha256_file(destination / "evaluation.sh"),
        "runner_sha256": sha256_file(destination / "swebench_memory" / "harness" / "run_evaluation.py"),
    }


def provision_images(runtime: Path, rows: dict[str, dict[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    docker, env = docker_env(runtime)
    reports = []
    for experience_id, related_id in PAIRS:
        for identifier, role in ((experience_id, "experience"), (related_id, "related")):
            tag = image_tag(identifier, role)
            try:
                command([docker, "pull", "--platform", "linux/amd64", tag], env=env, timeout=900)
            except subprocess.CalledProcessError as error:
                # Preserve missing-image provenance; never silently build an
                # image with a different toolchain or call it official.
                detail = (error.stderr or error.stdout or b"").decode(errors="replace")[-2000:]
                reports.append({"instance_id": identifier, "role": role, "tag": tag,
                                "status": "unavailable", "error": detail})
                continue
            inspected = json.loads(command([docker, "image", "inspect", tag], env=env).stdout)[0]
            reports.append({
                "instance_id": identifier,
                "role": role,
                "tag": tag,
                "image_id": inspected["Id"],
                "repo_digests": inspected.get("RepoDigests", []),
                "size_bytes": inspected.get("Size"),
            })
    return reports


def task_rows(rows: dict[str, dict[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    ordered = []
    for experience_id, related_id in PAIRS:
        ordered.append(rows[experience_id]["experience"])
        ordered.append(rows[related_id]["related"])
    return ordered


def make_dispatch(manifest: dict[str, Any], dataset_path: Path) -> dict[str, Any]:
    """Describe calls to the existing runner; do not duplicate it here."""
    attempts = []
    for pair in manifest["pairs"]:
        for arm in ARMS:
            attempts.append({
                "pair_id": pair["pair_id"],
                "stage": "experience",
                "arm": arm,
                "task": pair["experience"]["instance_id"],
                "image": pair["experience"]["image"],
                "dataset": str(dataset_path),
                "continuation": None,
                "runner": "maintainer/evals/engineering/public/run_task.py",
            })
            attempts.append({
                "pair_id": pair["pair_id"],
                "stage": "related-control",
                "arm": arm,
                "task": pair["related"]["instance_id"],
                "image": pair["related"]["image"],
                "dataset": str(dataset_path),
                "continuation": None,
                "runner": "maintainer/evals/engineering/public/run_task.py",
            })
            attempts.append({
                "pair_id": pair["pair_id"],
                "stage": "related-treatment",
                "arm": arm,
                "task": pair["related"]["instance_id"],
                "image": pair["related"]["image"],
                "dataset": str(dataset_path),
                "continuation": "required-from-matching-experience-attempt",
                "runner": "maintainer/evals/engineering/public/run_task.py",
            })
    return {
        "schema": "contextbench-runner-dispatch/1",
        "runner_extension_required": {
            "flag": "--continuation-file PATH",
            "legal_only_when": "related-treatment",
            "mount": "read-only file outside project source",
            "prompt_contract": "append continuation bytes verbatim after an explicit untrusted-record delimiter",
            "receipt_binding": "record continuation SHA-256 and source experience attempt manifest SHA-256",
            "prohibitions": "never mount experience worktree, patch, evaluator, test patch, or trajectory",
        },
        "attempts": attempts,
    }


def preflight(evaluator: Path, runtime: Path, rows_path: Path, identifier: str,
              kind: str, output: Path) -> dict[str, Any]:
    """Run the pinned official evaluator with gold or no-op data, no model."""
    if kind not in ("gold", "noop"):
        raise ValueError("preflight kind must be gold or noop")
    all_rows = json.loads(rows_path.read_text())
    row = next((value for value in all_rows if value.get("instance_id") == identifier), None)
    if row is None:
        raise ValueError(f"selected task unavailable: {identifier}")
    if output.exists():
        raise FileExistsError("preflight output must be fresh")
    output.mkdir(parents=True)
    predictions = output / "predictions"
    predictions.mkdir()
    patch = row["patch"] if kind == "gold" else ""
    write_json(predictions / f"{identifier}_preds.json", {
        identifier: {"model_name_or_path": f"contextbench-{kind}-preflight",
                     "instance_id": identifier, "model_patch": patch}
    })
    docker, env = docker_env(runtime)
    # The public script is the official acceptance entry point for this source.
    result = subprocess.run([str(evaluator / "evaluation.sh"), f"preflight-{kind}", "full", str(predictions)],
                            cwd=evaluator, env=env, capture_output=True, timeout=1800)
    (output / "stdout.log").write_bytes(result.stdout)
    (output / "stderr.log").write_bytes(result.stderr)
    report = {
        "schema": "contextbench-official-preflight/1", "kind": kind,
        "task": identifier, "exit_code": result.returncode,
        "evaluator_commit": EVALUATOR_COMMIT,
        "dataset_row_sha256": sha256_bytes(json.dumps(row, sort_keys=True).encode()),
        "image": image_tag(identifier, "related"),
        "stdout_sha256": sha256_file(output / "stdout.log"),
        "stderr_sha256": sha256_file(output / "stderr.log"),
    }
    write_json(output / "receipt.json", report)
    if result.returncode:
        raise RuntimeError(f"official {kind} preflight failed; receipt preserved at {output}")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    freeze = sub.add_parser("freeze")
    freeze.add_argument("--selected-pairs", type=Path, required=True)
    freeze.add_argument("--output", type=Path, required=True)
    provision = sub.add_parser("provision")
    provision.add_argument("--runtime", type=Path, required=True)
    provision.add_argument("--selected-pairs", type=Path, required=True)
    provision.add_argument("--evaluator", type=Path, required=True)
    provision.add_argument("--output", type=Path, required=True)
    check = sub.add_parser("preflight")
    check.add_argument("--runtime", type=Path, required=True)
    check.add_argument("--evaluator", type=Path, required=True)
    check.add_argument("--dataset", type=Path, required=True)
    check.add_argument("--task", required=True)
    check.add_argument("--kind", choices=("gold", "noop"), required=True)
    check.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if args.action == "freeze":
        rows = load_selected_rows(args.selected_pairs)
        manifest = make_manifest(rows, args.selected_pairs)
        if args.output.exists():
            raise FileExistsError("freeze output must be fresh")
        args.output.mkdir(parents=True)
        dataset = args.output / "selected-contextbench-rows.json"
        write_json(dataset, task_rows(rows))
        write_json(args.output / "manifest.json", manifest)
        write_json(args.output / "dispatch.json", make_dispatch(manifest, dataset))
        print(json.dumps({"output": str(args.output), "pairs": len(manifest["pairs"])}))
        return 0
    if args.action == "provision":
        rows = load_selected_rows(args.selected_pairs)
        evaluator = provision_evaluator(args.runtime, args.evaluator)
        images = provision_images(args.runtime, rows)
        if args.output.exists():
            raise FileExistsError("provision output must be fresh")
        args.output.mkdir(parents=True)
        write_json(args.output / "provision.json", {"schema": "contextbench-provision/1",
                   "status": "complete" if all(x.get("status", "available") == "available" for x in images) else "blocked-missing-official-image",
                   "evaluator": evaluator, "images": images, "created_at": time.time()})
        print(json.dumps({"output": str(args.output), "images": len(images)}))
        return 0
    report = preflight(args.evaluator, args.runtime, args.dataset, args.task, args.kind, args.output)
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
