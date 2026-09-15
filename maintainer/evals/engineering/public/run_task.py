"""Execute one public task using Codex in the official task image.

The coordinator has evaluator data. Only issue text and the materialized base
are mounted into agent containers; final evaluation is a separate operation.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid

from provider_gateway import serve

HERE = Path(__file__).resolve().parent
MODEL = "gpt-5.6-terra"
DATASET_REVISION = "c104f840cc67f8b6eec6f759ebc8b2693d585d4a"
FEATURES = ("apps", "browser_use", "computer_use", "image_generation", "memories",
            "multi_agent", "multi_agent_v2", "plugins", "remote_plugin", "skill_search",
            "shell_snapshot", "hooks", "workspace_dependencies")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def command(argv, **kwargs):
    return subprocess.run([str(x) for x in argv], check=True, capture_output=True, **kwargs)


def snapshot(root):
    files = {}
    for path in sorted(Path(root).rglob("*")):
        rel = path.relative_to(root).as_posix()
        if rel == ".git" or rel.startswith(".git/"):
            continue
        if path.is_symlink():
            files[rel] = {"kind": "symlink", "target": os.readlink(path)}
        elif path.is_file():
            files[rel] = {"kind": "file", "sha256": digest(path.read_bytes()), "bytes": path.stat().st_size}
    return files


def export_patch(base, project, destination):
    """Use new coordinator-owned Git metadata; never read agent Git config."""
    git_env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    git_env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null")
    shutil.copytree(base, destination, symlinks=True, ignore=shutil.ignore_patterns(".git"))
    def git(*args):
        return command(["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
                        "-c", "core.attributesFile=/dev/null", "-C", destination, *args], env=git_env)
    git("init", "-b", "export")
    git("config", "user.email", "benchmark@example.invalid")
    git("config", "user.name", "Benchmark")
    git("add", "-A")
    git("commit", "-qm", "Configured source baseline")
    for item in destination.iterdir():
        if item.name == ".git":
            continue
        if item.is_symlink() or item.is_file():
            item.unlink()
        else:
            shutil.rmtree(item)
    for item in project.iterdir():
        if item.name == ".git":
            continue
        target = destination / item.name
        if item.is_symlink():
            target.symlink_to(os.readlink(item))
        elif item.is_dir():
            shutil.copytree(item, target, symlinks=True, ignore=shutil.ignore_patterns(".git"))
        elif item.is_file():
            shutil.copy2(item, target)
        else:
            raise RuntimeError("Unsupported agent-created special file")
    git("add", "-N", ".")
    result = subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
                             "-c", "core.attributesFile=/dev/null", "-C", str(destination),
                             "diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"],
                            check=False, capture_output=True, env=git_env)
    if result.returncode not in (0, 1):
        raise RuntimeError(f"safe patch export failed: {result.returncode}")
    return result.stdout


def unix_ready(path, timeout=10):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if Path(path).exists():
            return
        time.sleep(.05)
    raise RuntimeError("inference gateway did not start")


def run(args):
    root = Path(args.runtime).resolve()
    attempt = Path(args.output).resolve()
    attempt.mkdir(parents=True, exist_ok=False)
    data = json.loads(Path(args.dataset).read_text())
    row = next(r for r in data if r["instance_id"] == args.task)
    row_digest = digest(json.dumps(row, sort_keys=True).encode())
    save(attempt / "task-public.json", {
        "schema": "public-engineering-task/1", "instance_id": args.task,
        "base_commit": row["base_commit"], "problem_statement": row["problem_statement"],
        "dataset_row_sha256": row_digest, "dataset_revision": DATASET_REVISION,
    })
    frozen_runtime = attempt / "runner"
    frozen_runtime.mkdir()
    for name in ("run_task.py", "provider_gateway.py", "sandbox_transport.py", "probe_sandbox.py", "prepare-arm.mjs", "POLICY.md"):
        shutil.copy2(HERE / name, frozen_runtime / name)
    docker = root / "toolchain/docker/docker"
    env = {**os.environ, "DOCKER_HOST": "unix://" + str(root / "docker.sock"),
           "DOCKER_CONFIG": str(root / "docker-client")}
    started = time.time()
    image = args.image
    image_info = json.loads(command([docker, "image", "inspect", image], env=env).stdout)[0]
    project = attempt / "project"
    project.mkdir()
    source = command([docker, "create", "--network=none", image, "/bin/true"], env=env).stdout.decode().strip()
    try:
        # docker cp streams only the upstream source, not protected evaluator data.
        command([docker, "cp", source + ":/testbed/.", project], env=env)
    finally:
        command([docker, "rm", source], env=env)
    gitdir = project / ".git"
    if not gitdir.is_dir() or gitdir.is_symlink():
        raise RuntimeError("Expected isolated base checkout with ordinary .git")
    upstream_head = command(["git", "-C", project, "rev-parse", "HEAD"]).stdout.decode().strip()
    image_tree = command(["git", "-C", project, "rev-parse", "HEAD^{tree}"]).stdout.decode().strip()
    base_tree = command(["git", "-C", project, "rev-parse", row["base_commit"] + "^{tree}"]).stdout.decode().strip()
    if image_tree != base_tree:
        raise RuntimeError("Official image source tree differs from declared task base")
    if upstream_head != row["base_commit"]:
        command(["git", "-C", project, "checkout", "--detach", row["base_commit"]])
    # This is a newly created private task copy, never the user's repository.
    shutil.rmtree(gitdir)
    command(["git", "init", "-b", "benchmark", project])
    command(["git", "-C", project, "config", "user.email", "benchmark@example.invalid"])
    command(["git", "-C", project, "config", "user.name", "Benchmark"])
    command(["git", "-C", project, "add", "-A"])
    command(["git", "-C", project, "commit", "-qm", "Public benchmark base snapshot"])
    local_base = command(["git", "-C", project, "rev-parse", "HEAD"]).stdout.decode().strip()
    save(attempt / "upstream-base-snapshot.json", snapshot(project))
    command(["node", HERE / "prepare-arm.mjs", args.arm, attempt, args.repo])
    arm = json.loads((attempt / "arm-result.json").read_text())
    if arm["capability"] != "available":
        raise RuntimeError("Requested native arm is unavailable")
    save(attempt / "initial-snapshot.json", snapshot(project))
    command(["git", "-C", project, "add", "-A"])
    command(["git", "-C", project, "commit", "--allow-empty", "-qm", "Configured experimental arm"])
    configured_base = command(["git", "-C", project, "rev-parse", "HEAD"]).stdout.decode().strip()
    protected_base = attempt / "protected-base"
    shutil.copytree(project, protected_base, symlinks=True, ignore=shutil.ignore_patterns(".git"))
    binary = root / "toolchain/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"
    code_mode_host = binary.parent / "codex-code-mode-host"
    node = Path("/usr/local/lib/nodejs/node-v24.18.1-linux-x64/bin/node")
    if not binary.is_file() or not code_mode_host.is_file():
        raise RuntimeError("Pinned Codex binary not installed")
    config = json.loads(Path(args.provider_config).read_text())
    key = os.environ.get(config["env_key"])
    if not key:
        raise RuntimeError("Authorized provider credential is unavailable")
    sessions = []
    gateway_threads = []
    common = (
        "Resolve the issue below in the existing repository. Inspect relevant source and ordinary tests, "
        "make a focused implementation, and run appropriate available checks. Preserve existing architecture, "
        "public interfaces, tests, and unrelated files. Do not change project permissions or dependency "
        "configuration to work around the task. Network access is unavailable. The repository is /testbed; "
        "Python is available in /opt/miniconda3/envs/testbed/bin. "
        "You have at most 5 minutes in this process. Report the actual changes and verification.\n\n"
    )
    if args.sessions != 2:
        raise ValueError("Exactly two fresh Codex sessions are required")
    for index in range(2):
        session = attempt / f"session-{index}"
        session.mkdir()
        home = session / "home"
        home.mkdir()
        initial_home = attempt / "arm/host-home"
        if (initial_home / "skills").exists():
            shutil.copytree(initial_home / "skills", home / "skills")
        (home / "config.toml").write_text(
            'model = "gpt-5.6-terra"\nmodel_provider = "zeo-dev"\nmodel_reasoning_effort = "medium"\n'
            'approval_policy = "never"\nweb_search = "disabled"\n'
            '[model_providers.zeo-dev]\nname = "Zeo Dev"\nwire_api = "responses"\n'
            'base_url = "http://127.0.0.1:18080/v1"\nrequires_openai_auth = false\n'
            'request_max_retries = 0\nstream_max_retries = 0\n'
            '[features]\n' + "\n".join(f'{name} = false' for name in FEATURES) + "\n")
        socket_path = Path("/tmp") / f"se-gateway-{os.getpid()}-{index}.sock"
        thread = threading.Thread(target=serve, args=(socket_path, session / "inference", config["base_url"], key, 48, 300), daemon=True)
        thread.start()
        gateway_threads.append(thread)
        unix_ready(socket_path)
        prefix = common
        if index:
            prefix = (
                "Continue this engineering task from the current files left by a previous process. "
                "Review the existing changes, correct any remaining issue, and rerun relevant checks. "
                "Historical verification may be stale. " + common
            )
        prompt = prefix + row["problem_statement"]
        (session / "prompt.txt").write_text(prompt)
        save(session / "before.json", snapshot(project))
        name = "sebench-" + uuid.uuid4().hex[:16]
        uid = os.getuid()
        mounts = [
            f"{project}:/testbed:rw", f"{home}:/home/agent/.codex:rw",
            f"{binary}:/toolchain/codex:ro", f"{node}:/toolchain/node:ro",
            f"{code_mode_host}:/toolchain/codex-code-mode-host:ro",
            f"{frozen_runtime / 'sandbox_transport.py'}:/harness/sandbox_transport.py:ro",
            f"{frozen_runtime / 'probe_sandbox.py'}:/harness/probe_sandbox.py:ro",
            f"{socket_path}:/inference/gateway.sock:ro",
        ]
        # Do not mount coordinator roots, datasets, official test patches, or credentials.
        launch = [docker, "create", "-i", "--name", name, "--network=none", "--cap-drop=ALL",
                  "--security-opt=no-new-privileges", "--read-only", "--pids-limit=256",
                  "--memory=4g", "--cpus=2", "--user", f"{uid}:{os.getgid()}",
                  "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m,mode=1777",
                  "--tmpfs", "/home/agent:rw,nosuid,nodev,size=128m,mode=1777",
                  "--workdir=/testbed", "-e", "HOME=/home/agent", "-e", "CODEX_HOME=/home/agent/.codex",
                  "-e", "PATH=/toolchain:/opt/miniconda3/envs/testbed/bin:/opt/miniconda3/bin:/usr/local/bin:/usr/bin:/bin",
                  "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", "PYTHONPATH=/testbed"]
        for mount in mounts:
            launch += ["-v", mount]
        script = (
            "python /harness/probe_sandbox.py || exit 91\n"
            "python /harness/sandbox_transport.py >/tmp/transport.log 2>&1 &\n"
            "/toolchain/codex exec --ephemeral --json --dangerously-bypass-approvals-and-sandbox "
            "--skip-git-repo-check -C /testbed -\n"
        )
        launch += [image, "/bin/bash", "-c", script]
        cid = command(launch, env=env).stdout.decode().strip()
        session_started = time.time()
        with (session / "stdout.jsonl").open("wb") as out, (session / "stderr.log").open("wb") as err:
            proc = subprocess.Popen([str(docker), "start", "-ai", name], stdin=subprocess.PIPE, stdout=out, stderr=err, env=env)
            try:
                proc.communicate(prompt.encode(), timeout=310)
                stop = "completed" if proc.returncode == 0 else "process-error"
            except subprocess.TimeoutExpired:
                command([docker, "kill", name], env=env)
                proc.communicate(timeout=15)
                stop = "time-limit"
        inspect = json.loads(command([docker, "inspect", name], env=env).stdout)[0]
        (session / "container-diff.txt").write_bytes(command([docker, "diff", name], env=env).stdout)
        command([docker, "rm", name], env=env)
        socket_path.unlink(missing_ok=True)
        save(session / "after.json", snapshot(project))
        trace = (session / "stdout.jsonl").read_text(errors="replace")
        usage = None
        messages = []
        probe = None
        for line in trace.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "workspace_write" in event:
                probe = event
            if event.get("type") == "turn.completed":
                usage = event.get("usage")
            if event.get("type") == "item.completed" and event.get("item", {}).get("type") == "agent_message":
                messages.append(event["item"]["text"])
        receipt = {
            "session": index, "container_id": cid, "launcher_pid": proc.pid,
            "started_at": session_started, "finished_at": time.time(), "status": stop,
            "exit_code": inspect["State"]["ExitCode"], "usage": usage, "sandbox_probe": probe,
            "prompt_sha256": digest(prompt.encode()), "model": MODEL, "provider": "zeo-dev",
        }
        save(session / "receipt.json", receipt)
        (session / "final.txt").write_text("\n\n".join(messages))
        sessions.append(receipt)
        # A second process still runs after a normal A failure, but no evaluator feedback enters it.
        if probe is None or not all(probe.values()):
            break
    final_snapshot = snapshot(project)
    patch = export_patch(protected_base, project, attempt / "patch-export")
    (attempt / "model.patch").write_bytes(patch)
    (attempt / "git-status.json").write_text(json.dumps({"initial": snapshot(protected_base), "final": final_snapshot}, sort_keys=True) + "\n")
    save(attempt / "final-snapshot.json", final_snapshot)
    binding = {
        "schema": "public-engineering-attempt/2", "task": args.task, "arm": args.arm,
        "attempt": args.attempt, "upstream_base_commit": row["base_commit"], "image_head_commit": upstream_head,
        "upstream_base_tree": base_tree, "local_base_commit": local_base,
        "configured_base_commit": configured_base,
        "task_sha256": row_digest, "image_id": image_info["Id"],
        "task_public_sha256": digest((attempt / "task-public.json").read_bytes()),
        "arm_result_sha256": digest((attempt / "arm-result.json").read_bytes()),
        "reasoning_effort": "medium",
        "upstream_snapshot_sha256": digest((attempt / "upstream-base-snapshot.json").read_bytes()),
        "image_repo_digests": image_info.get("RepoDigests"), "subject_sha256": arm.get("subject_sha256"),
        "codex_sha256": digest(binary.read_bytes()), "codex_version": "0.152.1", "model": MODEL,
        "code_mode_host_sha256": digest(code_mode_host.read_bytes()),
        "provider": "zeo-dev", "policy_sha256": digest((frozen_runtime / "POLICY.md").read_bytes()),
        "patch_sha256": digest(patch), "started_at": started, "finished_at": time.time(),
        "initial_snapshot_sha256": digest((attempt / "initial-snapshot.json").read_bytes()),
        "final_snapshot_sha256": digest((attempt / "final-snapshot.json").read_bytes()),
        "session_receipt_sha256": [digest((attempt / f"session-{i}/receipt.json").read_bytes()) for i in range(len(sessions))],
        "sessions": sessions, "official_evaluation": "pending",
    }
    save(attempt / "attempt.json", binding)
    artifacts = {}
    for path in attempt.rglob("*"):
        relative = path.relative_to(attempt).as_posix()
        if relative.split("/")[0] in ("project", "patch-export", "protected-base", "arm"):
            continue
        if path.is_file() and not path.is_symlink() and "/home/" not in relative:
            artifacts[relative] = digest(path.read_bytes())
    save(attempt / "manifest.json", {"schema": "public-engineering-artifacts/1", "files": artifacts})
    print(json.dumps({"task": args.task, "arm": args.arm, "sessions": len(sessions), "patch_bytes": len(patch), "output": str(attempt)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("runtime", "output", "dataset", "task", "image", "repo", "provider-config"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--arm", choices=["B0", "B1", "B2", "B3", "B4", "B5"], required=True)
    parser.add_argument("--attempt", type=int, default=1)
    parser.add_argument("--sessions", type=int, default=2)
    run(parser.parse_args())
