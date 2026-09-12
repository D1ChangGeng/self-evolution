#!/usr/bin/env python3
"""Merge complete public campaign manifests under one artifact root."""

from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prefix_artifact_refs(value: Any, prefix: str) -> Any:
    if isinstance(value, list):
        return [prefix_artifact_refs(item, prefix) for item in value]
    if not isinstance(value, dict):
        return value
    output = {
        key: prefix_artifact_refs(item, prefix) for key, item in value.items()
    }
    if (
        isinstance(output.get("path"), str)
        and isinstance(output.get("sha256"), str)
    ):
        output["path"] = f"{prefix}/{output['path']}"
    return output


def rebase_json_ref(
    ref: dict[str, str],
    source_root: Path,
    artifact_root: Path,
    prefix: str,
) -> dict[str, str]:
    relative_source = Path(ref["path"])
    if relative_source.is_absolute() or ".." in relative_source.parts:
        raise RuntimeError(f"unsafe artifact path: {ref['path']}")
    source = (source_root / relative_source).resolve()
    if not source.is_relative_to(source_root.resolve()):
        raise RuntimeError(f"artifact path escapes campaign: {ref['path']}")
    if sha256_file(source) != ref["sha256"]:
        raise RuntimeError(f"artifact hash mismatch: {source}")
    content = prefix_artifact_refs(read_json(source), prefix)
    relative = Path("_aggregate") / prefix / relative_source
    destination = artifact_root / relative
    write_json(destination, content)
    return {
        "path": relative.as_posix(),
        "sha256": sha256_file(destination),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--campaign", action="append", required=True)
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--engineering", type=Path)
    args = parser.parse_args()

    if len(args.campaign) < 2:
        raise RuntimeError("at least two campaign directories are required")
    manifests = []
    for campaign_name in args.campaign:
        campaign_dir = args.artifact_root / campaign_name
        evidence_path = campaign_dir / "evidence.json"
        evidence = read_json(evidence_path)
        if evidence.get("artifact_root") != ".":
            raise RuntimeError(f"{evidence_path} must use artifact_root='.'")
        manifests.append((campaign_name, evidence))

    first = manifests[0][1]
    merged = {
        "schema_version": first["schema_version"],
        "campaign_id": args.campaign_id,
        "change_class": first["change_class"],
        "host": first["host"],
        "artifact_root": str(args.artifact_root.resolve()),
        "benchmark": deepcopy(first["benchmark"]),
        "runs": [],
    }
    seen_pairs: set[str] = set()
    for campaign_name, evidence in manifests:
        for field in ("schema_version", "change_class", "host", "benchmark"):
            if evidence[field] != first[field]:
                raise RuntimeError(f"campaign {campaign_name} changes {field}")
        for run in evidence["runs"]:
            pair_id = run["pair_id"]
            if pair_id in seen_pairs:
                raise RuntimeError(f"duplicate pair_id: {pair_id}")
            seen_pairs.add(pair_id)
            rebased = prefix_artifact_refs(run, campaign_name)
            for arm in ("baseline", "candidate"):
                rebased[arm]["results"] = rebase_json_ref(
                    run[arm]["results"],
                    args.artifact_root / campaign_name,
                    args.artifact_root,
                    campaign_name,
                )
            merged["runs"].append(rebased)

    if args.engineering:
        engineering = read_json(args.engineering)
        engineering_prefix = args.engineering.parent.relative_to(
            args.artifact_root
        ).as_posix()
        rebased_engineering = prefix_artifact_refs(
            engineering,
            engineering_prefix,
        )
        for section in ("harnesses", "samples"):
            for index, item in enumerate(engineering[section]):
                rebased_engineering[section][index]["review"] = rebase_json_ref(
                    item["review"],
                    args.engineering.parent,
                    args.artifact_root,
                    engineering_prefix,
                )
        merged["engineering"] = rebased_engineering
    write_json(args.output, merged)


if __name__ == "__main__":
    main()
