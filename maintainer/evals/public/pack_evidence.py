#!/usr/bin/env python3
"""Pack only hash-referenced public evaluation artifacts for offline validation."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path
from typing import Any


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode(
        "utf-8"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--sensitive-value-file", type=Path)
    args = parser.parse_args()

    root = args.evidence.parent.resolve()
    evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    if evidence.get("artifact_root") not in (".", str(root)):
        raise RuntimeError("aggregate evidence uses an unexpected artifact root")
    sensitive_value = (
        args.sensitive_value_file.read_bytes().strip()
        if args.sensitive_value_file
        else b""
    )
    files: dict[str, bytes] = {}

    def add_path(relative: str, expected_sha256: str | None = None) -> bytes:
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or ":" in relative:
            raise RuntimeError(f"unsafe evidence path: {relative}")
        source = (root / path).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise RuntimeError(f"missing or external evidence file: {relative}")
        content = source.read_bytes()
        if expected_sha256 and sha256_bytes(content) != expected_sha256:
            raise RuntimeError(f"evidence hash mismatch: {relative}")
        if sensitive_value and sensitive_value in content:
            raise RuntimeError(f"sensitive value appears in evidence: {relative}")
        files[path.as_posix()] = content
        return content

    def add_ref(ref: dict[str, str]) -> Any:
        return json.loads(add_path(ref["path"], ref["sha256"]))

    for run in evidence["runs"]:
        add_ref(run["question_manifest"])
        add_ref(run["protocol"])
        for arm in ("baseline", "candidate"):
            results = add_ref(run[arm]["results"])
            for question in results["questions"]:
                for kind in ("prediction", "judge", "trace"):
                    add_ref(question[kind])
    engineering = evidence.get("engineering")
    if engineering:
        for section in ("harnesses", "samples"):
            for item in engineering[section]:
                add_ref(item["execution"])
                review = add_ref(item["review"])
                for ref in review["evidence_refs"]:
                    add_ref(ref)
        engineering_id = engineering["campaign_id"]
        add_path(f"{engineering_id}/engineering.json")

    for run in evidence["runs"]:
        campaign = run["pair_id"].rsplit("-", 1)[0]
        for relative in (
            f"{campaign}/protocols/judge-config.json",
            f"{campaign}/protocols/prompt-contract-cleaned.json",
            f"{campaign}/protocols/prompt-contract-v2.json",
            f"{campaign}/subjects.json",
        ):
            if (root / relative).is_file():
                add_path(relative)

    first_campaign = evidence["runs"][0]["pair_id"].rsplit("-", 1)[0]
    for relative in (
        f"{first_campaign}/runner/run_campaign.py",
        f"{first_campaign}/runner/merge_campaigns.py",
        f"{first_campaign}/runner/validate_evidence.mjs",
        f"{first_campaign}/runner/public.mjs",
        f"{first_campaign}/runner/run_engineering.py",
    ):
        if (root / relative).is_file():
            add_path(relative)
    for subject_root in ("baseline", "candidate"):
        directory = root / first_campaign / "subjects" / subject_root
        for path in directory.rglob("*"):
            if path.is_file():
                add_path(path.relative_to(root).as_posix())

    evidence["artifact_root"] = "."
    files["evidence.json"] = canonical_bytes(evidence)
    args.archive.parent.mkdir(parents=True, exist_ok=True)
    with args.archive.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, filename="", mode="wb", mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode="w", format=tarfile.GNU_FORMAT) as tar:
                for relative, content in sorted(files.items()):
                    info = tarfile.TarInfo(relative)
                    info.size = len(content)
                    info.mtime = 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mode = 0o644
                    tar.addfile(info, io.BytesIO(content))
    manifest = {
        "schema_version": "public-evidence-bundle/1",
        "archive": args.archive.name,
        "sha256": sha256_bytes(args.archive.read_bytes()),
        "campaign_id": evidence["campaign_id"],
        "file_count": len(files),
    }
    args.manifest.write_bytes(canonical_bytes(manifest))
    print(json.dumps(manifest, sort_keys=True))


if __name__ == "__main__":
    main()
