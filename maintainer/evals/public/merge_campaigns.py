#!/usr/bin/env python3
"""Merge complete public campaign manifests under one artifact root."""

from __future__ import annotations

import argparse
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
            merged["runs"].append(prefix_artifact_refs(run, campaign_name))

    if args.engineering:
        merged["engineering"] = prefix_artifact_refs(
            read_json(args.engineering),
            args.engineering.parent.relative_to(args.artifact_root).as_posix(),
        )
    write_json(args.output, merged)


if __name__ == "__main__":
    main()
