"""Read-only, no-follow controlled-tree evidence. No third-party dependencies."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import stat
import subprocess


def is_junction(path: Path) -> bool:
    return bool(getattr(path, "is_junction", lambda: False)())


def workspace_snapshot(root: Path, allowed_runtime_files: tuple[str, ...] = ()) -> dict:
    root = root.absolute()
    if root.is_symlink() or is_junction(root):
        raise ValueError("workspace root must not be a link")
    for path in allowed_runtime_files:
        if path.startswith("/") or "\\" in path or any(p in ("", ".", "..") for p in path.split("/")):
            raise ValueError("runtime allowlist accepts exact relative file paths only")
    result = {}

    def walk(directory: Path, prefix: str = "") -> None:
        for path in sorted(directory.iterdir(), key=lambda item: item.name):
            relative = prefix + path.name
            info = path.lstat()
            if path.is_symlink() or is_junction(path):
                result[relative] = {"type": "link", "target": os.readlink(path)}
            elif stat.S_ISDIR(info.st_mode):
                result[relative] = {"type": "directory"}
                walk(path, relative + "/")
            elif stat.S_ISREG(info.st_mode):
                if relative in allowed_runtime_files:
                    continue
                result[relative] = {"type": "file", "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "executable": bool(info.st_mode & stat.S_IXUSR)}
            else:
                result[relative] = {"type": "special", "mode": stat.S_IFMT(info.st_mode)}

    walk(root)
    return result


def snapshot_changes(before: dict, after: dict) -> list[dict]:
    return [{"path": path, "before": before.get(path), "after": after.get(path)}
            for path in sorted(set(before) | set(after)) if before.get(path) != after.get(path)]


def workspace_compliance(before: dict, after: dict, mode: str = "read-only") -> dict:
    changes = snapshot_changes(before, after)
    if mode not in ("read-only", "no-capture-code"):
        raise ValueError("unknown workspace compliance mode")
    violations = changes if mode == "read-only" else [change for change in changes if
        change["path"] == "AGENTS.md" or change["path"] == ".agents" or change["path"].startswith(".agents/")]
    return {"mode": mode, "pass": not violations, "changes": changes, "violations": violations}


def executable_identity(binary: Path) -> dict:
    result = {"revision": "unavailable", "executable_sha256": "unavailable", "version_interface": ["--version"]}
    try:
        result["executable_sha256"] = hashlib.sha256(binary.resolve(strict=True).read_bytes()).hexdigest()
    except OSError:
        pass
    try:
        completed = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=15)
        result["version_exit_code"] = completed.returncode
        if completed.returncode == 0 and completed.stdout.strip():
            result["revision"] = completed.stdout.strip()[:4096]
    except (OSError, subprocess.TimeoutExpired):
        result["version_exit_code"] = None
    return result
