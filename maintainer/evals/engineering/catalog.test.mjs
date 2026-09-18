import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadEpisodes } from "./contracts.mjs";

const exec = promisify(execFile);
async function put(root, path, content) {
  const target = resolve(root, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  if (content === null) await rm(target, { force: true, recursive: true });
  else await writeFile(target, content);
}
async function check(root, script, env = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "engineering-check-"));
  const entry = resolve(directory, "check.mjs");
  await writeFile(entry, script);
  try {
    await exec(process.execPath, [entry], {
      cwd: directory,
      env: {
        ...process.env,
        PROJECT_ROOT: root,
        NODE_OPTIONS: "--experimental-strip-types",
        ...env,
      },
      timeout: 10_000,
    });
    return "pass";
  } catch {
    return "fail";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("all 24 catalogs execute initial and protected checks", async (t) => {
  const manifest = await loadEpisodes();
  for (const episode of manifest.episodes) {
    await t.test(episode.id, async () => {
      const root = await mkdtemp(resolve(tmpdir(), `catalog-${episode.id}-`));
      for (const file of episode.setup.files)
        await put(root, file.path, file.content);
      assert.equal(
        await check(root, episode.scenario.checks.initial.script),
        episode.scenario.checks.initial.expected,
      );
      for (const session of episode.scenario.sessions)
        for (const patch of session.offline_patch)
          await put(root, patch.path, patch.content);
      for (const kind of ["function", "regression", "architecture"])
        assert.equal(
          await check(root, episode.scenario.checks[kind].script),
          "pass",
          `${kind} check failed`,
        );
      assert.equal(
        episode.setup.files.some(
          (file) =>
            file.path.includes("verification") ||
            file.content.includes("PROJECT_ROOT"),
        ),
        false,
        "hidden checks leaked into project",
      );
      await rm(root, { recursive: true, force: true });
    });
  }
});

test("catalog rejects vacuous and self-attested checks", async () => {
  const manifest = await loadEpisodes();
  const forbidden =
    /assert\.ok\(true\)|equal\(1\s*,\s*1\)|typeof .*function|CAS_PROBE|TASK-RESULT|offline-task-result/;
  for (const episode of manifest.episodes) {
    for (const value of Object.values(episode.scenario.checks))
      assert.doesNotMatch(value.script, forbidden, episode.id);
    assert.equal(
      episode.setup.files.some((item) => item.role === "knowledge"),
      false,
    );
    assert.ok(
      episode.scenario.sessions.some((item) =>
        item.offline_patch.some((change) => change.path.startsWith("src/")),
      ),
      `${episode.id} must patch source code`,
    );
  }
});
