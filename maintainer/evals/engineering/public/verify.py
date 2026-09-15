"""Verify public-attempt evidence, never infer task success from process exit.

Version 1 remains usable for official diagnostic scoring, with no release
assurance. Version 2 requires the public task and canonical subject bindings.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess

MODEL = "gpt-5.6-terra"
REASONING = "medium"
LEGACY_SCHEMA = "public-engineering-attempt/1"
CURRENT_SCHEMA = "public-engineering-attempt/2"
MANIFEST_SCHEMA = "public-engineering-artifacts/1"
DATASET_REVISION = "c104f840cc67f8b6eec6f759ebc8b2693d585d4a"
HEX = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
REQUEST_FILE = re.compile(r"session-([01])/inference/(request|forwarded|receipt)-(\d{3})\.json\Z")
RESPONSE_FILE = re.compile(r"session-([01])/inference/response-(\d{3})\.sse\Z")
ROOT_FILES = {"attempt.json", "arm-result.json", "initial-snapshot.json",
              "final-snapshot.json", "upstream-base-snapshot.json", "model.patch", "git-status.json"}
RUNNER_FILES = {"runner/run_task.py", "runner/provider_gateway.py", "runner/sandbox_transport.py",
                "runner/probe_sandbox.py", "runner/prepare-arm.mjs", "runner/POLICY.md"}
SESSION_FILES = {"prompt.txt", "before.json", "after.json", "stdout.jsonl", "stderr.log",
                 "container-diff.txt", "receipt.json", "final.txt"}
EXCLUDED_ROOTS = {"project", "patch-export", "protected-base", "arm"}
PROBE_KEYS = {"workspace_write", "root_write_denied", "coordinator_not_mounted",
              "docker_socket_not_mounted", "host_mount_not_visible",
              "provider_secret_not_in_environment", "external_network_denied", "inference_socket_present"}
USAGE_KEYS = ("input_tokens", "output_tokens", "cached_input_tokens",
              "reasoning_output_tokens", "cache_write_input_tokens")
ARM_NAMES = {"B0": "no-memory", "B1": "minimal-instructions", "B2": "plain-markdown",
             "B3": "harness-native", "B4": "self-evolution-current", "B5": "self-evolution-candidate"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate JSON key: " + key)
        result[key] = value
    return result


def _json(text):
    return json.loads(text, object_pairs_hook=_pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non-finite JSON number")))


def _read(path):
    return _json(path.read_text(encoding="utf-8"))


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _hex(value):
    return isinstance(value, str) and HEX.fullmatch(value) is not None


def _integer(value, minimum=0):
    return type(value) is int and minimum <= value <= 2 ** 53 - 1


def _time(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _relative(name):
    _require(isinstance(name, str) and name and "\\" not in name and ":" not in name and "\x00" not in name,
             "unsafe artifact path")
    _require(not name.startswith("/") and all(p not in ("", ".", "..") for p in name.split("/")),
             "unsafe artifact path")
    return name.split("/")


def _no_link(path):
    info = path.lstat()
    _require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, "st_file_attributes", 0) & 1024),
             "artifact ancestor symlink/reparse: " + str(path))
    return info


def _safe_path(root, name):
    current = root
    for part in _relative(name):
        current /= part
        _no_link(current)
    return current


def _discover(root):
    """Scan the evidence domain; private working directories are not evidence."""
    found = set()

    def walk(directory):
        for path in directory.iterdir():
            rel = path.relative_to(root).as_posix()
            info = _no_link(path)
            if rel == "manifest.json":
                _require(stat.S_ISREG(info.st_mode), "manifest must be a regular file")
                continue
            if rel in EXCLUDED_ROOTS or rel in ("session-0/home", "session-1/home"):
                _require(stat.S_ISDIR(info.st_mode), "excluded workspace must be an ordinary directory")
                continue
            if rel in ("session-0/gateway.sock", "session-1/gateway.sock") and stat.S_ISSOCK(info.st_mode):
                continue  # Known legacy transport endpoint, never an evidence artifact.
            if stat.S_ISDIR(info.st_mode):
                _require(rel in ("session-0", "session-1", "session-0/inference", "session-1/inference", "runner"),
                         "unexpected evidence directory: " + rel)
                walk(path)
            elif stat.S_ISREG(info.st_mode):
                found.add(rel)
            else:
                raise ValueError("unsupported evidence entry: " + rel)
    walk(root)
    return found


def _subject_digest(files):
    # subject.mjs uses localeCompare('en'), not Python's codepoint sort.
    script = """
const fs=require('fs');
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>[k,stable(x)]));return v}
process.stdout.write(require('crypto').createHash('sha256').update(JSON.stringify(stable(JSON.parse(fs.readFileSync(0,'utf8'))),null,2)+'\\n').digest('hex'));
"""
    env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "NODE_PATH")}
    try:
        result = subprocess.run(["node", "--input-type=commonjs", "-e", script],
                                input=json.dumps(files, ensure_ascii=False).encode(), capture_output=True,
                                check=True, timeout=15, cwd=Path(__file__).parent, env=env)
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("canonical subject digest unavailable") from error
    return result.stdout.decode().strip()


def _snapshot(value):
    _require(isinstance(value, dict), "snapshot must be a file map")
    for name, entry in value.items():
        _relative(name)
        _require(isinstance(entry, dict), "snapshot entry")
        if entry.get("kind") == "file":
            _require(set(entry) == {"kind", "sha256", "bytes"} and _hex(entry["sha256"]) and _integer(entry["bytes"]),
                     "snapshot file digest/size")
        else:
            _require(entry.get("kind") == "symlink" and set(entry) == {"kind", "target"}
                     and isinstance(entry["target"], str), "snapshot link entry")
    return value


def _usage(raw, provider=False):
    _require(isinstance(raw, dict), "invalid raw usage")
    if provider:
        di, do = raw.get("input_tokens_details", {}), raw.get("output_tokens_details", {})
        _require(isinstance(di, dict) and isinstance(do, dict), "invalid usage details")
        values = {"input_tokens": raw.get("input_tokens"), "output_tokens": raw.get("output_tokens"),
                  "cached_input_tokens": di.get("cached_tokens", 0),
                  "cache_write_input_tokens": di.get("cache_write_tokens", 0),
                  "reasoning_output_tokens": do.get("reasoning_tokens", 0)}
    else:
        values = {k: raw.get(k, 0) for k in USAGE_KEYS}
        _require("input_tokens" in raw and "output_tokens" in raw, "missing token usage")
    _require(all(_integer(n) for n in values.values()), "invalid token count")
    _require(values["cached_input_tokens"] <= values["input_tokens"] and
             values["reasoning_output_tokens"] <= values["output_tokens"], "token detail exceeds total")
    return values


def _sse(path):
    events, payload = [], []
    # SSE event boundaries matter; multiline data records are valid.
    for line in path.read_text(encoding="utf-8", errors="strict").splitlines() + [""]:
        if line.startswith("data:"):
            payload.append(line[5:].lstrip(" "))
        elif not line and payload:
            text = "\n".join(payload)
            payload = []
            if text == "[DONE]":
                continue
            try:
                event = _json(text)
            except ValueError:
                raise ValueError("malformed response event")
            _require(isinstance(event, dict), "response event object")
            events.append(event)
    return events


def _response_usage(path):
    """Small public helper used by regression tests and read-only diagnosis."""
    usage = {k: 0 for k in USAGE_KEYS}
    completed = [e for e in _sse(path) if e.get("type") == "response.completed"]
    for event in completed:
        values = _usage(event.get("response", {}).get("usage"), provider=True)
        for key in usage:
            usage[key] += values[key]
    return usage, len(completed)


def _contract(request, forwarded=False):
    _require(isinstance(request, dict) and request.get("model") == MODEL and
             isinstance(request.get("reasoning"), dict) and request["reasoning"].get("effort") == REASONING,
             "provider request identity")
    tools = request.get("tools", [])
    _require(isinstance(tools, list) and all(isinstance(t, dict) and t.get("type") in ("function", "custom") for t in tools),
             "hosted tool outside fixed contract")
    limit = request.get("max_output_tokens")
    if limit is not None or forwarded:
        _require(_integer(limit, 1) and limit <= 16000, "forwarded output limit")


def _strings(value):
    if isinstance(value, str):
        yield value.replace("\r\n", "\n")
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _verify_session(root, index, receipt, files):
    session = root / f"session-{index}"
    _require(isinstance(receipt, dict) and _read(session / "receipt.json") == receipt, "receipt binding")
    _require(receipt.get("session") == index and _hex(receipt.get("container_id"))
             and _integer(receipt.get("launcher_pid"), 1), "session identity")
    _require(receipt.get("model") == MODEL and receipt.get("provider") == "zeo-dev", "session execution identity")
    _require(receipt.get("status") in ("completed", "process-error", "time-limit")
             and type(receipt.get("exit_code")) is int, "session outcome")
    _require(receipt["status"] != "completed" or receipt["exit_code"] == 0, "completed exit code")
    _require(_time(receipt.get("started_at")) and _time(receipt.get("finished_at"))
             and receipt["started_at"] <= receipt["finished_at"], "session timing")
    probe = receipt.get("sandbox_probe")
    _require(isinstance(probe, dict) and set(probe) == PROBE_KEYS and all(v is True for v in probe.values()), "isolation probe")
    _require(sha(session / "prompt.txt") == receipt.get("prompt_sha256"), "prompt binding")
    events = []
    for line in (session / "stdout.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            event = _json(line)
            _require(isinstance(event, dict), "CLI event object")
            events.append(event)
    probes = [e for e in events if "workspace_write" in e]
    _require(probes == [probe], "probe is not bound to raw trace")
    turns = [e for e in events if e.get("type") == "turn.completed"]
    _require(len(turns) <= 1, "duplicate completed turn")
    trace_usage = turns[0].get("usage") if turns else None
    _require(receipt.get("usage") == trace_usage, "CLI usage receipt mismatch")
    messages = [e["item"]["text"] for e in events if e.get("type") == "item.completed"
                and isinstance(e.get("item"), dict) and e["item"].get("type") == "agent_message"]
    _require((session / "final.txt").read_text(encoding="utf-8") == "\n\n".join(messages), "final text binding")
    prefix = f"session-{index}/inference/"
    sequences = sorted(int(n[len(prefix + 'request-'):-5]) for n in files if n.startswith(prefix + "request-"))
    _require(sequences == list(range(len(sequences))), "inference sequence coverage")
    _require(bool(sequences) or receipt["status"] != "completed", "completed session lacks inference evidence")
    expected, total, missing_usage = set(), {k: 0 for k in USAGE_KEYS}, 0
    response_ids = set()
    for number in sequences:
        stem = f"{prefix}{{}}-{number:03d}"
        req_name, fwd_name, rec_name = (stem.format(k) + ".json" for k in ("request", "forwarded", "receipt"))
        expected.update((req_name, fwd_name, rec_name))
        _require({req_name, fwd_name, rec_name} <= files, "inference artifact coverage")
        request, forwarded, gateway = (_read(root / n) for n in (req_name, fwd_name, rec_name))
        _contract(request)
        _contract(forwarded, forwarded=True)
        if number == 0:
            prompt = (session / "prompt.txt").read_text(encoding="utf-8")
            _require(any(prompt in text for text in _strings(request.get("input"))), "raw request prompt binding")
        _require({k: v for k, v in request.items() if k != "max_output_tokens"} ==
                 {k: v for k, v in forwarded.items() if k != "max_output_tokens"}, "forwarded request changed")
        _require(isinstance(gateway, dict) and gateway.get("sequence") == number
                 and gateway.get("request_sha256") == sha(root / req_name)
                 and gateway.get("model") == MODEL, "gateway request binding")
        if "forwarded_sha256" in gateway:
            _require(gateway["forwarded_sha256"] == sha(root / fwd_name), "forwarded digest")
        status = gateway.get("status")
        _require((type(status) is int and 100 <= status <= 599) or status == "transport-error", "gateway status")
        _require(_time(gateway.get("started_at")) and _time(gateway.get("finished_at"))
                 and receipt["started_at"] <= gateway["started_at"] <= gateway["finished_at"] <= receipt["finished_at"],
                 "gateway timing binding")
        response_name = stem.format("response") + ".sse"
        completed = []
        if response_name in files:
            expected.add(response_name)
            response_events = _sse(root / response_name)
            for event in response_events:
                response = event.get("response")
                if isinstance(response, dict) and response.get("model") is not None:
                    _require(response["model"] == MODEL, "response model mismatch")
            completed = [e for e in response_events if e.get("type") == "response.completed"]
        else:
            _require(not (type(status) is int and 200 <= status < 300), "successful gateway response missing")
        _require(len(completed) <= 1, "duplicate completed response")
        if completed:
            raw = completed[0].get("response", {})
            _require(raw.get("model") == MODEL and isinstance(raw.get("id"), str) and raw["id"], "response identity")
            _require(raw["id"] not in response_ids, "replayed response")
            response_ids.add(raw["id"])
            _require(gateway.get("usage") == raw.get("usage"), "gateway usage receipt mismatch")
            measured = _usage(raw.get("usage"), provider=True)
            for key in total:
                total[key] += measured[key]
        else:
            _require(gateway.get("usage") is None, "claimed usage lacks raw completion")
            missing_usage += 1
    actual = {name for name in files if name.startswith(prefix)}
    _require(actual == expected, "unexpected/orphan inference artifact")
    if trace_usage is not None:
        _require(not missing_usage and _usage(trace_usage) == total, "session usage is not derived from raw events")
    before, after = (_snapshot(_read(session / name)) for name in ("before.json", "after.json"))
    return {"before": before, "after": after, "usage": total, "requests": len(sequences),
            "unmeasured_requests": missing_usage, "response_ids": response_ids}


def _verify_identity(result, arm):
    _require(result.get("model") == MODEL and result.get("provider") == "zeo-dev"
             and result.get("codex_version") == "0.152.1", "execution identity")
    _require(result.get("arm") in ARM_NAMES and isinstance(result.get("task"), str)
             and re.fullmatch(r"[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+", result["task"])
             and _integer(result.get("attempt"), 1), "attempt identity")
    for key in ("upstream_base_commit", "image_head_commit", "upstream_base_tree", "local_base_commit", "configured_base_commit"):
        _require(isinstance(result.get(key), str) and COMMIT.fullmatch(result[key]), "missing commit identity: " + key)
    for key in ("task_sha256", "codex_sha256", "code_mode_host_sha256", "policy_sha256"):
        _require(_hex(result.get(key)), "missing execution digest: " + key)
    _require(isinstance(result.get("image_id"), str) and result["image_id"].startswith("sha256:")
             and _hex(result["image_id"][7:]), "image identity")
    digests = result.get("image_repo_digests")
    _require(isinstance(digests, list) and digests and all(isinstance(d, str) and "@sha256:" in d
             and _hex(d.split("@sha256:")[-1]) for d in digests), "image repo digest")
    _require(result.get("official_evaluation") == "pending", "attempt cannot claim official outcome")
    _require(isinstance(arm, dict) and arm.get("schema") == "engineering-arm/2"
             and arm.get("arm") == result["arm"] and arm.get("name") == ARM_NAMES[result["arm"]]
             and arm.get("capability") == "available" and arm.get("experiment") == "end-to-end"
             and arm.get("history_files_offered") == [], "arm metadata")
    _require(arm.get("subject_sha256") == result.get("subject_sha256"), "arm subject mismatch")
    if result["arm"] in ("B4", "B5"):
        _require(_hex(result.get("subject_sha256")), "missing subject identity")
    else:
        _require(result.get("subject_sha256") is None, "control subject identity")


def verify(root):
    root = Path(root).absolute()
    for ancestor in reversed((root, *root.parents)):
        _no_link(ancestor)
    _require(root.is_dir(), "attempt directory")
    manifest_path = _safe_path(root, "manifest.json")
    manifest = _read(manifest_path)
    _require(isinstance(manifest, dict) and set(manifest) == {"schema", "files"}
             and manifest["schema"] == MANIFEST_SCHEMA and isinstance(manifest["files"], dict), "manifest schema")
    files = set(manifest["files"])
    for name, digest in manifest["files"].items():
        path = _safe_path(root, name)
        _require(path.is_file() and _hex(digest) and sha(path) == digest, "artifact mismatch: " + name)
    _require(files == _discover(root), "manifest file set mismatch")
    required = ROOT_FILES | {f"session-{i}/{n}" for i in range(2) for n in SESSION_FILES}
    _require(required <= files, "missing required artifacts: " + ", ".join(sorted(required - files)))
    result, arm = _read(root / "attempt.json"), _read(root / "arm-result.json")
    _require(isinstance(result, dict) and result.get("schema") in (LEGACY_SCHEMA, CURRENT_SCHEMA), "attempt schema")
    current = result["schema"] == CURRENT_SCHEMA
    if current:
        required |= RUNNER_FILES | {"task-public.json"}
        _require(required <= files, "missing required artifacts: " + ", ".join(sorted(required - files)))
    allowed = required | ({"task-public.json"} if current else set())
    _require(all(n in allowed or REQUEST_FILE.fullmatch(n) or RESPONSE_FILE.fullmatch(n) for n in files),
             "unexpected evidence artifact")
    _verify_identity(result, arm)
    sessions = result.get("sessions")
    _require(isinstance(sessions, list) and len(sessions) == 2 and all(isinstance(s, dict) for s in sessions)
             and [s.get("session") for s in sessions] == [0, 1], "session coverage")
    _require(len({s.get("container_id") for s in sessions}) == 2
             and len({s.get("launcher_pid") for s in sessions}) == 2, "session replay")
    _require(result.get("session_receipt_sha256") == [sha(root / f"session-{i}/receipt.json") for i in range(2)],
             "receipt digest")
    checked = [_verify_session(root, i, sessions[i], files) for i in range(2)]
    _require(not (checked[0]["response_ids"] & checked[1]["response_ids"]), "cross-session response replay")
    _require(_time(result.get("started_at")) and _time(result.get("finished_at"))
             and result["started_at"] <= sessions[0]["started_at"] <= sessions[0]["finished_at"]
             <= sessions[1]["started_at"] <= sessions[1]["finished_at"] <= result["finished_at"], "attempt timing")
    initial = _snapshot(_read(root / "initial-snapshot.json"))
    final = _snapshot(_read(root / "final-snapshot.json"))
    _snapshot(_read(root / "upstream-base-snapshot.json"))
    _require(initial == checked[0]["before"] and final == checked[1]["after"]
             and checked[0]["after"] == checked[1]["before"], "workspace snapshot binding")
    _require(_read(root / "git-status.json") == {"initial": initial, "final": final}, "patch export snapshot binding")
    for key, name in (("initial_snapshot_sha256", "initial-snapshot.json"),
                      ("final_snapshot_sha256", "final-snapshot.json"), ("patch_sha256", "model.patch")):
        _require(result.get(key) == sha(root / name), "artifact binding: " + key)
    if current:
        _require("task-public.json" in files, "missing public task artifact")
        task = _read(root / "task-public.json")
        _require(isinstance(task, dict) and set(task) == {"schema", "instance_id", "base_commit", "problem_statement",
                 "dataset_row_sha256", "dataset_revision"}, "public task fields")
        _require(task["schema"] == "public-engineering-task/1" and task["instance_id"] == result["task"]
                 and task["base_commit"] == result["upstream_base_commit"] and task["dataset_row_sha256"] == result["task_sha256"]
                 and task["dataset_revision"] == DATASET_REVISION and isinstance(task["problem_statement"], str)
                 and task["problem_statement"].strip(), "public task binding")
        _require(all((root / f"session-{i}/prompt.txt").read_bytes().decode("utf-8").endswith(task["problem_statement"])
                     for i in range(2)), "issue prompt binding")
        _require(result.get("task_public_sha256") == sha(root / "task-public.json")
                 and result.get("arm_result_sha256") == sha(root / "arm-result.json")
                 and result.get("upstream_snapshot_sha256") == sha(root / "upstream-base-snapshot.json")
                 and result.get("reasoning_effort") == REASONING, "current evidence binding")
        _require(result.get("policy_sha256") == sha(root / "runner/POLICY.md"), "policy/runner binding")
        _require(not ({"project", "home", "cache"} & set(arm)), "public arm contains host paths")
        subject = arm.get("subject_files")
        _require(isinstance(subject, dict), "subject file manifest")
        for name, digest in subject.items():
            _relative(name)
            _require(_hex(digest), "subject file digest")
        if result["arm"] in ("B4", "B5"):
            _require("SKILL.md" in subject and "references/bin/kb.mjs" in subject
                     and _subject_digest(subject) == result["subject_sha256"], "subject digest")
        else:
            _require(subject == {} and result["subject_sha256"] is None, "control subject manifest")
    patch_present = bool((root / "model.patch").read_bytes().strip())
    if patch_present:
        _require(b"diff --git " in (root / "model.patch").read_bytes(), "not a Git patch")
    observed = [item["usage"] for item in checked]
    budget_exceeded = any(item["requests"] > 48 or item["usage"]["input_tokens"] > 500000
                          or item["usage"]["output_tokens"] > 16000 for item in checked)
    unmeasured = sum(item["unmeasured_requests"] for item in checked)
    release_assurance = current and not budget_exceeded and not unmeasured and all(item["requests"] for item in checked)
    return {"status": "verified", "assurance": "verified" if current else "diagnostic/legacy",
            "release_assurance": bool(release_assurance),
            "task": result["task"], "arm": result["arm"], "attempt": result["attempt"],
            "task_success": "not-measured", "patch_present": patch_present,
            "success_eligible": bool(release_assurance and patch_present),
            "session_statuses": [s["status"] for s in sessions], "usage": observed,
            "unmeasured_requests": unmeasured, "budget_exceeded": budget_exceeded,
            "manifest_sha256": sha(manifest_path)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root")
    print(json.dumps(verify(parser.parse_args().root), ensure_ascii=False))
