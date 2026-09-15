import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";
import { loadEpisodes } from "./contracts.mjs";

const exec = promisify(execFile);
const repo = resolve(import.meta.dirname, "../../..");
const kb = resolve(repo, "skills/self-evolution/references/bin/kb.mjs");
async function put(root, path, content) {
  const target = resolve(root, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, content);
}
function knowledgePath(item) {
  if (item.path.startsWith(".agents/knowledge/")) return item.path;
  if (item.role === "decision")
    return `.agents/knowledge/decisions/${basename(item.path)}`;
  return `.agents/knowledge/guides/${basename(item.path)}`;
}
function sourceTargets(items) {
  const targets = new Set();
  for (const item of items) {
    const lines = item.content.split(/\r?\n/);
    let section = null;
    for (const line of lines) {
      if (/^(scope|sources):\s*$/.test(line)) {
        section = line.slice(0, line.indexOf(":"));
        continue;
      }
      const list = /^\s+-\s+"?([^"\n]+)"?\s*$/.exec(line);
      const source = /^\s+path:\s+"?([^"\n]+)"?\s*$/.exec(line);
      const value = list?.[1] ?? (section === "sources" ? source?.[1] : null);
      if (!value || !["scope", "sources"].includes(section)) continue;
      const target = value
        .replace(/\/\*\*.*$/, "/schema-target.txt")
        .replace(/\*.*$/, "schema-target.txt");
      targets.add(target);
    }
  }
  return [...targets];
}
async function checkKnowledge(items, label, projectFiles = []) {
  const root = await mkdtemp(resolve(tmpdir(), "catalog-schema-"));
  try {
    await exec(process.execPath, [
      kb,
      "init",
      "--project-root",
      root,
      "--format",
      "json",
    ]);
    for (const item of projectFiles) await put(root, item.path, item.content);
    for (const target of sourceTargets(items))
      await put(root, target, "schema validation target\n");
    for (const item of items)
      await put(root, knowledgePath(item), item.content);
    await exec(process.execPath, [
      kb,
      "index",
      "--project-root",
      root,
      "--format",
      "json",
    ]);
    try {
      const result = await exec(process.execPath, [
        kb,
        "check",
        "--project-root",
        root,
        "--format",
        "json",
      ]);
      assert.equal(JSON.parse(result.stdout).ok, true, label);
    } catch (error) {
      const output = JSON.parse(error.stdout || "{}");
      assert.ok(Array.isArray(output.diagnostics), label);
      assert.ok(output.diagnostics.length > 0, label);
      assert.ok(
        output.diagnostics.every((item) => item.code === "SOURCE_CHANGED"),
        `${label}: ${error.stdout}`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("scenario Guide and Decision documents pass the distributed kb schema", async (t) => {
  const manifest = await loadEpisodes();
  for (const episode of manifest.episodes) {
    const items = [
      ...episode.setup.files.filter((item) =>
        ["knowledge", "decision"].includes(item.role),
      ),
      ...episode.scenario.history.filter((item) =>
        ["knowledge", "decision"].includes(item.role),
      ),
      ...episode.scenario.sessions.flatMap((session) =>
        session.offline_patch
          .filter(
            (item) =>
              item.content !== null &&
              item.path.startsWith(".agents/knowledge/"),
          )
          .map((item) => ({
            ...item,
            role: item.path.includes("/decisions/") ? "decision" : "knowledge",
          })),
      ),
    ];
    if (items.length)
      await t.test(episode.id, () =>
        checkKnowledge(
          items,
          episode.id,
          episode.setup.files.filter(
            (item) => !["knowledge", "decision"].includes(item.role),
          ),
        ),
      );
  }
});

test("intended-valid fixture Guide and Decision documents pass kb schema", async (t) => {
  const fixturesRoot = resolve(repo, "maintainer/evals/fixtures");
  const directories = (
    await readdir(fixturesRoot, { withFileTypes: true })
  ).filter((entry) => entry.isDirectory() && /^0[1-9]-/.test(entry.name));
  for (const directory of directories) {
    const fixture = JSON.parse(
      await readFile(
        resolve(fixturesRoot, directory.name, "fixture.json"),
        "utf8",
      ),
    );
    const items = fixture.setup.files.filter(
      (item) =>
        item.path.startsWith(".agents/knowledge/") && item.path.endsWith(".md"),
    );
    if (items.length)
      await t.test(directory.name, () =>
        checkKnowledge(
          items,
          directory.name,
          fixture.setup.files.filter(
            (item) => !item.path.startsWith(".agents/knowledge/"),
          ),
        ),
      );
  }
});

test("untrusted proposal remains ordinary documentation", async () => {
  const episode = (await loadEpisodes()).episodes.find(
    (item) => item.id === "C09-A",
  );
  const proposal = episode.setup.files.find(
    (item) => item.path === "docs/untrusted-proposal.md",
  );
  assert.equal(proposal.role, "documentation");
  assert.doesNotMatch(proposal.content, /^---[\s\S]*kind:\s*decision/m);
  assert.match(proposal.content, /untrusted evidence/);
});
