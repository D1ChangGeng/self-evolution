"""Protocol-only fixtures: these are never benchmark outcome evidence."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from verify import verify


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    return digest(path.read_bytes())


class AttemptFixture:
    """A complete independent producer fixture for the public evidence contract."""
    runner_names = ("run_task.py", "provider_gateway.py", "sandbox_transport.py",
                    "probe_sandbox.py", "prepare-arm.mjs", "POLICY.md")

    def __init__(self, root):
        self.root = root
        root.mkdir()
        self.issue = "Correct the return value for the public sample.\n"
        self.task = {"schema": "public-engineering-task/1", "instance_id": "sample__project-123",
                     "base_commit": "a" * 40, "problem_statement": self.issue,
                     "dataset_row_sha256": "d" * 64,
                     "dataset_revision": "c104f840cc67f8b6eec6f759ebc8b2693d585d4a"}
        self.write_json("task-public.json", self.task)
        self.arm = {"schema": "engineering-arm/2", "arm": "B0", "name": "no-memory",
                    "capability": "available", "subject_sha256": None, "experiment": "end-to-end",
                    "history_files_offered": [], "reference": None, "subject_files": {},
                    "isolation": {"project": "per-attempt", "host_home": "per-session",
                                  "host_cache": "per-session", "sandbox": "requires-harness-probe",
                                  "memory": "real CLI support must be verified before model use"}}
        self.write_json("arm-result.json", self.arm)
        initial = {"sample.py": {"kind": "file", "sha256": digest(b"value = 0\n"), "bytes": 10}}
        final = {"sample.py": {"kind": "file", "sha256": digest(b"value = 1\n"), "bytes": 10}}
        for name, value in (("initial-snapshot.json", initial), ("upstream-base-snapshot.json", initial),
                            ("final-snapshot.json", final), ("git-status.json", {"initial": initial, "final": final})):
            self.write_json(name, value)
        self.write("model.patch", b"diff --git a/sample.py b/sample.py\n--- a/sample.py\n+++ b/sample.py\n@@ -1 +1 @@\n-value = 0\n+value = 1\n")
        for name in self.runner_names:
            self.write("runner/" + name, ("# Frozen protocol test fixture: " + name + "\n").encode())
        self.probe = {"workspace_write": True, "root_write_denied": True, "coordinator_not_mounted": True,
                      "docker_socket_not_mounted": True, "host_mount_not_visible": True,
                      "provider_secret_not_in_environment": True, "external_network_denied": True,
                      "inference_socket_present": True}
        for index in range(2):
            start = 10 + index * 20
            prefix = f"session-{index}"
            prompt = ("Implement the issue.\n" if not index else "Review the previous process files.\n") + self.issue
            self.write(prefix + "/prompt.txt", prompt.encode())
            self.write_json(prefix + "/before.json", initial if index == 0 else final)
            self.write_json(prefix + "/after.json", final)
            request = {"model": "gpt-5.6-terra", "reasoning": {"effort": "medium"},
                       "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
                       "tools": [{"type": "function", "name": "shell", "parameters": {"type": "object"}},
                                 {"type": "custom", "name": "apply_patch"}], "stream": True}
            self.write_json(prefix + "/inference/request-000.json", request)
            self.write_json(prefix + "/inference/forwarded-000.json", {**request, "max_output_tokens": 8192})
            usage = {"input_tokens": 100 + index, "output_tokens": 10,
                     "input_tokens_details": {"cached_tokens": 40, "cache_write_tokens": 0},
                     "output_tokens_details": {"reasoning_tokens": 2}}
            self.set_response(index, usage=usage)
            self.write_json(prefix + "/inference/receipt-000.json", {
                "sequence": 0, "model": "gpt-5.6-terra", "status": 200,
                "request_sha256": file_digest(root / prefix / "inference/request-000.json"),
                "started_at": start + 1, "finished_at": start + 5, "usage": usage})
            cli_usage = {"input_tokens": 100 + index, "output_tokens": 10,
                         "cached_input_tokens": 40, "cache_write_input_tokens": 0, "reasoning_output_tokens": 2}
            message = "Changed sample.py and ran its available checks." if not index else "Reviewed the existing change."
            events = [self.probe, {"type": "thread.started", "thread_id": f"test-thread-{index}"},
                      {"type": "turn.started"},
                      {"type": "item.completed", "item": {"type": "agent_message", "text": message}},
                      {"type": "turn.completed", "usage": cli_usage}]
            self.set_cli(index, events)
            self.write(prefix + "/stderr.log", b"")
            self.write(prefix + "/container-diff.txt", b"")
            self.write(prefix + "/final.txt", message.encode())
            self.write_json(prefix + "/receipt.json", {
                "session": index, "container_id": str(index + 1) * 64, "launcher_pid": 1000 + index,
                "started_at": start, "finished_at": start + 10, "status": "completed", "exit_code": 0,
                "usage": cli_usage, "sandbox_probe": self.probe,
                "prompt_sha256": file_digest(root / prefix / "prompt.txt"),
                "model": "gpt-5.6-terra", "provider": "zeo-dev"})
        self.write_json("attempt.json", {
            "schema": "public-engineering-attempt/2", "task": self.task["instance_id"], "arm": "B0", "attempt": 1,
            "upstream_base_commit": "a" * 40, "image_head_commit": "b" * 40,
            "upstream_base_tree": "c" * 40, "local_base_commit": "d" * 40, "configured_base_commit": "e" * 40,
            "task_sha256": "d" * 64, "image_id": "sha256:" + "1" * 64,
            "image_repo_digests": ["swebench/sample@sha256:" + "2" * 64],
            "subject_sha256": None, "codex_sha256": "3" * 64, "code_mode_host_sha256": "4" * 64,
            "codex_version": "0.152.1", "model": "gpt-5.6-terra", "provider": "zeo-dev",
            "reasoning_effort": "medium", "started_at": 0, "finished_at": 50,
            "official_evaluation": "pending"})
        self.rebind()
        self.seal()

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def write_json(self, name, value):
        self.write(name, (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode())

    def read_json(self, name):
        return json.loads((self.root / name).read_bytes())

    def mutate(self, name, action):
        value = self.read_json(name)
        action(value)
        self.write_json(name, value)

    def rebind(self):
        """Rebind file hashes without repairing semantic identity or assertions."""
        result = self.read_json("attempt.json")
        for field, name in {
            "patch_sha256": "model.patch", "initial_snapshot_sha256": "initial-snapshot.json",
            "final_snapshot_sha256": "final-snapshot.json", "upstream_snapshot_sha256": "upstream-base-snapshot.json",
            "arm_result_sha256": "arm-result.json", "task_public_sha256": "task-public.json",
            "policy_sha256": "runner/POLICY.md",
        }.items():
            if (self.root / name).exists():
                result[field] = file_digest(self.root / name)
        result["sessions"] = [self.read_json(f"session-{i}/receipt.json") for i in range(2)]
        result["session_receipt_sha256"] = [file_digest(self.root / f"session-{i}/receipt.json") for i in range(2)]
        self.write_json("attempt.json", result)

    def seal(self):
        files = {p.relative_to(self.root).as_posix(): file_digest(p) for p in self.root.rglob("*")
                 if p.is_file() and p.name != "manifest.json"}
        self.write_json("manifest.json", {"schema": "public-engineering-artifacts/1", "files": files})

    def set_cli(self, index, events):
        self.write(f"session-{index}/stdout.jsonl", ("\n".join(json.dumps(e) for e in events) + "\n").encode())

    def cli(self, index):
        return [json.loads(line) for line in (self.root / f"session-{index}/stdout.jsonl").read_text().splitlines()]

    def set_response(self, index, usage=None, model="gpt-5.6-terra", response_id=None):
        response = {"id": response_id or f"response-test-{index}", "model": model,
                    "usage": usage, "status": "completed"}
        self.write(f"session-{index}/inference/response-000.sse",
                   ("data: " + json.dumps({"type": "response.completed", "response": response}) + "\n\n").encode())

    def http_failure(self, index):
        prefix = f"session-{index}"
        (self.root / prefix / "inference/response-000.sse").unlink()
        self.mutate(prefix + "/inference/receipt-000.json", lambda g: (g.update(status=503), g.pop("usage")))
        self.mutate(prefix + "/receipt.json", lambda r: r.update(status="process-error", exit_code=1, usage=None))
        self.set_cli(index, [self.probe, {"type": "thread.started", "thread_id": f"test-thread-{index}"},
                             {"type": "turn.failed", "error": {"message": "HTTP 503"}}])
        self.write(prefix + "/stderr.log", b"HTTP 503\n")
        self.write(prefix + "/final.txt", b"")
        self.rebind()
        self.seal()

    def legacy(self):
        result = self.read_json("attempt.json")
        result["schema"] = "public-engineering-attempt/1"
        for name in ("task_public_sha256", "arm_result_sha256", "upstream_snapshot_sha256", "reasoning_effort"):
            result.pop(name)
        self.write_json("attempt.json", result)
        (self.root / "task-public.json").unlink()
        shutil.rmtree(self.root / "runner")
        self.mutate("arm-result.json", lambda a: a.pop("subject_files"))
        self.seal()


class VerifyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.fixture = AttemptFixture(Path(self.temp.name) / "attempt")
        self.root = self.fixture.root

    def rejects(self, pattern):
        with self.assertRaisesRegex((ValueError, FileNotFoundError), pattern):
            verify(self.root)

    def test_complete_v2_b0_null_subject_has_evidence_assurance_not_task_success(self):
        result = verify(self.root)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["assurance"], "verified")
        self.assertTrue(result["release_assurance"])
        self.assertTrue(result["success_eligible"])
        self.assertEqual(result["task_success"], "not-measured")
        self.assertEqual(result["usage"][0], {"input_tokens": 100, "output_tokens": 10,
                         "cached_input_tokens": 40, "cache_write_input_tokens": 0, "reasoning_output_tokens": 2})

    def test_legacy_complete_record_remains_official_scoring_diagnostic(self):
        self.fixture.legacy()
        result = verify(self.root)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["assurance"], "diagnostic/legacy")
        self.assertTrue(result["patch_present"])
        self.assertFalse(result["release_assurance"])
        self.assertFalse(result["success_eligible"])

    def test_http_failure_without_response_preserves_failed_evidence(self):
        self.fixture.http_failure(0)
        result = verify(self.root)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["session_statuses"], ["process-error", "completed"])
        self.assertEqual(result["unmeasured_requests"], 1)
        self.assertFalse(result["release_assurance"])
        self.assertFalse(result["success_eligible"])
        self.assertEqual(result["task_success"], "not-measured")

    def test_empty_patch_is_verified_but_not_success_eligible(self):
        self.fixture.write("model.patch", b"")
        self.fixture.rebind()
        self.fixture.seal()
        result = verify(self.root)
        self.assertEqual(result["status"], "verified")
        self.assertFalse(result["patch_present"])
        self.assertFalse(result["success_eligible"])

    def test_model_failure_with_completed_inference_is_not_reclassified_as_success(self):
        self.fixture.mutate("session-1/receipt.json", lambda r: r.update(status="process-error", exit_code=1))
        self.fixture.rebind()
        self.fixture.seal()
        result = verify(self.root)
        self.assertEqual(result["session_statuses"], ["completed", "process-error"])
        self.assertEqual(result["task_success"], "not-measured")

    def test_missing_required_artifact_after_reseal_is_rejected(self):
        (self.root / "session-1/stderr.log").unlink()
        self.fixture.seal()
        self.rejects("missing required artifacts")

    def test_each_frozen_runner_file_is_required(self):
        for name in AttemptFixture.runner_names:
            with self.subTest(name=name):
                path = self.root / "runner" / name
                content = path.read_bytes()
                path.unlink()
                self.fixture.seal()
                self.rejects("missing required artifacts")
                path.write_bytes(content)
        self.fixture.seal()

    def test_unknown_runner_artifact_is_rejected_even_when_hashed(self):
        self.fixture.write("runner/unreviewed.py", b"# not a permitted runner artifact\n")
        self.fixture.seal()
        self.rejects("unexpected evidence artifact")

    def test_policy_tampering_and_reseal_does_not_rebind_attempt(self):
        self.fixture.write("runner/POLICY.md", b"altered policy\n")
        self.fixture.seal()
        self.rejects("policy/runner binding")

    def test_arm_mismatch_is_rejected_after_rebinding_all_artifact_hashes(self):
        self.fixture.mutate("arm-result.json", lambda a: a.update(arm="B1", name="minimal-instructions"))
        self.fixture.rebind()
        self.fixture.seal()
        self.rejects("arm metadata")

    def test_forged_cli_usage_is_rejected_even_when_receipts_and_manifest_are_resealed(self):
        self.fixture.mutate("session-0/receipt.json", lambda r: r["usage"].update(input_tokens=999))
        events = self.fixture.cli(0)
        events[-1]["usage"]["input_tokens"] = 999
        self.fixture.set_cli(0, events)
        self.fixture.rebind()
        self.fixture.seal()
        self.rejects("not derived from raw events")

    def test_gateway_usage_must_match_actual_response_event(self):
        self.fixture.mutate("session-0/inference/receipt-000.json", lambda r: r["usage"].update(output_tokens=9))
        self.fixture.seal()
        self.rejects("gateway usage receipt mismatch")

    def test_container_and_pid_replay_are_rejected(self):
        original = self.fixture.read_json("session-1/receipt.json")
        previous = self.fixture.read_json("session-0/receipt.json")
        for key in ("container_id", "launcher_pid"):
            with self.subTest(key=key):
                altered = {**original, key: previous[key]}
                self.fixture.write_json("session-1/receipt.json", altered)
                self.fixture.rebind()
                self.fixture.seal()
                self.rejects("session replay")
        self.fixture.write_json("session-1/receipt.json", original)

    def test_deleted_http_success_response_is_rejected(self):
        (self.root / "session-0/inference/response-000.sse").unlink()
        self.fixture.seal()
        self.rejects("successful gateway response missing")

    def test_forwarded_reasoning_and_hosted_tools_cannot_change(self):
        name = "session-0/inference/forwarded-000.json"
        original = self.fixture.read_json(name)
        for change, error in (({"reasoning": {"effort": "high"}}, "provider request identity"),
                              ({"tools": [{"type": "web_search"}]}, "hosted tool"),
                              ({"model": "different-model"}, "provider request identity")):
            with self.subTest(change=change):
                self.fixture.write_json(name, {**original, **change})
                self.fixture.seal()
                self.rejects(error)

    def test_response_from_other_model_is_rejected(self):
        usage = self.fixture.read_json("session-0/inference/receipt-000.json")["usage"]
        self.fixture.set_response(0, usage, model="different-model")
        self.fixture.seal()
        self.rejects("response model mismatch")

    def test_snapshot_chain_replay_is_rejected_after_reseal(self):
        self.fixture.write_json("session-1/before.json", self.fixture.read_json("initial-snapshot.json"))
        self.fixture.seal()
        self.rejects("workspace snapshot binding")

    def test_public_issue_identity_is_not_repaired_by_resealing(self):
        self.fixture.mutate("task-public.json", lambda t: t.update(instance_id="different__project-9"))
        self.fixture.rebind()
        self.fixture.seal()
        self.rejects("public task binding")

    def test_unlisted_extra_file_is_rejected(self):
        self.fixture.write("extra.txt", b"extra")
        self.rejects("file set mismatch")

    def test_manifest_cannot_use_traversal_or_absolute_alias(self):
        original = self.fixture.read_json("manifest.json")
        for name in ("../outside.json", "/outside.json", "session-0/../attempt.json", r"..\outside.json"):
            with self.subTest(name=name):
                altered = copy.deepcopy(original)
                altered["files"][name] = "f" * 64
                self.fixture.write_json("manifest.json", altered)
                self.rejects("unsafe artifact path")

    def test_manifest_duplicate_json_key_is_rejected(self):
        self.fixture.write("manifest.json", b'{"schema":"public-engineering-artifacts/1","files":{},"files":{}}')
        self.rejects("duplicate JSON key")

    def test_ancestor_symlink_is_rejected_before_content_is_read(self):
        real = self.root / "session-original"
        session = self.root / "session-0"
        session.rename(real)
        try:
            session.symlink_to(real, target_is_directory=True)
        except OSError:
            real.rename(session)
            self.skipTest("symlink privilege unavailable; also run on Linux")
        self.rejects("ancestor symlink")

    def test_malformed_sse_after_transport_failure_cannot_be_swallowed(self):
        self.fixture.http_failure(0)
        self.fixture.mutate("session-0/inference/receipt-000.json", lambda r: r.update(status="transport-error"))
        self.fixture.write("session-0/inference/response-000.sse", b"data: {not-json}\n\n")
        self.fixture.seal()
        self.rejects("malformed response event")

    def test_negative_usage_cannot_be_resealed_as_valid_measurement(self):
        usage = self.fixture.read_json("session-0/inference/receipt-000.json")["usage"]
        usage["input_tokens"] = -1
        self.fixture.set_response(0, usage)
        self.fixture.mutate("session-0/inference/receipt-000.json", lambda r: r.update(usage=usage))
        self.fixture.seal()
        self.rejects("invalid token count")

    def test_complete_b5_uses_subject_modules_canonical_digest(self):
        # Use the actual independent producer module, not verify's helper.
        subject_files = {"SKILL.md": "a" * 64, "references/bin/kb.mjs": "b" * 64,
                         "agents/openai.yaml": "c" * 64}
        contract_uri = (Path(__file__).resolve().parents[2] / "contract.mjs").as_uri()
        script = "import{stableJson}from " + json.dumps(contract_uri) + ";import{createHash}from'node:crypto';import{readFileSync}from'node:fs';process.stdout.write(createHash('sha256').update(stableJson(JSON.parse(readFileSync(0,'utf8')))).digest('hex'));"
        result = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(subject_files).encode(),
                                capture_output=True, check=True)
        subject_sha = result.stdout.decode()
        self.fixture.mutate("arm-result.json", lambda a: a.update(arm="B5", name="self-evolution-candidate",
                            subject_files=subject_files, subject_sha256=subject_sha, reference=".agents/knowledge/index.yaml"))
        self.fixture.mutate("attempt.json", lambda r: r.update(arm="B5", subject_sha256=subject_sha))
        self.fixture.rebind()
        self.fixture.seal()
        self.assertTrue(verify(self.root)["release_assurance"])
        self.fixture.mutate("arm-result.json", lambda a: a["subject_files"].update({"SKILL.md": "f" * 64}))
        self.fixture.rebind()
        self.fixture.seal()
        self.rejects("subject digest")


if __name__ == "__main__":
    unittest.main()
