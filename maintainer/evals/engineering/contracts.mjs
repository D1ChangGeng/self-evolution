import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  fixtureContractDigest,
  stableJson,
  validateFixtureContract,
} from "../contract.mjs";

export const ENGINEERING_SCHEMA = "engineering-episodes/2";
export const POLICY_VERSION = "engineering-policy/1.0.0";
export const REQUIRED_OUTCOMES = Object.freeze([
  "function",
  "regression",
  "architecture",
  "permission",
  "scope",
]);
export const SESSION_BOUNDARIES = new Set([
  "normal",
  "compaction",
  "forced-interrupt",
]);

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

function fail(name, message) {
  throw new Error(`${name}: ${message}`);
}

function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(name, "must be an object");
  return value;
}

function exact(value, fields, name) {
  record(value, name);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (stableJson(actual) !== stableJson(expected))
    fail(name, `fields must be exactly ${expected.join(", ")}`);
}

function string(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    fail(name, "must be a non-empty string");
}

function strings(value, name, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum)
    fail(name, `must contain at least ${minimum} strings`);
  value.forEach((item, index) => string(item, `${name}[${index}]`));
  if (new Set(value).size !== value.length) fail(name, "must be unique");
}

function safePath(value, name) {
  string(value, name);
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail(name, "must be a safe POSIX relative path");
}

function validateSetup(setup, name) {
  exact(setup, ["files", "assertions"], name);
  if (!Array.isArray(setup.files) || setup.files.length < 2)
    fail(`${name}.files`, "must contain an executable project");
  const paths = new Set();
  for (const [index, file] of setup.files.entries()) {
    exact(file, ["path", "role", "content"], `${name}.files[${index}]`);
    safePath(file.path, `${name}.files[${index}].path`);
    string(file.role, `${name}.files[${index}].role`);
    if (typeof file.content !== "string")
      fail(`${name}.files[${index}].content`, "must be a string");
    if (paths.has(file.path)) fail(name, `duplicate file ${file.path}`);
    paths.add(file.path);
  }
  if (!Array.isArray(setup.assertions) || setup.assertions.length === 0)
    fail(`${name}.assertions`, "must be non-empty");
  for (const assertion of setup.assertions) {
    if (!paths.has(assertion.path))
      fail(name, `assertion references absent file ${assertion.path}`);
  }
}

function validateRubric(rubric, name) {
  exact(rubric, ["judge", "pass_rule", "required", "forbidden"], name);
  if (rubric.pass_rule !== "all-required-and-no-forbidden")
    fail(`${name}.pass_rule`, "must require all and forbid all");
  for (const group of ["required", "forbidden"]) {
    if (!Array.isArray(rubric[group]) || rubric[group].length === 0)
      fail(`${name}.${group}`, "must be non-empty");
    for (const item of rubric[group]) {
      exact(item, ["id", "description", "evidence"], `${name}.${group}`);
      string(item.id, `${name}.${group}.id`);
      string(item.description, `${name}.${group}.description`);
      strings(item.evidence, `${name}.${group}.evidence`);
    }
  }
}

export function validateEpisode(episode, name = episode?.id ?? "episode") {
  exact(
    episode,
    [
      "id",
      "class",
      "variant",
      "level",
      "fixture",
      "task",
      "setup",
      "verifier",
      "action_rubric",
      "sessions",
      "transfer",
      "protected_verifiers",
      "collection",
      "scenario",
      "contract_sha256",
    ],
    name,
  );
  if (!/^C(?:0[1-9]|1[0-2])-[AB]$/.test(episode.id))
    fail(`${name}.id`, "must be C01-A through C12-B");
  if (episode.variant !== episode.id.at(-1)) fail(name, "variant mismatch");
  if (!["L1", "L1+L3"].includes(episode.level)) fail(name, "invalid level");
  exact(
    episode.fixture,
    ["id", "directory", "contract_sha256"],
    `${name}.fixture`,
  );
  string(episode.task, `${name}.task`);
  validateSetup(episode.setup, `${name}.setup`);
  exact(
    episode.scenario,
    [
      "setup",
      "history",
      "sessions",
      "checks",
      "capture",
      "writable_paths",
      "durable_paths",
      "probe",
    ],
    `${name}.scenario`,
  );
  validateSetup(episode.scenario.setup, `${name}.scenario.setup`);
  if (
    episode.scenario.capture !== "none" &&
    episode.scenario.capture !== "required"
  )
    fail(name, "scenario.capture invalid");
  for (const path of episode.scenario.writable_paths)
    string(path, `${name}.scenario.writable_paths`);
  for (const path of episode.scenario.durable_paths)
    string(path, `${name}.scenario.durable_paths`);
  if (episode.scenario.probe !== null)
    string(episode.scenario.probe, `${name}.scenario.probe`);
  exact(
    episode.scenario.checks,
    ["initial", "function", "regression", "architecture"],
    `${name}.scenario.checks`,
  );
  if (!["pass", "fail"].includes(episode.scenario.checks.initial.expected))
    fail(name, "initial expected invalid");
  for (const key of ["initial", "function", "regression", "architecture"]) {
    exact(
      episode.scenario.checks[key],
      key === "initial" ? ["script", "expected"] : ["script"],
      `${name}.scenario.checks.${key}`,
    );
    string(
      episode.scenario.checks[key].script,
      `${name}.scenario.checks.${key}.script`,
    );
  }
  exact(
    episode.verifier,
    ["kind", "entry", "expected_initial_status"],
    `${name}.verifier`,
  );
  safePath(episode.verifier.entry, `${name}.verifier.entry`);
  validateRubric(episode.action_rubric, `${name}.action_rubric`);
  if (!Array.isArray(episode.sessions) || episode.sessions.length === 0)
    fail(`${name}.sessions`, "must be non-empty");
  episode.sessions.forEach((session, index) => {
    exact(
      session,
      ["id", "actor", "boundary", "objective", "must_leave", "offline_patch"],
      `${name}.sessions[${index}]`,
    );
    if (session.id !== index + 1) fail(name, "session IDs must be sequential");
    if (!SESSION_BOUNDARIES.has(session.boundary))
      fail(name, "invalid boundary");
    string(session.actor, `${name}.sessions[${index}].actor`);
    string(session.objective, `${name}.sessions[${index}].objective`);
    strings(session.must_leave, `${name}.sessions[${index}].must_leave`);
    if (!Array.isArray(session.offline_patch))
      fail(name, "offline_patch must be an array");
    for (const patch of session.offline_patch) {
      exact(patch, ["path", "content"], `${name}.offline_patch`);
      safePath(patch.path, `${name}.offline_patch.path`);
      if (patch.content !== null && typeof patch.content !== "string")
        fail(name, "offline_patch content must be string or null");
    }
  });
  exact(
    episode.transfer,
    ["required", "allowed", "reject", "mismatch_probe"],
    `${name}.transfer`,
  );
  strings(episode.transfer.allowed, `${name}.transfer.allowed`);
  strings(episode.transfer.reject, `${name}.transfer.reject`, 0);
  if (!Array.isArray(episode.protected_verifiers))
    fail(name, "protected_verifiers must be an array");
  const outcomes = episode.protected_verifiers.map((item) => item.outcome);
  if (stableJson(outcomes) !== stableJson(REQUIRED_OUTCOMES))
    fail(
      name,
      `protected verifier order must be ${REQUIRED_OUTCOMES.join(", ")}`,
    );
  for (const item of episode.protected_verifiers) {
    exact(item, ["outcome", "kind", "expected"], `${name}.protected_verifiers`);
    string(item.kind, `${name}.protected_verifiers.kind`);
  }
  exact(
    episode.collection,
    ["raw", "derived", "evidence_status", "provenance"],
    `${name}.collection`,
  );
  strings(episode.collection.raw, `${name}.collection.raw`);
  strings(episode.collection.derived, `${name}.collection.derived`);
  if (episode.collection.evidence_status !== "fixture-synthetic")
    fail(name, "offline contracts must identify fixture-synthetic evidence");
  if (
    !["real-subprocess-session-boundary", "injected-fixture-context"].includes(
      episode.collection.provenance,
    )
  )
    fail(
      name,
      "collection provenance must identify the session evidence source",
    );
  const unsigned = { ...episode };
  delete unsigned.contract_sha256;
  if (sha256(stableJson(unsigned)) !== episode.contract_sha256)
    fail(name, "contract_sha256 mismatch");
  return episode;
}

export async function loadEpisodes(
  path = resolve(import.meta.dirname, "episodes.json"),
) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  exact(
    manifest,
    ["schema", "policy_version", "status", "episodes", "campaign"],
    "episodes manifest",
  );
  if (manifest.schema !== ENGINEERING_SCHEMA)
    fail("manifest", "unsupported schema");
  if (manifest.policy_version !== POLICY_VERSION)
    fail("manifest", "policy mismatch");
  if (!Array.isArray(manifest.episodes) || manifest.episodes.length !== 24)
    fail("manifest", "must contain exactly 24 episodes");
  const ids = new Set();
  for (const episode of manifest.episodes) {
    validateEpisode(episode);
    if (ids.has(episode.id)) fail("manifest", `duplicate ${episode.id}`);
    ids.add(episode.id);
  }
  for (let number = 1; number <= 12; number += 1)
    for (const variant of ["A", "B"])
      if (!ids.has(`C${String(number).padStart(2, "0")}-${variant}`))
        fail("manifest", "episode matrix is incomplete");
  return manifest;
}

export async function fixtureBinding(evalRoot, directory) {
  const root = resolve(evalRoot, "fixtures", directory);
  const fixture = JSON.parse(
    await readFile(resolve(root, "fixture.json"), "utf8"),
  );
  validateFixtureContract(fixture, directory);
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  return {
    fixture,
    sha256: fixtureContractDigest(directory, fixture, readme),
  };
}
