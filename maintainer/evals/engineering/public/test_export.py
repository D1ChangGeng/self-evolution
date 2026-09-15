import argparse, pathlib, json, tempfile, sys, unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from run_task import export_patch

class ExportTests(unittest.TestCase):
    def test_agent_git_configuration_cannot_run_on_coordinator(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d); base=root/'base'; project=root/'project'
            base.mkdir();project.mkdir()
            for p in (base,project):
                (p/'source.py').write_text('print(1)\n')
                (p/'source.py').chmod(0o755)
            (project/'.git').mkdir()
            (project/'.git/config').write_text('[core]\nfsmonitor = touch '+str(root/'escaped')+'\n')
            (project/'source.py').write_text('print(2)\n')
            (project/'new.bin').write_bytes(b'\0abc')
            output=export_patch(base,project,root/'export')
            self.assertNotIn(b'old mode',output)
            self.assertIn(b'GIT binary patch',output)
            self.assertFalse((root/'escaped').exists())

if __name__=='__main__':
    unittest.main()
