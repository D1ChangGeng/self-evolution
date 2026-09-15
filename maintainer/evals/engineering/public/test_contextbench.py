import importlib.util
import json
import pathlib
import tempfile
import unittest


HERE = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("contextbench", HERE / "contextbench.py")
contextbench = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(contextbench)


def row(identifier, repo="example/repo"):
    return {
        "instance_id": identifier, "repo": repo, "base_commit": "a" * 40,
        "environment_setup_commit": "b" * 40, "problem_statement": "public issue",
        "patch": "diff --git a/a b/a\n", "test_patch": "diff --git a/t b/t\n",
        "FAIL_TO_PASS": "[\"test_x\"]", "PASS_TO_PASS": "[\"test_y\"]",
    }


class ContextBenchTests(unittest.TestCase):
    def test_image_tag_follows_official_evaluator_convention(self):
        self.assertEqual(contextbench.image_tag("sympy__sympy-19484"),
                         "jiayuanz3/swecontextbench:sympy.sympy-19484")
        self.assertEqual(contextbench.image_tag("sympy__sympy-19487", "experience"),
                         "swebench/sweb.eval.x86_64.sympy_1776_sympy-19487:latest")

    def test_manifest_rejects_cross_repository_pair(self):
        original = contextbench.PAIRS
        contextbench.PAIRS = (("one__one-1", "two__two-2"),)
        try:
            with tempfile.TemporaryDirectory() as root:
                selected = pathlib.Path(root) / "rows.jsonl"
                selected.write_text("\n".join(json.dumps(item) for item in (
                    {"which": "experience", **row("one__one-1", "one/one")},
                    {"which": "related", **row("two__two-2", "two/two")},
                )))
                rows = contextbench.load_selected_rows(selected)
                with self.assertRaisesRegex(ValueError, "cross-repository"):
                    contextbench.make_manifest(rows, selected)
        finally:
            contextbench.PAIRS = original

    def test_dispatch_requires_continuation_only_for_related_treatment(self):
        original = contextbench.PAIRS
        contextbench.PAIRS = (("one__one-1", "one__one-2"),)
        try:
            with tempfile.TemporaryDirectory() as root:
                selected = pathlib.Path(root) / "rows.jsonl"
                selected.write_text("\n".join(json.dumps(item) for item in (
                    {"which": "experience", **row("one__one-1")},
                    {"which": "related", **row("one__one-2")},
                )))
                rows = contextbench.load_selected_rows(selected)
                manifest = contextbench.make_manifest(rows, selected)
                dispatch = contextbench.make_dispatch(manifest, pathlib.Path("rows.json"))
                treatments = [x for x in dispatch["attempts"] if x["stage"] == "related-treatment"]
                controls = [x for x in dispatch["attempts"] if x["stage"] == "related-control"]
                self.assertTrue(treatments)
                self.assertTrue(all(x["continuation"] == "required-from-matching-experience-attempt" for x in treatments))
                self.assertTrue(all(x["continuation"] is None for x in controls))
        finally:
            contextbench.PAIRS = original


if __name__ == "__main__":
    unittest.main()
