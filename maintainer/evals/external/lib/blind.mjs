import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assertNoVersionLeak,
  exists,
  stableJson,
  validateVerdictScores,
  validateVerdictWinner,
  writeJson,
} from "./core.mjs";
import { parseOpenCodeExport, parseOpenCodeJsonl } from "./collector.mjs";

const LEAK_PATTERNS = [
  /(?:^|[^a-z0-9])v1(?:[^a-z0-9]|$)/i,
  /(?:^|[^a-z0-9])v2(?:[^a-z0-9]|$)/i,
  /legacy[\\/]v1/i,
  /subjects?[\\/]/i,
  /skills[\\/]self-evolution/i,
  /subject_sha256/i,
  /skill_tree_sha256/i,
  /bundle_sha256/i,
  /archive_ref/i,
  /source_commit_sha/i,
  /archive_sha256/i,
  /skill_sha256/i,
];

const WINDOWS_ABSOLUTE_PATH = /(?<![a-z0-9])(?:[a-z]:[\\/]|\\\\)[^\s"'<>|]*/gi;
const POSIX_ABSOLUTE_PATH = /(?<![a-z0-9.:/])\/(?!\/)[^\s"'<>|]+/gi;
const WEB_URL = /\bhttps?:\/\/[^\s"'<>]+/gi;
const DENIED_KEYS = new Set([
  "version",
  "subject_sha256",
  "skill_tree_sha256",
  "bundle_sha256",
  "archive_ref",
  "archive_sha256",
  "skill_sha256",
  "source_commit_sha",
  "repository",
  "oracle_sha",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedReplacementForms(value) {
  const text = String(value);
  return [
    ...new Set([text, text.replaceAll("\\", "/"), text.replaceAll("/", "\\")]),
  ]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function redactAbsolutePaths(value) {
  const urls = [];
  const masked = value.replace(WEB_URL, (url) => {
    const token = `__BLIND_WEB_URL_${urls.length}__`;
    urls.push(url);
    return token;
  });
  let result = masked
    .replace(WINDOWS_ABSOLUTE_PATH, "<ABSOLUTE-PATH>")
    .replace(POSIX_ABSOLUTE_PATH, "<ABSOLUTE-PATH>");
  for (const [index, url] of urls.entries()) {
    result = result.replace(`__BLIND_WEB_URL_${index}__`, url);
  }
  return result;
}

function redactGenericSubjectText(value) {
  return value
    .replace(/legacy[\\/]v1(?:[\\/]skill)?/gi, "<SUBJECT>")
    .replace(/subjects?[\\/][^\s"'<>|]+/gi, "<SUBJECT>")
    .replace(/skills[\\/]self-evolution/gi, "<SUBJECT>")
    .replace(
      /\b(?:subject_sha256|skill_tree_sha256|bundle_sha256|archive_ref|archive_sha256|skill_sha256|source_commit_sha)\b/gi,
      "<SUBJECT-METADATA>",
    )
    .replace(/(^|[^a-z0-9])v[12](?=[^a-z0-9]|$)/gi, "$1<VERSION>");
}

function neutralizeString(value, replacements) {
  let result = value;
  for (const [needle, replacement] of replacements) {
    if (!needle) continue;
    for (const form of normalizedReplacementForms(needle)) {
      result = result.split(form).join(replacement);
    }
  }
  return redactAbsolutePaths(redactGenericSubjectText(result));
}

export function neutralizeBlindValue(value, replacements = []) {
  if (typeof value === "string") return neutralizeString(value, replacements);
  if (Array.isArray(value))
    return value.map((item) => neutralizeBlindValue(item, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !DENIED_KEYS.has(key.toLowerCase()))
      .map(([key, item], index) => {
        const neutralKey = neutralizeString(key, replacements);
        return [
          neutralKey === key ? key : `redacted-field-${index + 1}`,
          neutralizeBlindValue(item, replacements),
        ];
      }),
  );
}

function collectStrings(value, strings = []) {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      strings.push(key);
      collectStrings(item, strings);
    }
  }
  return strings;
}

function collectRedactionValues(value, values = []) {
  if (typeof value === "string") values.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectRedactionValues(item, values);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value))
      collectRedactionValues(item, values);
  }
  return values;
}

export function detectBlindLeaks(value, forbiddenValues = []) {
  const strings = collectStrings(value);
  const content = strings.join("\n");
  const leaks = LEAK_PATTERNS.filter((pattern) => pattern.test(content)).map(
    (pattern) => String(pattern),
  );
  if (strings.some((item) => redactAbsolutePaths(item) !== item)) {
    leaks.push("absolute-path");
  }
  for (const forbidden of collectRedactionValues(forbiddenValues)) {
    if (typeof forbidden !== "string" || forbidden.length === 0) continue;
    if (
      strings.some((item) =>
        normalizedReplacementForms(forbidden).some((form) =>
          item.includes(form),
        ),
      )
    ) {
      leaks.push(`forbidden-value:${sha256(forbidden).slice(0, 12)}`);
    }
  }
  return [...new Set(leaks)];
}

function redactionEntries(subjectRedactions) {
  const entries = [];
  const visit = (value) => {
    if (typeof value === "string" && value.length > 0) {
      entries.push([value, "<SUBJECT-IDENTIFIER>"]);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(subjectRedactions);
  return entries;
}

function redactRun(run, aliases, campaignDir, subjectRedactions) {
  const replacements = [
    [campaignDir, "<CAMPAIGN>"],
    [resolve(campaignDir, "subjects"), "<SUBJECT>"],
    ...redactionEntries(subjectRedactions),
  ];
  return neutralizeBlindValue(run, replacements.concat(aliases));
}

function captureItemId(phase, index) {
  return `capture-${phase}-${String(index + 1).padStart(3, "0")}`;
}

function labelCaptureItems(material, phase) {
  const capture = material?.evidence?.capture;
  if (!Array.isArray(capture)) return material;
  return {
    ...material,
    evidence: {
      ...material.evidence,
      capture: capture.map((item, index) => ({
        ...item,
        id: captureItemId(phase, index),
      })),
    },
  };
}

async function readIf(path, fallback = null) {
  if (!(await exists(path))) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

async function readTextIf(path, fallback = null) {
  if (!(await exists(path))) return fallback;
  return readFile(path, "utf8");
}

async function phaseMaterial(campaignDir, unit, phase) {
  const root = resolve(
    campaignDir,
    "runs",
    unit.task_id,
    String(unit.attempt),
    unit.blind_label,
    phase,
  );
  const result = await readIf(resolve(root, "result.json"), {});
  const evidence = await readIf(resolve(root, "evidence.json"), {});
  const raw = (await exists(resolve(root, "opencode.jsonl")))
    ? parseOpenCodeJsonl(
        await readFile(resolve(root, "opencode.jsonl"), "utf8"),
      )
    : null;
  const exported = (await exists(resolve(root, "session.export.json")))
    ? parseOpenCodeExport(await readIf(resolve(root, "session.export.json")))
    : null;
  return {
    prompt: await readTextIf(resolve(root, "prompt.txt"), null),
    result: {
      status: result.status ?? null,
      exit_code: result.exit_code ?? null,
      duration_ms: result.duration_ms ?? null,
      timed_out: result.timed_out === true,
      tool_budget_exceeded: result.tool_budget_exceeded === true,
    },
    evidence: {
      usage: evidence.usage ?? null,
      tool_calls:
        evidence.tool_calls ?? raw?.tool_calls ?? exported?.tool_calls ?? null,
      final:
        evidence.final ?? exported?.final ?? raw?.final ?? result.final ?? null,
      filesystem_trace: evidence.filesystem_trace ?? [],
      selected_context: evidence.selected_context ?? [],
      capture: evidence.capture ?? [],
      knowledge_pre_snapshot: evidence.knowledge_pre_snapshot ?? [],
      knowledge_post_snapshot:
        evidence.knowledge_post_snapshot ?? evidence.knowledge_snapshot ?? [],
      knowledge_diff: evidence.knowledge_diff ?? [],
      knowledge_snapshot: evidence.knowledge_snapshot ?? [],
      source_or_test_changed: evidence.source_or_test_changed ?? false,
      path_escape_detected: evidence.path_escape_detected ?? false,
      network_violation_detected: evidence.network_violation_detected ?? false,
    },
    transcript: {
      normalized_events: (raw?.events ?? []).map((event) => ({
        type: event.type ?? null,
        tool: event.part?.tool ?? null,
        tool_status: event.part?.state?.status ?? null,
        text:
          event.type === "text" && typeof event.part?.text === "string"
            ? event.part.text
            : null,
      })),
      final:
        evidence.final ?? exported?.final ?? raw?.final ?? result.final ?? null,
    },
    workspace: {
      patch: await readTextIf(resolve(root, "workspace.patch"), ""),
      status: await readTextIf(resolve(root, "workspace-status.txt"), ""),
    },
  };
}

async function taskPrompt(campaignDir, taskId) {
  const candidates = [
    resolve(campaignDir, "tasks", `${taskId}.json`),
    resolve(campaignDir, "tasks", taskId, "task.json"),
  ];
  for (const path of candidates) {
    if (await exists(path)) {
      const task = await readIf(path, {});
      if (task.prompt) return task.prompt;
    }
  }
  const runsRoot = resolve(campaignDir, "runs", taskId);
  if (await exists(runsRoot)) {
    const { readdir } = await import("node:fs/promises");
    for (const attempt of await readdir(runsRoot)) {
      const attemptRoot = resolve(runsRoot, attempt);
      for (const arm of await readdir(attemptRoot)) {
        const root = resolve(attemptRoot, arm);
        const onboarding = await readTextIf(
          resolve(root, "onboarding", "prompt.txt"),
          null,
        );
        const repair = await readTextIf(
          resolve(root, "repair", "prompt.txt"),
          null,
        );
        if (onboarding || repair) return { onboarding, repair };
      }
    }
  }
  return null;
}

export async function createBlindBundle({
  campaignDir,
  pair,
  outputDir,
  subjectRedactions = [],
}) {
  if (!Array.isArray(pair) || pair.length !== 2) {
    throw new Error("blind pair must contain exactly two arms");
  }
  await mkdir(outputDir, { recursive: true });
  const sorted = [...pair].sort((left, right) =>
    left.blind_label.localeCompare(right.blind_label, "en"),
  );
  const aliases = new Map([
    [sorted[0].blind_label, "A"],
    [sorted[1].blind_label, "B"],
  ]);
  const arms = {};
  for (const unit of sorted) {
    const label = aliases.get(unit.blind_label);
    const runRoot = resolve(
      campaignDir,
      "runs",
      unit.task_id,
      String(unit.attempt),
      unit.blind_label,
    );
    const aliasesForRun = [
      [unit.blind_label, label],
      [runRoot, `<ARM-${label}>`],
    ];
    const verification = await readIf(
      resolve(runRoot, "verification", "verification.json"),
      null,
    );
    arms[label] = redactRun(
      {
        onboarding: labelCaptureItems(
          await phaseMaterial(campaignDir, unit, "onboarding"),
          "onboarding",
        ),
        repair: labelCaptureItems(
          await phaseMaterial(campaignDir, unit, "repair"),
          "repair",
        ),
        verification,
        verified_patch: await readTextIf(
          resolve(runRoot, "verification", "patch.diff"),
          "",
        ),
        verification_output: verification
          ? {
              focused: verification.focused ?? null,
              full: verification.full ?? null,
              clean_install: verification.clean_install ?? null,
            }
          : null,
      },
      aliasesForRun,
      campaignDir,
      subjectRedactions,
    );
  }
  const bundle = neutralizeBlindValue(
    {
      schema_version: "1.0",
      task_id: pair[0].task_id,
      attempt: pair[0].attempt,
      blind: true,
      task: {
        prompt: await taskPrompt(campaignDir, pair[0].task_id),
      },
      arms,
      rubric: {
        hard_correctness: ["hidden tests", "full suite", "regression safety"],
        quality: [
          "correctness",
          "regression safety",
          "scope discipline",
          "knowledge retrieval and trust",
          "capture value",
          "test evidence",
          "final delivery",
        ],
        winner: "A, B, or tie",
      },
    },
    [
      [campaignDir, "<CAMPAIGN>"],
      [resolve(campaignDir, "subjects"), "<SUBJECT>"],
      ...redactionEntries(subjectRedactions),
    ],
  );
  const leaks = detectBlindLeaks(bundle, subjectRedactions);
  if (leaks.length > 0)
    throw new Error(
      `blind bundle contains identity leaks: ${leaks.join(", ")}`,
    );
  const path = resolve(outputDir, "bundle.json");
  await writeJson(path, bundle);
  await assertNoVersionLeak(path, subjectRedactions);
  return { path, sha256: sha256(await readFile(path)) };
}

function executable() {
  if (process.env.OPENCODE_EXECUTABLE) return process.env.OPENCODE_EXECUTABLE;
  if (process.platform !== "win32") return "opencode";
  for (const entry of String(process.env.PATH ?? "").split(";")) {
    if (!entry) continue;
    const candidate = resolve(
      entry,
      "node_modules/opencode-ai/bin/opencode.exe",
    );
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "cannot resolve opencode.exe; set OPENCODE_EXECUTABLE to the real binary",
  );
}

function reviewerPrompt(bundle) {
  return `You are an independent blind reviewer. The complete evidence is already attached as bundle.json. Do not call any tool, edit files, access the network, or guess which implementation produced either arm. Correctness and regression safety are hard gates; efficiency cannot offset a failed task. Return ONLY one JSON object with exactly these top-level keys: schema_version, task_id, attempt, arms, winner, scores, rationale. Use this exact structural template: {"schema_version":"1.0","task_id":${JSON.stringify(bundle.task_id)},"attempt":${bundle.attempt},"arms":{"A":"A","B":"B"},"winner":"tie","scores":{"A":{"correctness":"pass","regression_safety":"pass","scope_discipline":3,"knowledge_retrieval_credibility":3,"capture_value":3,"test_evidence":3,"final_delivery":3},"B":{"correctness":"pass","regression_safety":"pass","scope_discipline":3,"knowledge_retrieval_credibility":3,"capture_value":3,"test_evidence":3,"final_delivery":3}},"rationale":"..."}. correctness and regression_safety must each be pass, fail, or uncertain. The remaining five dimensions must each be an integer from 1 through 5. Each arm may optionally include capture_item_labels, an array of {"id":"...","verdict":"low-value|not-low-value|unresolved"} objects, only when the bundle exposes individual Capture items. winner must be exactly A, B, or tie; arms must remain literal neutral labels A and B.`;
}

export function parseVerdictText(text, expected = {}) {
  const trimmed = String(text ?? "").trim();
  const fenced =
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("reviewer did not return a JSON object");
  const value = JSON.parse(fenced.slice(start, end + 1));
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "arms",
    "attempt",
    "rationale",
    "schema_version",
    "scores",
    "task_id",
    "winner",
  ];
  if (stableJson(keys) !== stableJson(expectedKeys))
    throw new Error("reviewer verdict has unexpected top-level keys");
  if (value.schema_version !== "1.0")
    throw new Error("reviewer schema_version is invalid");
  if (expected.task_id !== undefined && value.task_id !== expected.task_id)
    throw new Error("reviewer task_id is invalid");
  if (expected.attempt !== undefined && value.attempt !== expected.attempt)
    throw new Error("reviewer attempt is invalid");
  if (stableJson(value.arms) !== stableJson({ A: "A", B: "B" })) {
    throw new Error("reviewer arms must remain neutral A/B labels");
  }
  if (!["A", "B", "tie"].includes(value.winner))
    throw new Error("reviewer winner is invalid");
  validateVerdictScores(value.scores, "reviewer scores");
  validateVerdictWinner(value.scores, value.winner, "reviewer verdict");
  if (typeof value.rationale !== "string" || !value.rationale.trim())
    throw new Error("reviewer rationale is invalid");
  return value;
}

export function validateReviewerExecution(execution, parsed) {
  if (
    execution.exitCode !== 0 ||
    execution.timedOut ||
    parsed.errors.length > 0
  ) {
    throw new Error("blind reviewer execution failed");
  }
  if (parsed.tool_calls !== 0) {
    throw new Error(
      "blind reviewer execution failed: tool calls are forbidden",
    );
  }
  if (parsed.response_usage.length === 0 || !parsed.final?.trim()) {
    throw new Error("blind reviewer returned no measured response");
  }
}

async function runProcess(args, options) {
  return new Promise((resolvePromise) => {
    const child = spawn(executable(), args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code ?? 1,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export async function runBlindReview({
  campaign,
  bundlePath,
  outputDir,
  campaignRoot = null,
}) {
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const environmentFactory = globalThis.__SELF_EVOLUTION_EXTERNAL_ENVIRONMENT__;
  if (typeof environmentFactory !== "function") {
    throw new Error("OpenCode isolation environment is unavailable");
  }
  const isolated = await environmentFactory({
    model: campaign.review_model,
    skillDir: null,
    workspaceDir: dirname(bundlePath),
    outputDir,
    maxToolCalls: 1,
    readOnly: true,
    campaignRoot,
  });
  try {
    const args = [
      "run",
      reviewerPrompt(bundle),
      "--model",
      campaign.review_model,
      "--format",
      "json",
      "--pure",
      "--agent",
      isolated.agentName,
      "--dir",
      dirname(bundlePath),
      "--file",
      bundlePath,
    ];
    const execution = await runProcess(args, {
      cwd: dirname(bundlePath),
      env: isolated.env,
      timeoutMs: campaign.review?.timeout_ms ?? 45 * 60 * 1000,
    });
    await writeFile(
      resolve(outputDir, "review.jsonl"),
      execution.stdout,
      "utf8",
    );
    await writeFile(
      resolve(outputDir, "review.stderr.txt"),
      execution.stderr,
      "utf8",
    );
    const parsed = parseOpenCodeJsonl(execution.stdout);
    validateReviewerExecution(execution, parsed);
    const verdict = parseVerdictText(parsed.final, {
      task_id: bundle.task_id,
      attempt: bundle.attempt,
    });
    await writeJson(resolve(outputDir, "verdict.json"), verdict);
    return verdict;
  } finally {
    await isolated.cleanup();
  }
}
