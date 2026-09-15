"""Evaluate one sealed public task with the pinned, unmodified SWE-bench grader.

The coordinator owns oracle data.  All evaluation outputs go to a fresh directory
outside the agent attempt; no evaluation result is sent to a model.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from types import SimpleNamespace

EVALUATOR_COMMIT = "726c5461e2ef52d83cf1ea2107870a8bb3328d57"
EVALUATOR_VERSION = "4.1.0"
DATASET_REVISION = "c104f840cc67f8b6eec6f759ebc8b2693d585d4a"
HEX = re.compile(r"[0-9a-f]{64}\Z")
SAFE_ID = re.compile(r"[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha(path):
    return sha_bytes(path.read_bytes())


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode()


def row_hash(row):
    # Must match the producer's json.dumps(row, sort_keys=True), including ASCII escaping.
    return sha_bytes(json.dumps(row, sort_keys=True).encode())


def _pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "duplicate JSON key: " + key)
        result[key] = value
    return result


def parse_json(data):
    def reject_constant(value):
        raise ValueError("non-finite JSON number: " + value)
    return json.loads(data, object_pairs_hook=_pairs, parse_constant=reject_constant)


def read_json(path):
    return parse_json(path.read_bytes())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json_bytes(value))


def ordinary_path(path, allow_missing=False):
    path = Path(path).absolute()
    for part in reversed((path, *path.parents)):
        try:
            info = part.lstat()
        except FileNotFoundError:
            if allow_missing:
                continue
            raise
        require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, "st_file_attributes", 0) & 1024),
                "symlink/reparse path: " + str(part))
    return path


def relative_path(root, name):
    require(isinstance(name, str) and name and ":" not in name and "\\" not in name
            and not name.startswith("/") and "\0" not in name
            and all(part not in ("", ".", "..") for part in name.split("/")), "unsafe artifact path")
    return ordinary_path(root / name)


def load_row(dataset, task):
    require(isinstance(task, str) and SAFE_ID.fullmatch(task), "invalid task identity")
    rows = read_json(ordinary_path(dataset))
    require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows),
            "selected dataset must be a JSON array of records")
    matches = [row for row in rows if row.get("instance_id") == task]
    require(len(matches) == 1, "expected exactly one local row for " + task)
    return matches[0]


def _git(root, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
    result = subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + os.devnull,
                             "-C", str(root), *args], capture_output=True, check=True, env=env)
    return result.stdout


def tracked_tree(evaluator):
    """Check actual bytes against HEAD, even for assume-unchanged/skip-worktree files."""
    evaluator = ordinary_path(evaluator)
    head = _git(evaluator, "rev-parse", "HEAD").decode().strip()
    require(head == EVALUATOR_COMMIT, "evaluator checkout is not the pinned v4.1.0 commit")
    require(not _git(evaluator, "status", "--porcelain=v1", "--untracked-files=all"),
            "evaluator checkout is dirty")
    records = {}
    for record in _git(evaluator, "ls-tree", "-r", "-z", "--full-tree", "HEAD").split(b"\0"):
        if not record:
            continue
        header, raw_name = record.split(b"\t", 1)
        mode, kind, object_id = header.decode().split()
        name = raw_name.decode("utf-8")
        require(kind == "blob" and mode in ("100644", "100755"), "unsupported evaluator tree entry")
        path = relative_path(evaluator, name)
        require(path.is_file(), "missing evaluator tracked file")
        data = path.read_bytes()
        actual_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        require(actual_blob == object_id, "evaluator tracked bytes differ from HEAD: " + name)
        if os.name != "nt":
            require(bool(path.stat().st_mode & 0o111) == (mode == "100755"), "evaluator executable mode drift: " + name)
        records[name] = {"git_blob": object_id, "sha256": sha_bytes(data), "bytes": len(data), "mode": mode}
    require(records, "evaluator tracked tree is empty")
    return {"commit": head, "tree": _git(evaluator, "rev-parse", "HEAD^{tree}").decode().strip(),
            "files": records, "files_sha256": sha_bytes(json_bytes(records))}


def load_official(evaluator, tracked, runtime):
    python = runtime / "venv/bin/python"
    require(python.is_file() and Path(sys.executable).absolute() == python.absolute(),
            "invoke evaluator with the pinned runtime venv/bin/python")
    for name, module in list(sys.modules.items()):
        if name == "swebench" or name.startswith("swebench."):
            path = getattr(module, "__file__", None)
            require(path and Path(path).absolute().is_relative_to(evaluator), "foreign SWE-bench module already imported")
    sys.path.insert(0, str(evaluator))
    run_module = importlib.import_module("swebench.harness.run_evaluation")
    spec_module = importlib.import_module("swebench.harness.test_spec.test_spec")
    grading = importlib.import_module("swebench.harness.grading")
    constants = importlib.import_module("swebench.harness.constants")
    docker = importlib.import_module("docker")
    for name, module in list(sys.modules.items()):
        if name == "swebench" or name.startswith("swebench."):
            path = Path(module.__file__).absolute()
            require(path.is_relative_to(evaluator), "SWE-bench module outside pinned tree")
            rel = path.relative_to(evaluator).as_posix()
            require(rel in tracked["files"] and sha(path) == tracked["files"][rel]["sha256"],
                    "imported evaluator module is not a pinned tracked source")
    return SimpleNamespace(
        make_specs=spec_module.get_test_specs_from_dataset,
        run_instance=run_module.run_instance,
        grade=grading.get_eval_report,
        resolution=grading.get_resolution_status,
        full_status=constants.ResolvedStatus.FULL.value,
        log_root=constants.RUN_EVALUATION_LOG_DIR,
        report_name=constants.LOG_REPORT,
        output_name=constants.LOG_TEST_OUTPUT,
        docker_client=lambda endpoint: docker.DockerClient(base_url=endpoint),
    )


class _NoneNetworkContainers:
    def __init__(self, base, images, events, expected_key, expected_id):
        self.base, self.images, self.events = base, images, events
        self.expected_key, self.expected_id = expected_key, expected_id

    def create(self, *args, **kwargs):
        require(not args, "unexpected positional container create contract")
        requested = kwargs.get("image")
        require(requested == self.expected_key, "official container image differs from spec")
        require(kwargs.get("network_mode") in (None, "none") and not kwargs.get("network")
                and not kwargs.get("networking_config"), "official evaluator requested network")
        require(self.images.get(requested).attrs.get("Id") == self.expected_id, "image tag changed before container creation")
        kwargs["network_mode"] = "none"
        # Pin creation to the inspected immutable image, retaining the original spec key in evidence.
        kwargs["image"] = self.expected_id
        event = {"operation": "containers.create", "requested_image": requested,
                 "effective_image": self.expected_id, "effective_network_mode": "none"}
        self.events.append(event)
        container = self.base.create(**kwargs)
        try:
            container.reload()
            event.update(container_id=container.id, observed_image=container.attrs.get("Image"),
                         observed_network_mode=container.attrs.get("HostConfig", {}).get("NetworkMode"))
            require(event["observed_image"] == self.expected_id and event["observed_network_mode"] == "none",
                    "container runtime differs from image/network contract")
        except Exception:
            container.remove(force=True)
            raise
        return container

    def __getattr__(self, name):
        return getattr(self.base, name)


class _NoneNetworkClient:
    def __init__(self, base, events, expected_key, expected_id):
        self.base = base
        self.containers = _NoneNetworkContainers(base.containers, base.images, events, expected_key, expected_id)

    def __getattr__(self, name):
        return getattr(self.base, name)


def bind_attempt(attempt, row, task, kind, verify_attempt):
    """Bind local row and sealed patch; preflight never acquires an agent identity."""
    if kind != "model":
        require(attempt is None, "gold/noop preflight must not depend on a model attempt")
        return None, None, (row["patch"].encode("utf-8") if kind == "gold" else b"")
    require(attempt is not None, "--attempt is required for model evaluation")
    verified = verify_attempt(attempt)
    binding = read_json(attempt / "attempt.json")
    require(verified.get("task") == task and binding.get("task") == task, "attempt/task mismatch")
    require(binding.get("task_sha256") == row_hash(row), "attempt/local dataset row hash mismatch")
    require(binding.get("upstream_base_commit") == row.get("base_commit"), "attempt/local base mismatch")
    if binding.get("schema") == "public-engineering-attempt/2":
        public = read_json(attempt / "task-public.json")
        require(public.get("dataset_revision") == DATASET_REVISION and public.get("dataset_row_sha256") == row_hash(row)
                and public.get("problem_statement") == row.get("problem_statement"), "public task/local row mismatch")
    patch = (attempt / "model.patch").read_bytes()
    require(sha_bytes(patch) == binding.get("patch_sha256"), "sealed model patch mismatch")
    return verified, binding, patch


def bind_image(spec, task, image_arg, info, binding):
    require(spec.instance_id == task and spec.instance_image_key == image_arg, "task/image specification mismatch")
    require(getattr(spec, "is_remote_image", False), "official instance image must be prebuilt and remote")
    image_id, digests = info.get("Id"), info.get("RepoDigests")
    require(isinstance(image_id, str) and image_id.startswith("sha256:") and HEX.fullmatch(image_id[7:]),
            "image ID unavailable")
    require(isinstance(digests, list) and digests and all(isinstance(d, str) and "@sha256:" in d
            and HEX.fullmatch(d.split("@sha256:")[-1]) for d in digests), "image repo digest unavailable")
    if binding is not None:
        require(binding.get("image_id") == image_id and set(binding.get("image_repo_digests") or []) == set(digests),
                "attempt image identity mismatch")


def _file_records(root):
    records = {}
    for path in sorted(root.rglob("*")):
        ordinary_path(path)
        if path.is_dir():
            continue
        require(path.is_file(), "unsupported evaluation artifact")
        name = path.relative_to(root).as_posix()
        if name != "manifest.json":
            records[name] = {"sha256": sha(path), "bytes": path.stat().st_size}
    return records


def seal_output(output):
    records = _file_records(output)
    manifest = {"schema": "public-swebench-artifacts/2", "files": records,
                "files_sha256": sha_bytes(json_bytes(records))}
    write_json(output / "manifest.json", manifest)
    return sha(output / "manifest.json")


def verify_evaluation(output):
    output = ordinary_path(output)
    manifest = read_json(ordinary_path(output / "manifest.json"))
    require(manifest.get("schema") == "public-swebench-artifacts/2" and isinstance(manifest.get("files"), dict),
            "evaluation manifest schema")
    for name, record in manifest["files"].items():
        path = relative_path(output, name)
        require(path.is_file() and record == {"sha256": sha(path), "bytes": path.stat().st_size},
                "evaluation artifact mismatch: " + name)
    require(manifest["files"] == _file_records(output)
            and manifest["files_sha256"] == sha_bytes(json_bytes(manifest["files"])), "evaluation file set mismatch")
    require({"receipt.json", "result.json", "network-runtime.json", "prediction.patch",
             "dataset-row.json", "evaluator-tree.json", "expected-eval.sh"} <= set(manifest["files"]),
            "missing required evaluation artifact")
    return manifest


def _outcome(official, spec, prediction, raw_result, log_dir, script, patch, kind):
    require(isinstance(raw_result, dict) and type(raw_result.get("completed")) is bool
            and type(raw_result.get("resolved")) is bool, "official run result schema")
    paths = {"report": log_dir / official.report_name, "script": log_dir / "eval.sh",
             "test_output": log_dir / official.output_name, "patch": log_dir / "patch.diff"}
    for key in ("script", "patch"):
        if paths[key].exists():
            ordinary_path(paths[key])
            require(paths[key].read_bytes() == (script if key == "script" else patch),
                    "official " + key + " differs from frozen input")
    missing = [key for key, path in paths.items() if not path.is_file()]
    if not raw_result["completed"]:
        require(not raw_result["resolved"], "incomplete official execution claims resolved")
        return {"completed": False, "resolved": False, "official_resolved": False,
                "tests_status": None, "measurement": "not-measured", "missing_artifacts": missing}, paths
    require(not missing, "completed official run missing artifacts: " + ", ".join(missing))
    report = read_json(ordinary_path(paths["report"]))
    regenerated = official.grade(test_spec=spec, prediction=prediction, test_log_path=paths["test_output"],
                                 include_tests_status=True)
    require(report == regenerated, "official report does not match regraded raw output")
    require(set(report) == {spec.instance_id}, "official report task mismatch")
    entry = report[spec.instance_id]
    require(type(entry.get("resolved")) is bool and entry["resolved"] == raw_result["resolved"],
            "resolved status contradicts official tests")
    tests = entry.get("tests_status")
    coverage = {}
    if tests is not None:
        require(isinstance(tests, dict), "official tests status schema")
        for name in ("FAIL_TO_PASS", "PASS_TO_PASS"):
            group = tests.get(name)
            require(isinstance(group, dict) and set(group) == {"success", "failure"}
                    and all(isinstance(group[x], list) and all(isinstance(t, str) for t in group[x])
                            for x in ("success", "failure")), "official test group schema")
            members = group["success"] + group["failure"]
            require(len(set(members)) == len(members) and set(members) <= set(getattr(spec, name)),
                    "official report has foreign/duplicate tests")
            coverage[name] = {"status": "measured" if members and set(members) == set(getattr(spec, name)) else "not-measured",
                              "success": len(group["success"]), "failure": len(group["failure"]),
                              "expected": len(getattr(spec, name))}
        derived = official.resolution(tests) == official.full_status
        require(derived == entry["resolved"], "resolution does not derive from official test status")
    else:
        require(not entry["resolved"], "resolved report lacks test status")
    resolved = entry["resolved"] and (kind != "model" or bool(patch.strip()))
    return {"completed": True, "resolved": resolved, "official_resolved": entry["resolved"],
            "tests_status": tests, "test_coverage": coverage, "measurement": "measured",
            "missing_artifacts": []}, paths


def evaluate(args, *, official_loader=load_official, verify_attempt=None):
    if verify_attempt is None:
        from verify import verify as verify_attempt
    runtime, dataset = Path(args.runtime).absolute(), ordinary_path(args.dataset)
    output = ordinary_path(args.output, allow_missing=True)
    attempt = ordinary_path(args.attempt) if args.attempt else None
    require(args.kind in ("model", "gold", "noop"), "invalid evaluation kind")
    require(not output.exists(), "output must be a fresh directory")
    if attempt:
        require(not output.is_relative_to(attempt) and not attempt.is_relative_to(output),
                "evaluation output must be outside agent attempt")
    dataset_digest = sha(dataset)
    row = load_row(dataset, args.task)
    verified, binding, patch = bind_attempt(attempt, row, args.task, args.kind, verify_attempt)
    evaluator = ordinary_path(runtime / "src/SWE-bench")
    before = tracked_tree(evaluator)
    official = official_loader(evaluator, before, runtime)
    specs = official.make_specs([row], namespace="swebench")
    require(len(specs) == 1, "official spec coverage")
    spec = specs[0]
    # Explicit daemon selection: ambient DOCKER_HOST must not select a different host.
    endpoint = "unix://" + str(runtime / "docker.sock")
    client = official.docker_client(endpoint)
    image_info = client.images.get(args.image).attrs
    bind_image(spec, args.task, args.image, image_info, binding)
    script = spec.eval_script.encode("utf-8")
    label = ("public-model-" + binding["model"] + "-" + binding["arm"]) if binding else "public-preflight-" + args.kind
    require(re.fullmatch(r"[A-Za-z0-9_.-]+", label), "unsafe prediction label")
    prediction = {"instance_id": args.task, "model_name_or_path": label, "model_patch": patch.decode("utf-8")}
    run_id = "local-" + args.kind
    log_root = Path(official.log_root)
    require(not log_root.is_absolute() and ".." not in log_root.parts, "official log path escapes output")
    log_dir = output / log_root / run_id / label / args.task
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "dataset-row.json", row)
    write_json(output / "evaluator-tree.json", before)
    (output / "prediction.patch").write_bytes(patch)
    (output / "expected-eval.sh").write_bytes(script)
    (output / "evaluation-driver.py").write_bytes(Path(__file__).read_bytes())
    write_json(output / "prediction.json", prediction)
    network_events, failure = [], None
    wrapped = _NoneNetworkClient(client, network_events, spec.instance_image_key, image_info["Id"])
    previous_cwd = Path.cwd()
    raw_result = None
    try:
        os.chdir(output)
        raw_result = official.run_instance(spec, prediction, rm_image=False, force_rebuild=False,
                                          client=wrapped, run_id=run_id, timeout=900)
        write_json(output / "official-result.json", raw_result)
        require(len(network_events) == 1 and network_events[0].get("observed_network_mode") == "none"
                and network_events[0].get("observed_image") == image_info["Id"], "official container runtime not observed")
        result, paths = _outcome(official, spec, prediction, raw_result, log_dir, script, patch, args.kind)
        require(tracked_tree(evaluator) == before, "evaluator changed during execution")
        require(sha(dataset) == dataset_digest and row_hash(read_json(output / "dataset-row.json")) == row_hash(row),
                "local dataset changed during evaluation")
        if binding:
            after = verify_attempt(attempt)
            require(after.get("manifest_sha256") == verified.get("manifest_sha256")
                    and (attempt / "model.patch").read_bytes() == patch, "attempt changed during evaluation")
        require((output / "prediction.patch").read_bytes() == patch and spec.eval_script.encode("utf-8") == script,
                "frozen prediction/script changed")
        write_json(output / "result.json", result)
        artifact_bindings = {name: {"status": "recorded", "path": path.relative_to(output).as_posix(), "sha256": sha(path)}
                             if path.is_file() else {"status": "not-produced", "path": path.relative_to(output).as_posix(), "sha256": None}
                             for name, path in paths.items()}
        receipt = {"schema": "public-swebench-evaluation/2", "kind": args.kind, "task": args.task,
                   "evidence_class": "public-model-evaluation" if binding else "official-preflight",
                   "model": binding["model"] if binding else None, "provider": binding["provider"] if binding else None,
                   "arm": binding["arm"] if binding else None, "verified_attempt": verified,
                   "attempt_sha256": sha(attempt / "attempt.json") if binding else None,
                   "evaluator_commit": EVALUATOR_COMMIT, "evaluator_version": EVALUATOR_VERSION,
                   "evaluator_tree": before["tree"], "evaluator_files_sha256": before["files_sha256"],
                   "dataset_revision": DATASET_REVISION if binding and binding["schema"].endswith("/2") else "not-independently-verified",
                   "dataset_row_sha256": row_hash(row), "dataset_sha256": dataset_digest,
                   "image": args.image, "image_id": image_info["Id"], "image_repo_digests": image_info["RepoDigests"],
                   "result": result, "result_sha256": sha(output / "result.json"), "artifacts": artifact_bindings,
                   "prediction_patch_sha256": sha_bytes(patch), "official_eval_script_sha256": sha_bytes(script),
                   "evaluation_driver_sha256": sha(output / "evaluation-driver.py"),
                   "network_mode": "none", "wrapper": "container creation network_mode=none; immutable inspected image ID",
                   "release_assurance": bool(verified and verified.get("release_assurance")),
                   "task_success_eligible": bool(binding and verified.get("success_eligible") and result["resolved"])}
        write_json(output / "receipt.json", receipt)
    except Exception as error:
        failure = error
        write_json(output / "failure.json", {"schema": "public-evaluation-failure/1", "type": type(error).__name__, "reason": str(error)})
    finally:
        os.chdir(previous_cwd)
        write_json(output / "network-runtime.json", {
            "schema": "public-evaluator-network/1", "network_mode": "none",
            "test_script_modified": False, "daemon_endpoint": "runtime/docker.sock", "events": network_events})
        if hasattr(client, "close"):
            client.close()
        seal_output(output)
    if failure:
        raise failure
    verify_evaluation(output)
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--attempt", type=Path)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--kind", choices=("gold", "noop", "model"), required=True)
    receipt = evaluate(parser.parse_args())
    print(json.dumps(receipt, ensure_ascii=False))
    return 0 if receipt["result"]["resolved"] else (1 if receipt["result"]["completed"] else 2)


if __name__ == "__main__":
    raise SystemExit(main())
