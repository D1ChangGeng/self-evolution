import { createHash } from "node:crypto";

const PROJECT_CLASSES = new Set(["empty", "brownfield", "multi-module"]);
const DETERMINISTIC_PROBES = new Set([
  "adapter-ownership",
  "default-init",
  "fixture-contract",
  "migration-rollback",
  "no-capture-write",
  "source-change",
  "wrong-knowledge-boundary",
]);
const SETUP_ROLES = new Set([
  "agents",
  "checkpoint",
  "config",
  "decision",
  "documentation",
  "knowledge",
  "runbook",
  "source",
  "test",
]);
const ASSERTION_KINDS = new Set([
  "file-absent",
  "file-contains",
  "file-exists",
]);
const RUBRIC_JUDGES = new Set([
  "blinded-review",
  "program-plus-blinded-review",
]);
const EVIDENCE_KINDS = new Set([
  "blinded-judgment",
  "command-results",
  "configuration-diff",
  "filesystem-snapshot",
  "final-response",
  "knowledge-diff",
  "patch",
  "retrieval-log",
  "test-results",
  "tool-transcript",
]);
const VERIFIER_KINDS = new Set(["node-test"]);

const TOP_LEVEL_FIELDS = [
  "schema_version",
  "id",
  "task_class",
  "project_class",
  "task",
  "expected_retrieval",
  "material_claims",
  "capture_expectation",
  "deterministic_probe",
  "semantic_status",
  "provenance",
  "setup",
  "verifier",
  "action_rubric",
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function fail(name, message) {
  throw new Error(`${name}: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactFields(value, expected, name) {
  if (!isRecord(value)) fail(name, "must be an object");
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const wanted = [...expected].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(
      name,
      `fields must be exactly ${wanted.join(", ")}; received ${actual.join(", ")}`,
    );
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(name, "must be a non-empty string");
  }
}

function requireStringArray(value, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(name, `must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    requireString(item, `${name}[${index}]`);
    if (seen.has(item)) fail(name, `contains duplicate value ${item}`);
    seen.add(item);
  }
}

function requireId(value, name) {
  requireString(value, name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    fail(name, "must be a lowercase kebab-case identifier");
  }
}

function requireRelativePath(value, name) {
  requireString(value, name);
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "" || segment === "..") ||
    /^[A-Za-z]:/.test(value)
  ) {
    fail(name, "must be a safe POSIX-style relative path");
  }
}

function validateSetup(setup, name) {
  requireExactFields(setup, ["files", "assertions"], name);
  if (!Array.isArray(setup.files) || setup.files.length === 0) {
    fail(`${name}.files`, "must be a non-empty array");
  }
  if (!Array.isArray(setup.assertions) || setup.assertions.length === 0) {
    fail(`${name}.assertions`, "must be a non-empty array");
  }

  const files = new Map();
  for (const [index, file] of setup.files.entries()) {
    const itemName = `${name}.files[${index}]`;
    requireExactFields(file, ["path", "role", "content"], itemName);
    requireRelativePath(file.path, `${itemName}.path`);
    if (!SETUP_ROLES.has(file.role)) {
      fail(`${itemName}.role`, `must be one of ${[...SETUP_ROLES].join(", ")}`);
    }
    requireString(file.content, `${itemName}.content`);
    if (files.has(file.path)) fail(`${name}.files`, `duplicates ${file.path}`);
    files.set(file.path, file.content);
  }

  const assertionIds = new Set();
  for (const [index, assertion] of setup.assertions.entries()) {
    const itemName = `${name}.assertions[${index}]`;
    if (!isRecord(assertion)) fail(itemName, "must be an object");
    const expectedFields =
      assertion.kind === "file-contains"
        ? ["id", "kind", "path", "value"]
        : ["id", "kind", "path"];
    requireExactFields(assertion, expectedFields, itemName);
    requireId(assertion.id, `${itemName}.id`);
    if (assertionIds.has(assertion.id)) {
      fail(`${name}.assertions`, `duplicates id ${assertion.id}`);
    }
    assertionIds.add(assertion.id);
    if (!ASSERTION_KINDS.has(assertion.kind)) {
      fail(
        `${itemName}.kind`,
        `must be one of ${[...ASSERTION_KINDS].join(", ")}`,
      );
    }
    requireRelativePath(assertion.path, `${itemName}.path`);
    const content = files.get(assertion.path);
    if (assertion.kind === "file-absent" && content !== undefined) {
      fail(itemName, `${assertion.path} is present in setup.files`);
    }
    if (assertion.kind === "file-exists" && content === undefined) {
      fail(itemName, `${assertion.path} is absent from setup.files`);
    }
    if (assertion.kind === "file-contains") {
      requireString(assertion.value, `${itemName}.value`);
      if (content === undefined || !content.includes(assertion.value)) {
        fail(itemName, `${assertion.path} does not contain the asserted value`);
      }
    }
  }
}

function validateRubricItems(items, name, ids) {
  if (!Array.isArray(items) || items.length === 0) {
    fail(name, "must be a non-empty array");
  }
  for (const [index, item] of items.entries()) {
    const itemName = `${name}[${index}]`;
    requireExactFields(item, ["id", "description", "evidence"], itemName);
    requireId(item.id, `${itemName}.id`);
    if (ids.has(item.id)) fail(name, `duplicates rubric id ${item.id}`);
    ids.add(item.id);
    requireString(item.description, `${itemName}.description`);
    requireStringArray(item.evidence, `${itemName}.evidence`);
    for (const evidence of item.evidence) {
      if (!EVIDENCE_KINDS.has(evidence)) {
        fail(
          `${itemName}.evidence`,
          `${evidence} is not one of ${[...EVIDENCE_KINDS].join(", ")}`,
        );
      }
    }
  }
}

function validateActionRubric(rubric, name) {
  requireExactFields(
    rubric,
    ["judge", "pass_rule", "required", "forbidden"],
    name,
  );
  if (!RUBRIC_JUDGES.has(rubric.judge)) {
    fail(`${name}.judge`, `must be one of ${[...RUBRIC_JUDGES].join(", ")}`);
  }
  if (rubric.pass_rule !== "all-required-and-no-forbidden") {
    fail(`${name}.pass_rule`, "must be all-required-and-no-forbidden");
  }
  const ids = new Set();
  validateRubricItems(rubric.required, `${name}.required`, ids);
  validateRubricItems(rubric.forbidden, `${name}.forbidden`, ids);
}

function validateVerifier(verifier, setup, name) {
  requireExactFields(
    verifier,
    ["kind", "entry", "expected_initial_status"],
    name,
  );
  if (!VERIFIER_KINDS.has(verifier.kind)) {
    fail(`${name}.kind`, `must be one of ${[...VERIFIER_KINDS].join(", ")}`);
  }
  requireRelativePath(verifier.entry, `${name}.entry`);
  if (!["pass", "fail"].includes(verifier.expected_initial_status)) {
    fail(`${name}.expected_initial_status`, "must be pass or fail");
  }
  if (!setup.files.some((file) => file.path === verifier.entry)) {
    fail(`${name}.entry`, "must reference a file in setup.files");
  }
}

export function validateFixtureContract(fixture, directoryName) {
  const name = directoryName || "fixture";
  requireExactFields(fixture, TOP_LEVEL_FIELDS, name);
  if (fixture.schema_version !== "1.0") {
    fail(`${name}.schema_version`, "must be 1.0");
  }
  requireId(fixture.id, `${name}.id`);
  if (directoryName && !directoryName.endsWith(`-${fixture.id}`)) {
    fail(name, `directory name must end with -${fixture.id}`);
  }
  if (!Number.isInteger(fixture.task_class) || fixture.task_class < 1) {
    fail(`${name}.task_class`, "must be a positive integer");
  }
  if (!PROJECT_CLASSES.has(fixture.project_class)) {
    fail(
      `${name}.project_class`,
      `must be one of ${[...PROJECT_CLASSES].join(", ")}`,
    );
  }
  for (const field of ["task", "capture_expectation", "provenance"]) {
    requireString(fixture[field], `${name}.${field}`);
  }
  requireStringArray(fixture.expected_retrieval, `${name}.expected_retrieval`);
  requireStringArray(fixture.material_claims, `${name}.material_claims`, {
    allowEmpty: true,
  });
  if (!DETERMINISTIC_PROBES.has(fixture.deterministic_probe)) {
    fail(
      `${name}.deterministic_probe`,
      `must be one of ${[...DETERMINISTIC_PROBES].join(", ")}`,
    );
  }
  if (fixture.semantic_status !== "pending") {
    fail(`${name}.semantic_status`, "must remain pending without run evidence");
  }
  validateSetup(fixture.setup, `${name}.setup`);
  validateVerifier(fixture.verifier, fixture.setup, `${name}.verifier`);
  validateActionRubric(fixture.action_rubric, `${name}.action_rubric`);
}

export function fixtureContractDigest(directoryName, fixture, readme) {
  const normalizedReadme = readme.replace(/\r\n?/g, "\n");
  return createHash("sha256")
    .update(directoryName)
    .update("\0")
    .update(stableJson(fixture))
    .update("\0")
    .update(normalizedReadme)
    .digest("hex");
}
