"""Orchestration fixtures only; no model execution or benchmark outcome claims."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import evaluate_task as evaluator
from test_verify import AttemptFixture


class FakeImage:
    def __init__(self, info):
        self.attrs = copy.deepcopy(info)


class FakeImages:
    def __init__(self, info):
        self.info = info
        self.requested = []

    def get(self, image):
        self.requested.append(image)
        return FakeImage(self.info)


class FakeContainer:
    def __init__(self, image, mode):
        self.id = "fake-official-container"
        self.attrs = {"Image": image, "HostConfig": {"NetworkMode": mode}}
        self.removed = False

    def reload(self):
        pass

    def remove(self, force=False):
        self.removed = True


class FakeContainers:
    def __init__(self):
        self.calls = []
        self.observed_mode = None
        self.last = None

    def create(self, **kwargs):
        self.calls.append(kwargs)
        self.last = FakeContainer(kwargs["image"], self.observed_mode or kwargs["network_mode"])
        return self.last


class FakeClient:
    def __init__(self, info):
        self.images = FakeImages(info)
        self.containers = FakeContainers()
        self.closed = False

    def close(self):
        self.closed = True


class OfficialFixture:
    """Independent fake official API; grades its captured test-output record."""
    log_root = Path("logs/run_evaluation")
    report_name = "report.json"
    output_name = "test_output.txt"
    full_status = "FULL"

    def __init__(self, image, info):
        self.image = image
        self.client = FakeClient(info)
        self.make_calls = []
        self.run_calls = []
        self.endpoint = None
        self.test_fails = False
        self.missing_p2p = False
        self.incomplete = False
        self.report_lies = False
        self.mutate_script = False
        self.mutate_patch = False
        self.no_report = False
        self.during_run = None
        self.network_request = None
        self.after_spec = None

    def docker_client(self, endpoint):
        self.endpoint = endpoint
        return self.client

    def make_specs(self, rows, namespace):
        self.make_calls.append((copy.deepcopy(rows), namespace))
        row = rows[0]
        spec = SimpleNamespace(instance_id=row["instance_id"], instance_image_key=self.image,
                               is_remote_image=True, eval_script="#!/bin/bash\n# untouched official fixture\necho tests\n",
                               FAIL_TO_PASS=row["FAIL_TO_PASS"], PASS_TO_PASS=row["PASS_TO_PASS"])
        if self.after_spec:
            self.after_spec(spec)
        return [spec]

    def resolution(self, tests):
        return self.full_status if not tests["FAIL_TO_PASS"]["failure"] and not tests["PASS_TO_PASS"]["failure"] else "NO"

    def grade(self, *, test_spec, prediction, test_log_path, include_tests_status):
        assert include_tests_status
        tests = json.loads(Path(test_log_path).read_bytes())
        return {test_spec.instance_id: {"resolved": self.resolution(tests) == self.full_status,
                                       "patch_exists": True, "patch_successfully_applied": True,
                                       "patch_is_None": False, "tests_status": tests}}

    def run_instance(self, spec, prediction, *, rm_image, force_rebuild, client, run_id, timeout):
        self.run_calls.append(copy.deepcopy(prediction))
        assert not rm_image and not force_rebuild and timeout == 900
        kwargs = {"image": spec.instance_image_key, "name": "fixture", "command": "tail -f /dev/null"}
        if self.network_request:
            kwargs["network_mode"] = self.network_request
        client.containers.create(**kwargs)
        root = self.log_root / run_id / prediction["model_name_or_path"] / spec.instance_id
        root.mkdir(parents=True)
        (root / "run_instance.log").write_bytes(b"official lifecycle trace\n")
        (root / "patch.diff").write_bytes((prediction["model_patch"] + ("tampered" if self.mutate_patch else "")).encode())
        if self.incomplete:
            return {"completed": False, "resolved": False}
        (root / "eval.sh").write_bytes((spec.eval_script + ("# altered" if self.mutate_script else "")).encode())
        tests = {
            "FAIL_TO_PASS": {"success": [] if self.test_fails else list(spec.FAIL_TO_PASS),
                             "failure": list(spec.FAIL_TO_PASS) if self.test_fails else []},
            "PASS_TO_PASS": {"success": [] if self.missing_p2p else list(spec.PASS_TO_PASS), "failure": []},
            "FAIL_TO_FAIL": {"success": [], "failure": []}, "PASS_TO_FAIL": {"success": [], "failure": []},
        }
        (root / "test_output.txt").write_bytes(json.dumps(tests).encode())
        report = self.grade(test_spec=spec, prediction=prediction, test_log_path=root / "test_output.txt",
                            include_tests_status=True)
        if self.report_lies:
            report[spec.instance_id]["resolved"] = not report[spec.instance_id]["resolved"]
        if not self.no_report:
            (root / "report.json").write_bytes(json.dumps(report).encode())
        if self.during_run:
            self.during_run()
        return {"completed": True, "resolved": report[spec.instance_id]["resolved"]}


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.attempt = AttemptFixture(self.root / "attempt")
        self.runtime = self.root / "runtime"
        self.source = self.runtime / "src/SWE-bench"
        self.source.mkdir(parents=True)
        self.git("init", "-q")
        self.git("config", "user.name", "Test Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.autocrlf", "false")
        (self.source / "grader.py").write_bytes(b"# pinned fake grader source\n")
        self.git("add", "grader.py")
        self.git("commit", "-qm", "Pinned evaluator fixture")
        head = self.git("rev-parse", "HEAD").decode().strip()
        self.addCleanup(patch.stopall)
        patch.object(evaluator, "EVALUATOR_COMMIT", head).start()
        self.row = {"instance_id": self.attempt.task["instance_id"], "repo": "sample/project",
                    "version": "1", "base_commit": "a" * 40, "problem_statement": self.attempt.issue,
                    "patch": "diff --git a/sample.py b/sample.py\n# gold patch\n", "test_patch": "# protected test patch",
                    "FAIL_TO_PASS": ["test_new"], "PASS_TO_PASS": ["test_existing"]}
        self.dataset = self.root / "selected-dataset.json"
        self.dataset.write_bytes(json.dumps([self.row]).encode())
        row_hash = evaluator.row_hash(self.row)
        self.attempt.mutate("task-public.json", lambda t: t.update(dataset_row_sha256=row_hash))
        self.attempt.mutate("attempt.json", lambda t: t.update(task_sha256=row_hash))
        self.attempt.rebind()
        self.attempt.seal()
        self.image = "swebench/sweb.eval.x86_64.sample_1776_project-123:latest"
        self.image_info = {"Id": "sha256:" + "1" * 64, "RepoDigests": ["swebench/sample@sha256:" + "2" * 64]}
        self.official = OfficialFixture(self.image, self.image_info)
        self.args = SimpleNamespace(attempt=self.attempt.root, dataset=self.dataset, task=self.row["instance_id"],
                                    runtime=self.runtime, output=self.root / "evaluation", image=self.image, kind="model")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.source), *args], capture_output=True, check=True).stdout

    def evaluate(self):
        return evaluator.evaluate(self.args, official_loader=lambda source, tracked, runtime: self.official)

    def failure(self, reason):
        with self.assertRaisesRegex((ValueError, FileNotFoundError), reason):
            self.evaluate()

    def test_full_model_evaluation_binds_raw_official_artifacts_and_local_row(self):
        with patch.dict(os.environ, {"DOCKER_HOST": "tcp://wrong-host:2375"}):
            result = self.evaluate()
        self.assertEqual(self.official.make_calls, [([self.row], "swebench")])
        self.assertEqual(self.official.endpoint, "unix://" + str(self.runtime / "docker.sock"))
        self.assertTrue(result["result"]["completed"])
        self.assertTrue(result["result"]["resolved"])
        self.assertEqual(result["model"], "gpt-5.6-terra")
        self.assertEqual(result["provider"], "zeo-dev")
        self.assertEqual(result["arm"], "B0")
        self.assertTrue(result["task_success_eligible"])
        manifest = evaluator.verify_evaluation(self.args.output)
        for name in ("receipt.json", "result.json", "prediction.patch", "network-runtime.json",
                     "dataset-row.json", "expected-eval.sh", "evaluator-tree.json", "evaluation-driver.py"):
            self.assertIn(name, manifest["files"])
        self.assertEqual((self.args.output / "prediction.patch").read_bytes(),
                         (self.attempt.root / "model.patch").read_bytes())
        network = evaluator.read_json(self.args.output / "network-runtime.json")
        self.assertEqual(network["events"][0]["observed_network_mode"], "none")
        self.assertEqual(self.official.client.containers.calls[0]["image"], self.image_info["Id"])
        self.assertTrue(self.official.client.closed)

    def test_completed_failed_tests_stay_unresolved(self):
        self.official.test_fails = True
        result = self.evaluate()
        self.assertTrue(result["result"]["completed"])
        self.assertFalse(result["result"]["resolved"])
        self.assertFalse(result["task_success_eligible"])

    def test_incomplete_evaluation_seals_failure_and_missing_artifacts(self):
        self.official.incomplete = True
        result = self.evaluate()
        self.assertFalse(result["result"]["completed"])
        self.assertFalse(result["result"]["resolved"])
        self.assertEqual(result["result"]["measurement"], "not-measured")
        self.assertIn("report", result["result"]["missing_artifacts"])
        evaluator.verify_evaluation(self.args.output)

    def test_gold_preflight_never_borrows_model_or_arm_identity(self):
        self.args.attempt = None
        self.args.kind = "gold"
        result = self.evaluate()
        self.assertEqual(result["evidence_class"], "official-preflight")
        self.assertIsNone(result["model"])
        self.assertIsNone(result["provider"])
        self.assertIsNone(result["arm"])
        self.assertIsNone(result["verified_attempt"])
        self.assertFalse(result["task_success_eligible"])
        self.assertEqual(self.official.run_calls[0]["model_patch"], self.row["patch"])

    def test_noop_preflight_writes_exact_empty_prediction(self):
        self.args.attempt = None
        self.args.kind = "noop"
        result = self.evaluate()
        self.assertEqual((self.args.output / "prediction.patch").read_bytes(), b"")
        self.assertEqual(result["evidence_class"], "official-preflight")

    def test_preflight_with_model_attempt_is_rejected(self):
        self.args.kind = "gold"
        self.failure("preflight must not depend")
        self.assertFalse(self.args.output.exists())

    def test_wrong_task_argument_rejected_before_official_execution(self):
        self.args.task = "another__project-42"
        extra = {**self.row, "instance_id": self.args.task}
        self.dataset.write_bytes(json.dumps([self.row, extra]).encode())
        self.failure("attempt/task mismatch")
        self.assertFalse(self.official.run_calls)

    def test_local_row_change_rejected_even_if_task_id_matches(self):
        self.row["test_patch"] = "# altered oracle"
        self.dataset.write_bytes(json.dumps([self.row]).encode())
        self.failure("row hash mismatch")
        self.assertFalse(self.official.run_calls)

    def test_duplicate_local_task_is_rejected(self):
        self.dataset.write_bytes(json.dumps([self.row, self.row]).encode())
        self.failure("exactly one local row")

    def test_spec_image_and_actual_image_cannot_differ(self):
        self.args.image = "swebench/wrong:latest"
        self.failure("task/image specification mismatch")

    def test_docker_image_identity_cannot_differ_from_attempt(self):
        self.official.client.images.info["Id"] = "sha256:" + "8" * 64
        self.failure("attempt image identity mismatch")

    def test_docker_image_repo_digest_cannot_differ_from_attempt(self):
        self.official.client.images.info["RepoDigests"] = ["swebench/sample@sha256:" + "9" * 64]
        self.failure("attempt image identity mismatch")

    def test_model_patch_changed_after_verification_is_rejected(self):
        def mutate_patch():
            (self.attempt.root / "model.patch").write_bytes(b"tampered patch")
        self.official.during_run = mutate_patch
        self.failure("artifact mismatch")
        self.assertTrue((self.args.output / "failure.json").is_file())

    def test_dirty_tracked_evaluator_is_rejected_before_run(self):
        (self.source / "grader.py").write_bytes(b"tampered")
        self.failure("checkout is dirty")

    def test_assume_unchanged_cannot_hide_evaluator_byte_changes(self):
        self.git("update-index", "--assume-unchanged", "grader.py")
        (self.source / "grader.py").write_bytes(b"tampered")
        self.failure("tracked bytes differ from HEAD")
        self.assertFalse(self.official.run_calls)

    def test_pinned_head_drift_rejected(self):
        patch.object(evaluator, "EVALUATOR_COMMIT", "f" * 40).start()
        self.failure("not the pinned")

    def test_evaluator_mutation_during_official_run_is_rejected(self):
        self.official.during_run = lambda: (self.source / "grader.py").write_bytes(b"changed")
        self.failure("checkout is dirty")

    def test_report_forgery_is_rejected_by_regrading_output(self):
        self.official.report_lies = True
        self.failure("does not match regraded raw output")

    def test_completed_without_report_is_rejected(self):
        self.official.no_report = True
        self.failure("completed official run missing artifacts")

    def test_official_script_modification_is_rejected(self):
        self.official.mutate_script = True
        self.failure("official script differs from frozen input")

    def test_official_prediction_patch_modification_is_rejected(self):
        self.official.mutate_patch = True
        self.failure("official patch differs from frozen input")

    def test_container_network_override_is_rejected(self):
        self.official.network_request = "bridge"
        self.failure("requested network")

    def test_runtime_network_mismatch_is_rejected_and_container_removed(self):
        self.official.client.containers.observed_mode = "bridge"
        self.failure("runtime differs")
        self.assertTrue(self.official.client.containers.last.removed)

    def test_sealed_official_output_tampering_is_detected(self):
        self.evaluate()
        receipt = evaluator.read_json(self.args.output / "receipt.json")
        output_path = self.args.output / receipt["artifacts"]["test_output"]["path"]
        output_path.write_bytes(b"rewritten")
        with self.assertRaisesRegex(ValueError, "artifact mismatch"):
            evaluator.verify_evaluation(self.args.output)

    def test_missing_regression_measurement_is_explicit(self):
        self.official.missing_p2p = True
        result = self.evaluate()
        self.assertEqual(result["result"]["test_coverage"]["PASS_TO_PASS"]["status"], "not-measured")

    def test_existing_output_is_preserved_and_rejected(self):
        self.args.output.mkdir()
        sentinel = self.args.output / "keep.txt"
        sentinel.write_bytes(b"untouched")
        self.failure("fresh directory")
        self.assertEqual(sentinel.read_bytes(), b"untouched")

    def test_output_cannot_put_oracle_files_inside_agent_attempt(self):
        self.args.output = self.attempt.root / "official"
        self.failure("outside agent attempt")
        self.assertFalse(self.args.output.exists())


if __name__ == "__main__":
    unittest.main()
