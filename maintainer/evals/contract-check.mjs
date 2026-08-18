import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fixtureContractDigest, validateFixtureContract } from "./contract.mjs";

const fixturesRoot = resolve(import.meta.dirname, "fixtures");
const exec = promisify(execFile);
const verifierPath = resolve(import.meta.dirname, "verify-fixture.mjs");

async function loadFixture(directoryName) {
  const root = resolve(fixturesRoot, directoryName);
  return {
    fixture: JSON.parse(await readFile(resolve(root, "fixture.json"), "utf8")),
    readme: await readFile(resolve(root, "README.md"), "utf8"),
  };
}

test("all numbered fixtures satisfy the executable contract", async () => {
  const directories = (await readdir(fixturesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  assert.equal(directories.length, 13);
  for (const directory of directories) {
    const { fixture } = await loadFixture(directory.name);
    assert.doesNotThrow(() => validateFixtureContract(fixture, directory.name));
  }
});

test("all fixture setups materialize and match their declared initial verifier status", async () => {
  const directories = (await readdir(fixturesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const directory of directories) {
    const { fixture } = await loadFixture(directory.name);
    const root = await mkdtemp(
      resolve(tmpdir(), `self-evolution-${fixture.id}-`),
    );
    for (const file of fixture.setup.files) {
      const path = resolve(root, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, "utf8");
    }
    for (const assertion of fixture.setup.assertions) {
      const path = resolve(root, assertion.path);
      if (assertion.kind === "file-absent") {
        await assert.rejects(readFile(path));
        continue;
      }
      const content = await readFile(path, "utf8");
      if (assertion.kind === "file-contains") {
        assert.ok(content.includes(assertion.value), assertion.id);
      }
    }
    try {
      await exec(process.execPath, [verifierPath, fixture.verifier.entry], {
        cwd: root,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      assert.equal(
        fixture.verifier.expected_initial_status,
        "pass",
        fixture.id,
      );
    } catch (error) {
      assert.equal(
        fixture.verifier.expected_initial_status,
        "fail",
        fixture.id,
      );
      assert.notEqual(error.code, 0, fixture.id);
    }
  }
});

test("contract digest changes when a rubric or README changes", async () => {
  const directoryName = "01-cross-module-defect";
  const { fixture, readme } = await loadFixture(directoryName);
  const original = fixtureContractDigest(directoryName, fixture, readme);
  const changedRubric = structuredClone(fixture);
  changedRubric.action_rubric.required[0].description += " with current bytes";
  assert.notEqual(
    fixtureContractDigest(directoryName, changedRubric, readme),
    original,
  );
  assert.notEqual(
    fixtureContractDigest(
      directoryName,
      fixture,
      `${readme}\nExtra setup note.\n`,
    ),
    original,
  );
});

test("contract rejects self-certified setup and prose-only rubrics", async () => {
  const directoryName = "01-cross-module-defect";
  const { fixture } = await loadFixture(directoryName);
  const brokenSetup = structuredClone(fixture);
  brokenSetup.setup.assertions[0].path = "../outside.ts";
  assert.throws(
    () => validateFixtureContract(brokenSetup, directoryName),
    /safe POSIX-style relative path/,
  );

  const brokenRubric = structuredClone(fixture);
  brokenRubric.action_rubric.required[0].evidence = ["answer-mentions-keyword"];
  assert.throws(
    () => validateFixtureContract(brokenRubric, directoryName),
    /is not one of/,
  );
});

test("runner keeps wrong-knowledge judgment pending and separates source change", async () => {
  const runner = await readFile(
    resolve(import.meta.dirname, "run.mjs"),
    "utf8",
  );
  assert.match(runner, /"source-change-detection"/);
  assert.match(
    runner,
    /evidenceGate\(\s*integratedEvidence,\s*"wrong-knowledge-detection",\s*"The deterministic boundary probe/s,
  );
  assert.doesNotMatch(runner, /"wrong-knowledge-and-source-change"/);
});

test("migration semantic preservation has an executable evidence path", async () => {
  const runner = await readFile(
    resolve(import.meta.dirname, "run.mjs"),
    "utf8",
  );
  const evidence = await readFile(
    resolve(import.meta.dirname, "evidence.mjs"),
    "utf8",
  );
  assert.match(
    evidence,
    /"migration-semantic-preservation", \["migration-semantic-corpus"\]/,
  );
  assert.match(
    runner,
    /evidenceGate\(\s*integratedEvidence,\s*"migration-semantic-preservation"/s,
  );
  assert.doesNotMatch(
    runner,
    /gate\(\s*"migration-semantic-preservation",\s*"pending"/s,
  );
});
