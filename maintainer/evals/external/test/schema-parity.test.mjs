import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve("maintainer/evals/external");

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

function property(schema, name) {
  const value = schema.properties?.[name];
  assert.ok(value, `campaign schema must declare ${name}`);
  return value;
}

function dereference(schema, value) {
  if (!value?.$ref) return value;
  const prefix = "#/$defs/";
  assert.ok(
    value.$ref.startsWith(prefix),
    `unsupported local ref ${value.$ref}`,
  );
  const definition = schema.$defs?.[value.$ref.slice(prefix.length)];
  assert.ok(definition, `missing definition for ${value.$ref}`);
  return definition;
}

function absolutePathSchema(schema, name) {
  return dereference(schema, property(schema, name));
}

test("campaign schema and README stay bound to the formal isolation contract", async () => {
  const [
    schema,
    campaign,
    confinement,
    confinementModule,
    isolationModule,
    readme,
  ] = await Promise.all([
    json("schemas/campaign.schema.json"),
    source("lib/campaign.mjs"),
    source("lib/confinement.mjs"),
    import("../lib/confinement.mjs"),
    import("../lib/opencode.mjs"),
    source("README.md"),
  ]);

  for (const required of [
    "repository_root_sha256",
    "campaign_root",
    "execution_root",
    "environment",
    "execution_assurance",
    "smoke",
  ]) {
    assert.ok(
      schema.required.includes(required),
      `${required} must be required`,
    );
    property(schema, required);
  }

  assert.equal(
    dereference(schema, property(schema, "repository_root_sha256")).pattern,
    "^[0-9a-f]{64}$",
  );
  for (const name of ["campaign_root", "execution_root"]) {
    assert.equal(absolutePathSchema(schema, name).type, "string");
    assert.match(
      absolutePathSchema(schema, name).pattern,
      /A-Za-z/,
      `${name} must reject relative paths`,
    );
  }
  assert.equal(schema.additionalProperties, false);

  const smoke = dereference(schema, property(schema, "smoke"));
  for (const field of [
    "artifact",
    "sha256",
    "environment_artifact",
    "environment_sha256",
  ]) {
    assert.ok(smoke.required.includes(field), `smoke must require ${field}`);
  }

  const subjects = dereference(schema, property(schema, "subjects"));
  assert.deepEqual(subjects.required, ["v1", "v2"]);
  assert.equal(subjects.additionalProperties, false);

  const sourceContracts = JSON.stringify({
    ...isolationModule.EXTERNAL_ISOLATION_CONTRACT,
    ...confinementModule.CONFINEMENT_CONTRACT,
  });
  const formalConstants = [
    "windows-restricted-token",
    "reversible-forbidden-acl",
    "wsl-bwrap",
    "deny-first-command-allowlist",
    "disk-only",
  ];
  for (const constant of formalConstants) {
    assert.match(sourceContracts, new RegExp(constant));
    assert.match(JSON.stringify(schema), new RegExp(constant));
    assert.match(readme, new RegExp(constant));
  }

  for (const contractTerm of [
    "SELF_EVOLUTION_EXTERNAL_EXECUTION_ROOT",
    "CodexSandboxUsers",
    "acl-applied.json",
    "acl-restored.json",
    "forbidden_junction_read",
  ]) {
    assert.match(confinement, new RegExp(contractTerm));
    assert.match(readme, new RegExp(contractTerm));
  }

  for (const term of [
    "repository_root_sha256",
    "campaign_root",
    "execution_root",
  ]) {
    assert.match(campaign, new RegExp(term.replace(".", "\\.")));
    assert.match(JSON.stringify(schema), new RegExp(term.replace(".", "\\.")));
    assert.match(readme, new RegExp(term.replace(".", "\\.")));
  }

  assert.match(campaign, /AGENTS\.md/);
  assert.match(readme, /AGENTS\.md/);

  for (const nestedTerm of [
    "confinement?.execution",
    "confinement?.review",
    "credentials?.execution",
    "credentials?.review",
    "network_namespace_canaries?.execution",
    "network_namespace_canaries?.review",
    "restore_receipt_sha256",
    "content_env_absent",
    "receipt_status",
  ]) {
    assert.ok(
      campaign.includes(nestedTerm),
      `smoke gate must bind nested environment field ${nestedTerm}`,
    );
  }

  for (const readmeTerm of [
    "execution and review probes",
    "content is not passed through",
    "invocation-receipt digest",
    "failure to restore",
  ]) {
    assert.match(readme, new RegExp(readmeTerm));
  }
});

test("campaign schema isolation constants match source declarations exactly", async () => {
  const [schema, campaign, opencode] = await Promise.all([
    json("schemas/campaign.schema.json"),
    import("../lib/campaign.mjs"),
    source("lib/opencode.mjs"),
  ]);
  const environment = property(schema, "environment").const;
  assert.deepEqual(environment, campaign.DEFAULT_CONFIG.environment);
  assert.deepEqual(
    property(schema, "execution_assurance").const,
    campaign.DEFAULT_CONFIG.execution_assurance,
  );
  assert.equal(
    property(schema, "toolchain_shim_enforcement").const,
    campaign.DEFAULT_CONFIG.toolchain_shim_enforcement,
  );
  assert.deepEqual(
    property(schema, "toolchain").const,
    campaign.DEFAULT_CONFIG.toolchain,
  );
  for (const [key, value] of Object.entries(environment)) {
    assert.match(opencode, new RegExp(`${key}[^\\n]*${value}`));
  }
});
