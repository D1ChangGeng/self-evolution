#!/usr/bin/env python3
"""Run the public paired memory campaign and emit validator-ready evidence.

The runner is intentionally outside the distributed skill. It compares two
frozen skill trees while keeping data, retrieval, model, prompt, and judge
configuration fixed. Every reported metric is derived later from per-question
prediction, judge, and trace artifacts.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import re
import sqlite3
import time
import zlib
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import httpx


BASELINE_COMMIT = "c998067f73620a4721367e33a31063882896d476"
CLEANED_DATA_REVISION = "98d7416c24c778c2fee6e6f3006e7a073259d48f"
V2_DATA_REVISION = "f152293e235517d504809563c833d7190b8c713b"
V2_REPOSITORY_COMMIT = "2cc8c540bdb87fe6761629b585e727e1c4704520"
LONGMEMEVAL_REPOSITORY_COMMIT = "9e0b455f4ef0e2ab8f2e582289761153549043fc"
RUNNER_REVISION = "self-evolution-public-runner/1"
JUDGE_RUNNER_REVISION = "self-evolution-public-judge/3"
MAX_V2_CONTEXT_CHARS = 40_000
MAX_V2_STATE_CHARS = 5_000
V2_TOP_TRAJECTORIES = 12
V2_TOP_STATES = 10

TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{2,}|\d+")
BOXED_RE = re.compile(r"\\boxed\{([^{}]*)\}", re.DOTALL)
STOPWORDS = {
    "about",
    "after",
    "also",
    "answer",
    "asked",
    "based",
    "before",
    "being",
    "company",
    "could",
    "does",
    "environment",
    "from",
    "have",
    "into",
    "mark",
    "more",
    "most",
    "only",
    "option",
    "portal",
    "question",
    "should",
    "short",
    "specific",
    "that",
    "their",
    "there",
    "these",
    "this",
    "using",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "working",
    "would",
    "your",
}

CLEANED_PROMPTS = {
    "single-session-user": (
        "I will give you a question, a correct answer, and a response from a model. "
        "Please answer yes if the response contains the correct answer. Otherwise, answer no. "
        "If the response is equivalent to the correct answer or contains all the intermediate "
        "steps to get the correct answer, you should also answer yes. If the response only "
        "contains a subset of the information required by the answer, answer no."
    ),
    "single-session-assistant": None,
    "multi-session": None,
    "temporal-reasoning": (
        "I will give you a question, a correct answer, and a response from a model. "
        "Please answer yes if the response contains the correct answer. Otherwise, answer no. "
        "Equivalent answers and complete intermediate steps count as correct; incomplete subsets "
        "do not. Do not penalize off-by-one errors for elapsed days, weeks, or months."
    ),
    "knowledge-update": (
        "I will give you a question, a correct answer, and a response from a model. "
        "Please answer yes if the response contains the correct answer. Otherwise, answer no. "
        "If older information appears with the updated answer, count it as correct as long as the "
        "updated answer is clearly the required answer."
    ),
    "single-session-preference": (
        "I will give you a question, a rubric for a desired personalized response, and a response "
        "from a model. Answer yes if the response satisfies the rubric and recalls and uses the "
        "user's personal information correctly; otherwise answer no. Full rubric coverage is not "
        "required."
    ),
}
CLEANED_PROMPTS["single-session-assistant"] = CLEANED_PROMPTS[
    "single-session-user"
]
CLEANED_PROMPTS["multi-session"] = CLEANED_PROMPTS["single-session-user"]

V2_ABSTENTION_SYSTEM = (
    "You are a strict grader for flawed-premise (abstention) questions. Judge whether a model "
    "answer correctly identifies that the premise is wrong, consistent with the reference answer. "
    "A premise-following concrete answer, generic UNKNOWN, or contradictory answer receives 0."
)
V2_GOTCHAS_SYSTEM = (
    "You are a strict grader for gotchas-style insight questions. Grade 1 when the response "
    "includes at least one correct reference insight and contradicts none; otherwise grade 0."
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode(
        "utf-8"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_bytes(value)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def artifact_ref(root: Path, path: Path) -> dict[str, str]:
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": sha256_file(path),
    }


def stable_subject_tree_hash(root: Path) -> str:
    parts: list[bytes] = []
    files = sorted(
        (item for item in root.rglob("*") if item.is_file()),
        key=lambda item: item.relative_to(root).as_posix().casefold(),
    )
    for path in files:
        relative = path.relative_to(root).as_posix()
        content = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace(
            "\r", "\n"
        )
        parts.extend(
            [relative.encode(), b"\0", sha256_bytes(content.encode()).encode(), b"\0"]
        )
    return sha256_bytes(b"".join(parts))


def subject_facts(root: Path) -> dict[str, str]:
    tree_hash = stable_subject_tree_hash(root)
    bundle_hash = sha256_file(root / "references" / "bin" / "kb.mjs")
    subject_hash = sha256_bytes(
        canonical_bytes(
            {"bundle_sha256": bundle_hash, "skill_tree_sha256": tree_hash}
        )
    )
    return {
        "tree_sha256": tree_hash,
        "bundle_sha256": bundle_hash,
        "subject_sha256": subject_hash,
        "skill_sha256": sha256_bytes(
            (root / "SKILL.md")
            .read_text(encoding="utf-8")
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .encode()
        ),
    }


def combined_data_hash(files: Iterable[tuple[str, Path]]) -> str:
    parts: list[bytes] = []
    for name, path in sorted(files):
        parts.extend([name.encode(), b"\0", sha256_file(path).encode(), b"\0"])
    return sha256_bytes(b"".join(parts))


def tokenize(text: str) -> list[str]:
    return [
        token
        for token in TOKEN_RE.findall(text.lower())
        if token not in STOPWORDS and len(token) >= 3
    ]


def quoted_phrases(text: str) -> list[str]:
    phrases = re.findall(r"[`\"']([^`\"']{3,80})[`\"']", text)
    return [phrase.lower() for phrase in phrases]


def render_cleaned_context(row: dict[str, Any]) -> list[dict[str, str]]:
    sessions: list[tuple[str, str, Any]] = list(
        zip(
            row["haystack_dates"],
            row["haystack_session_ids"],
            row["haystack_sessions"],
        )
    )
    sessions.sort(key=lambda item: item[0])
    selected: list[dict[str, str]] = []
    for date, session_id, turns in sessions:
        lines = [f"Session date: {date}"]
        for turn in turns:
            lines.append(f"{turn.get('role', 'unknown')}: {turn.get('content', '')}")
        selected.append({"id": session_id, "text": "\n".join(lines)})
    return selected


class TrajectoryStore:
    def __init__(self, database: Path, source: Path) -> None:
        self.database = database
        self.source = source
        database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(database)
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS trajectories (id TEXT PRIMARY KEY, payload BLOB NOT NULL)"
        )
        self.connection.commit()

    def ensure(self) -> None:
        row = self.connection.execute("SELECT COUNT(*) FROM trajectories").fetchone()
        if row and row[0] > 0:
            return
        batch: list[tuple[str, bytes]] = []
        with self.source.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                item = json.loads(line)
                batch.append(
                    (
                        str(item["id"]),
                        zlib.compress(line.encode("utf-8"), level=1),
                    )
                )
                if len(batch) >= 100:
                    self.connection.executemany(
                        "INSERT OR REPLACE INTO trajectories(id, payload) VALUES (?, ?)",
                        batch,
                    )
                    self.connection.commit()
                    batch.clear()
        if batch:
            self.connection.executemany(
                "INSERT OR REPLACE INTO trajectories(id, payload) VALUES (?, ?)", batch
            )
            self.connection.commit()

    def get(self, trajectory_id: str) -> dict[str, Any]:
        row = self.connection.execute(
            "SELECT payload FROM trajectories WHERE id = ?", (trajectory_id,)
        ).fetchone()
        if row is None:
            raise KeyError(trajectory_id)
        return json.loads(zlib.decompress(row[0]))


def relevance_score(text: str, tokens: set[str], phrases: list[str]) -> float:
    lowered = text.lower()
    score = 0.0
    for token in tokens:
        count = lowered.count(token)
        if count:
            score += 1.0 + math.log1p(count)
    for phrase in phrases:
        if phrase in lowered:
            score += 8.0
    return score


def compact_tree(tree: str, tokens: set[str], phrases: list[str]) -> str:
    lines = tree.splitlines()
    wanted: set[int] = set()
    for index, line in enumerate(lines):
        lowered = line.lower()
        if any(token in lowered for token in tokens) or any(
            phrase in lowered for phrase in phrases
        ):
            wanted.update(range(max(0, index - 1), min(len(lines), index + 2)))
    if not wanted:
        wanted.update(range(min(30, len(lines))))
    return "\n".join(lines[index] for index in sorted(wanted))[:MAX_V2_STATE_CHARS]


def render_v2_context(
    store: TrajectoryStore,
    question: dict[str, Any],
    trajectory_ids: list[str],
) -> list[dict[str, str]]:
    tokens = set(tokenize(question["question"]))
    phrases = quoted_phrases(question["question"])
    trajectory_candidates: list[tuple[float, dict[str, Any]]] = []
    for trajectory_id in trajectory_ids:
        trajectory = store.get(trajectory_id)
        navigation = "\n".join(
            str(state.get("thought", "")) + "\n" + str(state.get("action", ""))
            for state in trajectory.get("states", [])
        )
        text = (
            str(trajectory.get("goal", ""))
            + "\n"
            + str(trajectory.get("start_url", ""))
            + "\n"
            + navigation
        )
        trajectory_candidates.append((relevance_score(text, tokens, phrases), trajectory))
    trajectory_candidates.sort(key=lambda item: item[0], reverse=True)

    state_candidates: list[tuple[float, str, int, str]] = []
    for trajectory_score, trajectory in trajectory_candidates[:V2_TOP_TRAJECTORIES]:
        goal = str(trajectory.get("goal", ""))
        for state in trajectory.get("states", []):
            state_text = "\n".join(
                [
                    goal,
                    str(state.get("url", "")),
                    str(state.get("thought", "")),
                    str(state.get("action", "")),
                    str(state.get("accessibility_tree", "")),
                ]
            )
            score = trajectory_score * 0.2 + relevance_score(
                state_text, tokens, phrases
            )
            tree = compact_tree(
                str(state.get("accessibility_tree", "")), tokens, phrases
            )
            snippet = (
                f"Trajectory goal: {goal}\n"
                f"Outcome: {trajectory.get('outcome', '')}\n"
                f"State index: {state.get('state_index')}\n"
                f"URL: {state.get('url', '')}\n"
                f"Thought: {state.get('thought', '')}\n"
                f"Action: {state.get('action', '')}\n"
                f"Relevant accessibility tree lines:\n{tree}"
            )[:MAX_V2_STATE_CHARS]
            state_candidates.append(
                (score, str(trajectory["id"]), int(state.get("state_index", 0)), snippet)
            )
    state_candidates.sort(key=lambda item: item[0], reverse=True)
    selected: list[dict[str, str]] = []
    used: set[tuple[str, int]] = set()
    total = 0
    for _, trajectory_id, state_index, snippet in state_candidates:
        key = (trajectory_id, state_index)
        if key in used:
            continue
        if total + len(snippet) > MAX_V2_CONTEXT_CHARS and selected:
            continue
        selected.append(
            {"id": f"{trajectory_id}:{state_index}", "text": snippet}
        )
        used.add(key)
        total += len(snippet)
        if len(selected) >= V2_TOP_STATES or total >= MAX_V2_CONTEXT_CHARS:
            break
    return selected


def prediction_messages(
    benchmark: str,
    skill_text: str,
    question: dict[str, Any],
    selected_context: list[dict[str, str]],
) -> list[dict[str, str]]:
    system = (
        "You are the language-intelligence component of a project-wiki memory system. "
        "Follow the evaluated skill instructions below. Use only the supplied current evidence, "
        "resolve updates and temporal order carefully, and say UNKNOWN when evidence is insufficient. "
        "Return only the concise final answer requested by the question.\n\n"
        "EVALUATED SKILL:\n"
        + skill_text
    )
    context = "\n\n".join(
        f"### Evidence {item['id']}\n{item['text']}" for item in selected_context
    )
    if benchmark == "cleaned":
        user = (
            f"Project history:\n{context}\n\nCurrent date: {question['question_date']}\n"
            f"Question: {question['question']}\nAnswer:"
        )
    else:
        domain = question["domain"]
        environment = (
            "a customized ServiceNow environment"
            if domain == "enterprise"
            else "customized Magento, CMS, and forum web environments"
        )
        user = (
            f"You are answering from verified memory of {environment}.\n\n{context}\n\n"
            f"Question:\n{question['question']}"
        )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


class Endpoint:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        concurrency: int,
        timeout: float,
        reasoning_effort: str,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.semaphore = asyncio.Semaphore(concurrency)
        self.timeout = timeout
        self.reasoning_effort = reasoning_effort
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            limits=httpx.Limits(
                max_connections=concurrency,
                max_keepalive_connections=concurrency,
            ),
        )

    async def close(self) -> None:
        await self.client.aclose()

    async def chat(
        self, messages: list[dict[str, str]], max_tokens: int = 1024
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_completion_tokens": max_tokens,
            "temperature": 0,
            "reasoning_effort": self.reasoning_effort,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        last_error: Exception | None = None
        async with self.semaphore:
            for attempt in range(5):
                try:
                    response = await self.client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                    response.raise_for_status()
                    value = response.json()
                    content = value["choices"][0]["message"]["content"]
                    if not isinstance(content, str) or not content.strip():
                        raise RuntimeError("endpoint returned empty message content")
                    return {
                        "answer": content.strip(),
                        "response_id": value.get("id"),
                        "response_model": value.get("model"),
                        "usage": value.get("usage"),
                    }
                except Exception as error:  # noqa: BLE001 - preserve retry evidence
                    last_error = error
                    if attempt == 4:
                        break
                    await asyncio.sleep(min(20.0, 2.0**attempt))
        raise RuntimeError(f"endpoint request failed after retries: {last_error}")


def parse_boxed(text: str) -> str:
    matches = BOXED_RE.findall(text)
    return matches[-1].strip() if matches else text.strip()


def normalize_phrase(text: str) -> str:
    value = text.lower().replace("-", " ").replace("_", " ")
    value = re.sub(r"[,;]", " ", value)
    value = re.sub(r"[^\w\s]", "", value)
    return re.sub(r"\s+", " ", value).strip()


def split_answer(text: str, separators: str) -> list[str]:
    parts = re.split("|".join(re.escape(item) for item in separators), text)
    return [value for value in (normalize_phrase(item) for item in parts) if value]


def deterministic_v2_judge(spec: str, prediction: str, answer: str) -> bool | None:
    name, *options = spec.split("|")
    settings: dict[str, str] = {}
    for option in options:
        key, value = option.split("=", 1)
        settings[key] = value
    if name.startswith("llm_"):
        return None
    parsed = parse_boxed(prediction)
    if name in {"norm_phrase_set_match", "norm_phrase_set_match_ordered"}:
        separators = settings.get("separators", ",;")
        expected = split_answer(answer, separators)
        normalized = normalize_phrase(parsed)
        if not normalized or not expected:
            return False
        cursor = 0
        for phrase in expected:
            match = re.search(rf"\b{re.escape(phrase)}\b", normalized[cursor:])
            if not match:
                return False
            if name.endswith("_ordered"):
                cursor += match.end()
        return True
    if name == "mc_choice_match":
        cleaned = re.sub(r"\b(choice|option)\b", "", parsed, flags=re.I)
        return cleaned.replace(".", "").strip().upper() == answer.strip().upper()
    if name == "mc_choice_set_match":
        filler = {
            "AND",
            "ANSWER",
            "ANSWERS",
            "CHOICE",
            "CHOICES",
            "FINAL",
            "LETTER",
            "LETTERS",
            "OPTION",
            "OPTIONS",
        }
        def letters(value: str) -> list[str]:
            out: list[str] = []
            for chunk in re.findall(r"[A-Z]+", value.upper()):
                if chunk not in filler:
                    out.extend(chunk)
            return out
        return bool(letters(parsed)) and set(letters(parsed)) == set(letters(answer))
    raise ValueError(f"unsupported V2 eval function: {name}")


def cleaned_judge_messages(item: dict[str, Any], prediction: str) -> list[dict[str, str]]:
    instruction = CLEANED_PROMPTS[item["question_type"]]
    prompt = (
        f"{instruction}\n\nQuestion: {item['question']}\n\nCorrect Answer: "
        f"{item['answer']}\n\nModel Response: {prediction}\n\n"
        "Is the model response correct? Answer yes or no only."
    )
    return [{"role": "user", "content": prompt}]


def cleaned_paired_judge_messages(
    item: dict[str, Any], baseline_prediction: str, candidate_prediction: str
) -> list[dict[str, str]]:
    instruction = CLEANED_PROMPTS[item["question_type"]]
    prompt = (
        f"{instruction}\n\nJudge each neutral response independently under the same rubric.\n\n"
        f"Question: {item['question']}\n\nCorrect Answer: {item['answer']}\n\n"
        f"Response A: {baseline_prediction}\n\nResponse B: {candidate_prediction}\n\n"
        "Output JSON only: "
        '{"A":{"label":0 or 1,"reason":"short rationale"},'
        '"B":{"label":0 or 1,"reason":"short rationale"}}'
    )
    return [{"role": "user", "content": prompt}]


def v2_llm_judge_messages(item: dict[str, Any], prediction: str) -> list[dict[str, str]]:
    parsed = parse_boxed(prediction)
    if item["eval_function"].startswith("llm_abstention_checker"):
        system = V2_ABSTENTION_SYSTEM
        rubric = (
            "Label 1 only if the model clearly identifies the flawed premise and reaches a "
            "conclusion equivalent to the reference answer. Label 0 for a premise-following "
            "concrete answer, generic UNKNOWN, or contradiction."
        )
    else:
        system = V2_GOTCHAS_SYSTEM
        rubric = (
            "Label 1 if the response includes at least one correct reference insight and "
            "contradicts none. Label 0 for wrong direction, contradiction, or generic text."
        )
    user = (
        f"Question:\n{item['question']}\n\nReference answer:\n{item['answer']}\n\n"
        f"Model full response:\n{prediction}\n\nModel extracted final answer:\n{parsed}\n\n"
        f"Scoring rubric:\n{rubric}\n\nOutput JSON only: "
        '{"label": 0 or 1, "reason": "short rationale"}'
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def v2_paired_llm_judge_messages(
    item: dict[str, Any], baseline_prediction: str, candidate_prediction: str
) -> list[dict[str, str]]:
    baseline_parsed = parse_boxed(baseline_prediction)
    candidate_parsed = parse_boxed(candidate_prediction)
    if item["eval_function"].startswith("llm_abstention_checker"):
        system = V2_ABSTENTION_SYSTEM
        rubric = (
            "Label 1 only if the response clearly identifies the flawed premise and reaches a "
            "conclusion equivalent to the reference answer. Label 0 for a premise-following "
            "concrete answer, generic UNKNOWN, or contradiction."
        )
    else:
        system = V2_GOTCHAS_SYSTEM
        rubric = (
            "Label 1 if the response includes at least one correct reference insight and "
            "contradicts none. Label 0 for wrong direction, contradiction, or generic text."
        )
    user = (
        f"Question:\n{item['question']}\n\nReference answer:\n{item['answer']}\n\n"
        f"Response A full text:\n{baseline_prediction}\n\nResponse A extracted answer:\n{baseline_parsed}\n\n"
        f"Response B full text:\n{candidate_prediction}\n\nResponse B extracted answer:\n{candidate_parsed}\n\n"
        f"Scoring rubric:\n{rubric}\n\nJudge each neutral response independently under the same rubric. "
        "Output JSON only: "
        '{"A":{"label":0 or 1,"reason":"short rationale"},'
        '"B":{"label":0 or 1,"reason":"short rationale"}}'
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def parse_binary_judge(text: str) -> tuple[bool, str]:
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        try:
            value = json.loads(match.group(0))
            if value.get("label") in {0, 1, "0", "1"}:
                return bool(int(value["label"])), str(value.get("reason", ""))
        except json.JSONDecodeError:
            pass
    without_thinking = re.sub(
        r"<think>.*?</think>", "", text, flags=re.IGNORECASE | re.DOTALL
    ).strip()
    yes_no = re.findall(r"\b(yes|no)\b", without_thinking.lower())
    if yes_no:
        return yes_no[-1] == "yes", text.strip()
    label = re.search(r"\blabel\b\s*[:=]\s*([01])", text, flags=re.I)
    if label:
        return label.group(1) == "1", text.strip()
    raise ValueError(f"cannot parse judge response: {text!r}")


def parse_paired_judge(text: str) -> dict[str, tuple[bool, str]]:
    without_thinking = re.sub(
        r"<think>.*?</think>", "", text, flags=re.IGNORECASE | re.DOTALL
    ).strip()
    match = re.search(r"\{.*\}", without_thinking, flags=re.DOTALL)
    if not match:
        raise ValueError(f"cannot parse paired judge response: {text!r}")
    payload = json.loads(match.group(0))
    result: dict[str, tuple[bool, str]] = {}
    for arm in ("A", "B"):
        value = payload.get(arm)
        if not isinstance(value, dict) or value.get("label") not in {0, 1, "0", "1"}:
            raise ValueError(f"paired judge response is missing a valid {arm} label")
        result[arm] = (bool(int(value["label"])), str(value.get("reason", "")))
    return result


def load_cleaned(path: Path) -> list[dict[str, Any]]:
    rows = read_json(path)
    if not isinstance(rows, list) or len(rows) != 500:
        raise RuntimeError("cleaned oracle must contain exactly 500 questions")
    return rows


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


async def run_predictions(
    endpoint: Endpoint,
    campaign_root: Path,
    benchmark: str,
    questions: list[dict[str, Any]],
    contexts: dict[str, list[dict[str, str]]],
    subjects: dict[str, dict[str, str]],
    skill_texts: dict[str, str],
    protocol_ref: dict[str, str],
) -> None:
    async def one(arm: str, item: dict[str, Any]) -> None:
        question_id = item.get("question_id") or item["id"]
        prediction_path = campaign_root / "artifacts" / benchmark / arm / "predictions" / f"{question_id}.json"
        trace_path = campaign_root / "artifacts" / benchmark / arm / "traces" / f"{question_id}.json"
        if prediction_path.exists() and trace_path.exists():
            try:
                existing_prediction = read_json(prediction_path)
                existing_trace = read_json(trace_path)
                if (
                    existing_prediction.get("protocol_sha256") == protocol_ref["sha256"]
                    and existing_prediction.get("subject_sha256")
                    == subjects[arm]["subject_sha256"]
                    and existing_trace.get("prediction_sha256")
                    == sha256_file(prediction_path)
                    and existing_trace.get("protocol_sha256") == protocol_ref["sha256"]
                    and existing_trace.get("subject_sha256")
                    == subjects[arm]["subject_sha256"]
                ):
                    return
            except (OSError, ValueError, json.JSONDecodeError):
                pass
        selected = contexts[question_id]
        started = utc_now()
        start_clock = time.perf_counter()
        response = await endpoint.chat(
            prediction_messages(benchmark, skill_texts[arm], item, selected),
            max_tokens=1024,
        )
        ended = utc_now()
        duration_ms = round((time.perf_counter() - start_clock) * 1000)
        prediction = {
            "schema_version": "public-prediction/1",
            "question_id": question_id,
            "arm": arm,
            "subject_sha256": subjects[arm]["subject_sha256"],
            "protocol_sha256": protocol_ref["sha256"],
            "answer": response["answer"],
            "provider_response_id": response["response_id"],
            "provider_model": response["response_model"],
            "provider_usage": response["usage"],
        }
        write_json(prediction_path, prediction)
        trace = {
            "schema_version": "public-trace/1",
            "question_id": question_id,
            "arm": arm,
            "subject_sha256": subjects[arm]["subject_sha256"],
            "protocol_sha256": protocol_ref["sha256"],
            "prediction_sha256": sha256_file(prediction_path),
            "started_at": started,
            "ended_at": ended,
            "observed_duration_ms": duration_ms,
            "selected_context": selected,
        }
        write_json(trace_path, trace)

    tasks = [one(arm, item) for item in questions for arm in ("baseline", "candidate")]
    completed = 0
    for future in asyncio.as_completed(tasks):
        await future
        completed += 1
        if completed % 50 == 0:
            print(f"{benchmark} predictions: {completed}/{len(tasks)}", flush=True)


async def run_judges(
    endpoint: Endpoint,
    campaign_root: Path,
    benchmark: str,
    questions: list[dict[str, Any]],
    subjects: dict[str, dict[str, str]],
    protocol_ref: dict[str, str],
    evaluator: dict[str, str],
) -> None:
    async def one(item: dict[str, Any]) -> None:
        question_id = item.get("question_id") or item["id"]
        prediction_paths = {
            arm: campaign_root / "artifacts" / benchmark / arm / "predictions" / f"{question_id}.json"
            for arm in ("baseline", "candidate")
        }
        judge_paths = {
            arm: campaign_root / "artifacts" / benchmark / arm / "judges" / f"{question_id}.json"
            for arm in ("baseline", "candidate")
        }
        predictions = {
            arm: read_json(prediction_paths[arm])["answer"]
            for arm in ("baseline", "candidate")
        }
        reusable = True
        for arm in ("baseline", "candidate"):
            if not judge_paths[arm].exists():
                reusable = False
                break
            try:
                existing = read_json(judge_paths[arm])
                if not (
                    existing.get("protocol_sha256") == protocol_ref["sha256"]
                    and existing.get("subject_sha256")
                    == subjects[arm]["subject_sha256"]
                    and existing.get("prediction_sha256")
                    == sha256_file(prediction_paths[arm])
                    and existing.get("evaluator", {}).get("config_sha256")
                    == evaluator["config_sha256"]
                ):
                    reusable = False
                    break
            except (OSError, ValueError, json.JSONDecodeError):
                reusable = False
                break
        if reusable:
            return

        raw_response: str | None = None
        labels: dict[str, tuple[bool, str]] = {}
        deterministic = (
            benchmark == "v2"
            and deterministic_v2_judge(
                item["eval_function"], predictions["baseline"], item["answer"]
            )
            is not None
        )
        if deterministic:
            for arm in ("baseline", "candidate"):
                value = deterministic_v2_judge(
                    item["eval_function"], predictions[arm], item["answer"]
                )
                labels[arm] = (bool(value), "official deterministic evaluator")
        else:
            messages = (
                cleaned_paired_judge_messages(
                    item, predictions["baseline"], predictions["candidate"]
                )
                if benchmark == "cleaned"
                else v2_paired_llm_judge_messages(
                    item, predictions["baseline"], predictions["candidate"]
                )
            )
            response = await endpoint.chat(messages, max_tokens=384)
            raw_response = response["answer"]
            parsed = parse_paired_judge(raw_response)
            labels = {"baseline": parsed["A"], "candidate": parsed["B"]}

        for arm, blind_arm in (("baseline", "A"), ("candidate", "B")):
            correct, reason = labels[arm]
            judge = {
                "schema_version": "public-judge/1",
                "question_id": question_id,
                "arm": arm,
                "blind_arm": blind_arm,
                "subject_sha256": subjects[arm]["subject_sha256"],
                "protocol_sha256": protocol_ref["sha256"],
                "prediction_sha256": sha256_file(prediction_paths[arm]),
                "evaluator": evaluator,
                "verdict": "correct" if correct else "incorrect",
                "question": item["question"],
                "reference_answer": item["answer"],
                "eval_function": item.get(
                    "eval_function", "longmemeval-official-paired-llm-judge"
                ),
                "judge_response": raw_response,
                "judge_reason": reason,
            }
            write_json(judge_paths[arm], judge)

    tasks = [one(item) for item in questions]
    completed = 0
    for future in asyncio.as_completed(tasks):
        await future
        completed += 1
        if completed % 50 == 0:
            print(f"{benchmark} paired judges: {completed}/{len(tasks)}", flush=True)


def build_results(
    campaign_root: Path,
    benchmark: str,
    questions: list[dict[str, Any]],
    subjects: dict[str, dict[str, str]],
    manifest_ref: dict[str, str],
    protocol_ref: dict[str, str],
    evaluator: dict[str, str],
) -> dict[str, dict[str, str]]:
    refs: dict[str, dict[str, str]] = {}
    for arm in ("baseline", "candidate"):
        rows = []
        for item in sorted(questions, key=lambda value: value.get("question_id") or value["id"]):
            question_id = item.get("question_id") or item["id"]
            prediction = campaign_root / "artifacts" / benchmark / arm / "predictions" / f"{question_id}.json"
            judge = campaign_root / "artifacts" / benchmark / arm / "judges" / f"{question_id}.json"
            trace = campaign_root / "artifacts" / benchmark / arm / "traces" / f"{question_id}.json"
            rows.append(
                {
                    "question_id": question_id,
                    "prediction": artifact_ref(campaign_root, prediction),
                    "judge": artifact_ref(campaign_root, judge),
                    "trace": artifact_ref(campaign_root, trace),
                }
            )
        result = {
            "schema_version": "public-run-results/1",
            "arm": arm,
            "benchmark_id": "longmemeval-cleaned" if benchmark == "cleaned" else "longmemeval-v2",
            "question_manifest_sha256": manifest_ref["sha256"],
            "protocol_sha256": protocol_ref["sha256"],
            "subject_sha256": subjects[arm]["subject_sha256"],
            "evaluator": evaluator,
            "questions": rows,
        }
        path = campaign_root / "results" / f"{benchmark}-{arm}.json"
        write_json(path, result)
        refs[arm] = artifact_ref(campaign_root, path)
    return refs


def prepare_contexts(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    cleaned_rows = load_cleaned(args.cleaned_data)
    cleaned_contexts = {
        row["question_id"]: render_cleaned_context(row) for row in cleaned_rows
    }

    v2_questions = load_jsonl(args.v2_root / "questions.jsonl")
    if len(v2_questions) != 451:
        raise RuntimeError("LongMemEval-V2 questions.jsonl must contain 451 questions")
    haystack = read_json(args.v2_root / "haystacks" / "lme_v2_small.json")
    store = TrajectoryStore(
        args.campaign_root / "cache" / "trajectories.sqlite3",
        args.v2_root / "trajectories.jsonl",
    )
    store.ensure()
    v2_contexts: dict[str, list[dict[str, str]]] = {}
    for index, row in enumerate(v2_questions, start=1):
        cache_path = args.campaign_root / "contexts" / "v2" / f"{row['id']}.json"
        if cache_path.exists():
            v2_contexts[row["id"]] = read_json(cache_path)
        else:
            selected = render_v2_context(store, row, haystack[row["id"]])
            write_json(cache_path, selected)
            v2_contexts[row["id"]] = selected
        if index % 50 == 0:
            print(f"V2 contexts: {index}/{len(v2_questions)}", flush=True)
    return (
        {"questions": cleaned_rows, "contexts": cleaned_contexts},
        {"questions": v2_questions, "contexts": v2_contexts},
    )


def prepare_protocols(
    args: argparse.Namespace,
    subjects: dict[str, dict[str, str]],
    datasets: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    prompt_contract = {
        "schema_version": "public-prompt-contract/1",
        "runner_revision": RUNNER_REVISION,
        "prediction_contract": "subject skill + fixed benchmark evidence + concise answer",
        "cleaned_context": "all official oracle sessions in chronological order",
        "v2_retrieval": {
            "algorithm": "bounded lexical trajectory and state selection",
            "top_trajectories": V2_TOP_TRAJECTORIES,
            "top_states": V2_TOP_STATES,
            "max_context_chars": MAX_V2_CONTEXT_CHARS,
            "max_state_chars": MAX_V2_STATE_CHARS,
        },
    }
    prompt_path = args.campaign_root / "protocols" / "prompt-contract.json"
    write_json(prompt_path, prompt_contract)
    prompt_sha = sha256_file(prompt_path)

    protocols: dict[str, dict[str, Any]] = {}
    for benchmark, benchmark_id, tier in (
        ("cleaned", "longmemeval-cleaned", "full"),
        ("v2", "longmemeval-v2", "small"),
    ):
        manifest = datasets[benchmark]["manifest"]
        manifest_path = args.campaign_root / "manifests" / f"{benchmark}.json"
        write_json(manifest_path, manifest)
        manifest_ref = artifact_ref(args.campaign_root, manifest_path)
        protocol = {
            "schema_version": "public-run-protocol/1",
            "benchmark_id": benchmark_id,
            "tier": tier,
            "question_manifest_sha256": manifest_ref["sha256"],
            "model": {"name": args.model, "revision": args.model_revision},
            "data": {
                "revision": datasets[benchmark]["revision"],
                "sha256": datasets[benchmark]["data_sha256"],
            },
            "prompt_sha256": prompt_sha,
            "budget": {
                "max_completion_tokens": 1024,
                "reasoning_effort": args.reasoning_effort,
                "v2_max_selected_context_chars": MAX_V2_CONTEXT_CHARS,
            },
            "harness": {"name": RUNNER_REVISION, "revision": args.runner_revision},
            "environment": {
                "host": "1302-1",
                "os": args.os_revision,
                "toolchain": args.toolchain_revision,
            },
        }
        protocol_path = args.campaign_root / "protocols" / f"{benchmark}.json"
        write_json(protocol_path, protocol)
        protocols[benchmark] = {
            "manifest_ref": manifest_ref,
            "protocol_ref": artifact_ref(args.campaign_root, protocol_path),
        }
    write_json(args.campaign_root / "subjects.json", subjects)
    return protocols


def dataset_contracts(args: argparse.Namespace, prepared: tuple[dict[str, Any], dict[str, Any]]) -> dict[str, dict[str, Any]]:
    cleaned, v2 = prepared
    cleaned_ids = sorted(row["question_id"] for row in cleaned["questions"])
    v2_ids = sorted(row["id"] for row in v2["questions"])
    cleaned_hash = combined_data_hash([("longmemeval_oracle.json", args.cleaned_data)])
    v2_hash = combined_data_hash(
        [
            ("questions.jsonl", args.v2_root / "questions.jsonl"),
            ("trajectories.jsonl", args.v2_root / "trajectories.jsonl"),
            ("haystacks/lme_v2_small.json", args.v2_root / "haystacks" / "lme_v2_small.json"),
        ]
    )
    return {
        "cleaned": {
            "revision": CLEANED_DATA_REVISION,
            "data_sha256": cleaned_hash,
            "manifest": {
                "schema_version": "public-question-manifest/1",
                "benchmark_id": "longmemeval-cleaned",
                "tier": "full",
                "official": True,
                "source": "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned",
                "data_revision": CLEANED_DATA_REVISION,
                "data_sha256": cleaned_hash,
                "question_ids": cleaned_ids,
                "question_count": len(cleaned_ids),
            },
        },
        "v2": {
            "revision": V2_DATA_REVISION,
            "data_sha256": v2_hash,
            "manifest": {
                "schema_version": "public-question-manifest/1",
                "benchmark_id": "longmemeval-v2",
                "tier": "small",
                "official": True,
                "source": "https://huggingface.co/datasets/xiaowu0162/longmemeval-v2",
                "data_revision": V2_DATA_REVISION,
                "data_sha256": v2_hash,
                "question_ids": v2_ids,
                "question_count": len(v2_ids),
                "domains": {row["id"]: row["domain"] for row in v2["questions"]},
            },
        },
    }


async def main_async(args: argparse.Namespace) -> None:
    args.campaign_root.mkdir(parents=True, exist_ok=True)
    subjects = {
        "baseline": subject_facts(args.baseline_skill),
        "candidate": subject_facts(args.candidate_skill),
    }
    skill_texts = {
        "baseline": (args.baseline_skill / "SKILL.md").read_text(encoding="utf-8"),
        "candidate": (args.candidate_skill / "SKILL.md").read_text(encoding="utf-8"),
    }
    key = args.api_key_file.read_text(encoding="utf-8").strip()
    if not key:
        raise RuntimeError("API key file is empty")
    endpoint = Endpoint(
        args.base_url,
        key,
        args.model,
        args.concurrency,
        args.timeout,
        args.reasoning_effort,
    )
    if args.endpoint_smoke:
        try:
            response = await endpoint.chat(
                [
                    {
                        "role": "user",
                        "content": "Return exactly SELF_EVOLUTION_PUBLIC_ENDPOINT_OK",
                    }
                ],
                max_tokens=64,
            )
            if response["answer"] != "SELF_EVOLUTION_PUBLIC_ENDPOINT_OK":
                raise RuntimeError("endpoint smoke returned an unexpected sentinel")
            print(
                json.dumps(
                    {
                        "status": "pass",
                        "model": response["response_model"],
                        "usage_recorded": response["usage"] is not None,
                    },
                    sort_keys=True,
                )
            )
        finally:
            await endpoint.close()
        return

    prepared = prepare_contexts(args)
    datasets = dataset_contracts(args, prepared)
    protocols = prepare_protocols(args, subjects, datasets)
    judge_config = {
        "runner_revision": JUDGE_RUNNER_REVISION,
        "runner_source_sha256": sha256_file(Path(__file__).resolve()),
        "pairing": "neutral-A-B-same-request",
        "longmemeval_commit": LONGMEMEVAL_REPOSITORY_COMMIT,
        "longmemeval_v2_commit": V2_REPOSITORY_COMMIT,
        "model": args.model,
        "model_revision": args.model_revision,
    }
    judge_config_path = args.campaign_root / "protocols" / "judge-config.json"
    write_json(judge_config_path, judge_config)
    evaluator = {
        "name": "official-longmemeval-compatible-judge",
        "revision": f"{LONGMEMEVAL_REPOSITORY_COMMIT}+{V2_REPOSITORY_COMMIT}",
        "config_sha256": sha256_file(judge_config_path),
    }

    if args.prepare_only:
        await endpoint.close()
        print(f"prepared campaign inputs: {args.campaign_root}", flush=True)
        return
    try:
        for benchmark, content in zip(("cleaned", "v2"), prepared):
            await run_predictions(
                endpoint,
                args.campaign_root,
                benchmark,
                content["questions"],
                content["contexts"],
                subjects,
                skill_texts,
                protocols[benchmark]["protocol_ref"],
            )
            await run_judges(
                endpoint,
                args.campaign_root,
                benchmark,
                content["questions"],
                subjects,
                protocols[benchmark]["protocol_ref"],
                evaluator,
            )
    finally:
        await endpoint.close()

    result_refs = {}
    for benchmark, content in zip(("cleaned", "v2"), prepared):
        result_refs[benchmark] = build_results(
            args.campaign_root,
            benchmark,
            content["questions"],
            subjects,
            protocols[benchmark]["manifest_ref"],
            protocols[benchmark]["protocol_ref"],
            evaluator,
        )

    evidence = {
        "schema_version": "2.0",
        "campaign_id": args.campaign_id,
        "change_class": "core",
        "host": "1302-1",
        "artifact_root": ".",
        "benchmark": [
            {
                "id": "longmemeval-cleaned",
                "repository": "xiaowu0162/LongMemEval",
                "dataset": "xiaowu0162/longmemeval-cleaned",
                "data_revision": CLEANED_DATA_REVISION,
                "data_sha256": datasets["cleaned"]["data_sha256"],
            },
            {
                "id": "longmemeval-v2",
                "repository": "xiaowu0162/LongMemEval-V2",
                "commit": V2_REPOSITORY_COMMIT,
                "data_revision": V2_DATA_REVISION,
                "data_sha256": datasets["v2"]["data_sha256"],
            },
        ],
        "runs": [
            {
                "pair_id": f"{args.campaign_id}-cleaned",
                "benchmark_id": "longmemeval-cleaned",
                "tier": "full",
                "question_manifest": protocols["cleaned"]["manifest_ref"],
                "protocol": protocols["cleaned"]["protocol_ref"],
                "baseline": {
                    "subject": {
                        "commit": BASELINE_COMMIT,
                        "sha256": subjects["baseline"]["subject_sha256"],
                    },
                    "results": result_refs["cleaned"]["baseline"],
                },
                "candidate": {
                    "subject": {"sha256": subjects["candidate"]["subject_sha256"]},
                    "results": result_refs["cleaned"]["candidate"],
                },
            },
            {
                "pair_id": f"{args.campaign_id}-v2",
                "benchmark_id": "longmemeval-v2",
                "tier": "small",
                "question_manifest": protocols["v2"]["manifest_ref"],
                "protocol": protocols["v2"]["protocol_ref"],
                "baseline": {
                    "subject": {
                        "commit": BASELINE_COMMIT,
                        "sha256": subjects["baseline"]["subject_sha256"],
                    },
                    "results": result_refs["v2"]["baseline"],
                },
                "candidate": {
                    "subject": {"sha256": subjects["candidate"]["subject_sha256"]},
                    "results": result_refs["v2"]["candidate"],
                },
            },
        ],
    }
    engineering_path = args.campaign_root / "engineering.json"
    if engineering_path.exists():
        evidence["engineering"] = read_json(engineering_path)
    write_json(args.campaign_root / "evidence.json", evidence)
    print(f"campaign evidence: {args.campaign_root / 'evidence.json'}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--campaign-root", type=Path, required=True)
    parser.add_argument("--baseline-skill", type=Path, required=True)
    parser.add_argument("--candidate-skill", type=Path, required=True)
    parser.add_argument("--cleaned-data", type=Path, required=True)
    parser.add_argument("--v2-root", type=Path, required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--api-key-file", type=Path, required=True)
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--runner-revision", default=RUNNER_REVISION)
    parser.add_argument("--os-revision", default="Ubuntu-24.04")
    parser.add_argument("--toolchain-revision", required=True)
    parser.add_argument("--reasoning-effort", default="low")
    parser.add_argument("--concurrency", type=int, default=24)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--endpoint-smoke", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(main_async(parse_args()))
