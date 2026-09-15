import tempfile
from pathlib import Path
import sys
import unittest

from workspace_snapshot import executable_identity, workspace_compliance, workspace_snapshot


class WorkspaceEvidenceTests(unittest.TestCase):
    def test_new_modified_deleted_and_file_type_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "existing").write_text("old")
            before = workspace_snapshot(root)
            knowledge = root / ".agents/knowledge/guides/new.md"
            knowledge.parent.mkdir(parents=True)
            knowledge.write_text("new unwanted capture")
            self.assertFalse(workspace_compliance(before, workspace_snapshot(root), "no-capture-code")["pass"])
            knowledge.unlink()
            before = workspace_snapshot(root)
            (root / "existing").write_text("changed")
            self.assertFalse(workspace_compliance(before, workspace_snapshot(root))["pass"])
            self.assertTrue(workspace_compliance(before, workspace_snapshot(root), "no-capture-code")["pass"])
            (root / "existing").unlink()
            self.assertFalse(workspace_compliance(before, workspace_snapshot(root))["pass"])
            (root / "existing").mkdir()
            self.assertEqual(workspace_snapshot(root)["existing"]["type"], "directory")

    def test_narrow_allowlist_does_not_hide_new_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "runtime.json").write_text("first")
            before = workspace_snapshot(root, ("runtime.json",))
            (root / "runtime.json").write_text("second")
            self.assertEqual(before, workspace_snapshot(root, ("runtime.json",)))
            (root / ".hidden").write_text("violation")
            self.assertNotEqual(before, workspace_snapshot(root, ("runtime.json",)))
            with self.assertRaises(ValueError):
                workspace_snapshot(root, ("../escape",))

    def test_actual_binary_version_and_digest(self):
        identity = executable_identity(Path(sys.executable))
        self.assertIn("Python", identity["revision"])
        self.assertEqual(len(identity["executable_sha256"]), 64)
        self.assertEqual(executable_identity(Path("no-such-executable"))["revision"], "unavailable")

    def test_symlink_is_recorded_without_reading_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / "external"
            external.mkdir()
            (external / "sentinel").write_text("do not read through link")
            workspace = root / "workspace"
            workspace.mkdir()
            try:
                (workspace / "link").symlink_to(external, target_is_directory=True)
            except OSError:
                self.skipTest("symlink creation privilege unavailable")
            snapshot = workspace_snapshot(workspace)
            self.assertEqual(list(snapshot), ["link"])
            self.assertEqual(snapshot["link"]["type"], "link")


if __name__ == "__main__":
    unittest.main()
