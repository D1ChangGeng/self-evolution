#!/usr/bin/env python3
"""Package only committed Skill/usage/license bytes; verify in a clean tree."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import zipfile


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root)


def package(root, output, ref="HEAD"):
    commit = git(root, "rev-parse", "--verify", ref + "^{commit}").decode().strip()
    package_json = json.loads(git(root, "show", commit + ":package.json"))
    version = package_json["version"]
    files = git(root, "ls-tree", "-r", "--name-only", "-z", commit, "skills/self-evolution").decode().split("\0")
    payload = {}
    for path in filter(None, files):
        relative = PurePosixPath(path).relative_to("skills/self-evolution")
        payload["self-evolution/" + str(relative)] = git(root, "show", commit + ":" + path)
    for path in ["LICENSE", "README.md", "docs/MIGRATION.md", "docs/ARCHITECTURE.md", "docs/USAGE-GUIDE.md", "docs/HARNESS-INTEGRATION.md", "docs/OPTIONAL-ADAPTERS.md"]:
        payload["self-evolution/" + path] = git(root, "show", commit + ":" + path)
    payload["self-evolution/RELEASE.json"] = (json.dumps({"version": version, "commit": commit, "stage": "release-candidate" if "-rc." in version else "stable"}, indent=2) + "\n").encode()
    output.mkdir(parents=True, exist_ok=True)
    target = output / ("self-evolution-v" + version + ".zip")
    if target.exists():
        raise FileExistsError("Use a new output directory for the release package")
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, content in sorted(payload.items()):
            info = zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    with tempfile.TemporaryDirectory(prefix="self-evolution-package-") as temporary:
        location = Path(temporary)
        with zipfile.ZipFile(target) as archive:
            assert set(archive.namelist()) == set(payload)
            archive.extractall(location)
        cli = location / "self-evolution/references/bin/kb.mjs"
        project = location / "project"
        project.mkdir()
        for command in ["init", "index", "check"]:
            subprocess.run(["node", str(cli), command, "--project-root", str(project)], check=True, capture_output=True)
        assert len([p for p in project.rglob("*") if p.is_file()]) == 3
    checksum = hashlib.sha256(target.read_bytes()).hexdigest()
    (output / "SHA256SUMS").write_text(checksum + "  " + target.name + "\n", encoding="utf8")
    inventory = {"schema": "release-package/1", "commit": commit, "version": version, "zip": target.name, "sha256": checksum,
                 "files": {p: hashlib.sha256(v).hexdigest() for p, v in sorted(payload.items())}}
    (output / "package-manifest.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf8")
    return inventory


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ref", default="HEAD")
    args = parser.parse_args()
    result = package(Path.cwd(), args.output.resolve(), args.ref)
    print(json.dumps({k: v for k, v in result.items() if k != "files"}, indent=2))
