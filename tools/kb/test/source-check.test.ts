import { execFile } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { checkSources } from "../src/source-check.js";
import { sha256File } from "../src/fs.js";
import { put, tempProject } from "./helpers.js";

const exec = promisify(execFile);
async function git(root: string, ...args: string[]) {
  return (
    await exec("git", args, { cwd: root, windowsHide: true })
  ).stdout.trim();
}
async function repository() {
  const root = await tempProject();
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "Test");
  await put(root, "src/a.txt", "one\n");
  await put(root, "src/b.txt", "two\n");
  await put(root, "unrelated.txt", "other\n");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "base");
  return { root, baseline: await git(root, "rev-parse", "HEAD") };
}

describe("local source review details", () => {
  it.each([
    "committed",
    "unstaged",
    "staged",
    "untracked",
    "deleted",
    "renamed",
    "unrelated",
  ])(
    "handles %s changes",
    async (kind) => {
      const { root, baseline } = await repository();
      try {
        let paths = ["src/a.txt"];
        if (kind === "renamed") {
          await rename(
            resolve(root, "src/a.txt"),
            resolve(root, "src/new.txt"),
          );
          await git(root, "add", "-A");
          paths.push("src/new.txt");
        } else if (kind === "deleted") await rm(resolve(root, "src/a.txt"));
        else if (kind === "untracked") {
          await put(root, "src/new.txt", "new\n");
          paths = ["src/new.txt"];
        } else if (kind === "unrelated")
          await put(root, "unrelated.txt", "changed\n");
        else {
          await put(root, "src/a.txt", "changed\n");
          if (["staged", "committed"].includes(kind))
            await git(root, "add", ".");
          if (kind === "committed") await git(root, "commit", "-qm", "changed");
        }
        const sources = [{ path: "src/**", checked_at: `git:${baseline}` }];
        const result = await checkSources(root, sources, "guides/test.md", [
          "../../../test/source.test.mjs",
        ]);
        if (kind === "unrelated") expect(result).toEqual([]);
        else {
          expect(result).toHaveLength(1);
          expect(result[0]?.code).toBe("SOURCE_CHANGED");
          expect(result[0]?.details?.changed_paths).toEqual(paths.sort());
          expect(result[0]?.details?.baseline).toBe(`git:${baseline}`);
          expect(result[0]?.details?.verification_refs).toEqual([
            "../../../test/source.test.mjs",
          ]);
          expect(result[0]?.details?.limitation).toContain(
            "does not override adopted policy",
          );
        }
        expect(sources[0]?.checked_at).toBe(`git:${baseline}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    15000,
  );

  it("bounds output with a unique deterministic omitted count", async () => {
    const { root, baseline } = await repository();
    try {
      for (let i = 0; i < 40; i++)
        await put(root, `src/${String(i).padStart(2, "0")}.txt`, "new\n");
      const [result] = await checkSources(
        root,
        [{ path: "src/**", checked_at: `git:${baseline}` }],
        "guides/test.md",
      );
      expect(result?.details?.changed_paths).toHaveLength(32);
      expect(result?.details?.omitted_count).toBe(8);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("handles a non-Git regular file, missing source and unavailable baseline independently", async () => {
    const root = await tempProject();
    try {
      await put(root, "config.json", "{}\n");
      const baseline = `sha256:${await sha256File(resolve(root, "config.json"))}`;
      expect(
        await checkSources(
          root,
          [{ path: "config.json", checked_at: baseline }],
          "guide.md",
        ),
      ).toEqual([]);
      await put(root, "config.json", '{"changed":true}\n');
      expect(
        (
          await checkSources(
            root,
            [{ path: "config.json", checked_at: baseline }],
            "guide.md",
          )
        )[0]?.code,
      ).toBe("SOURCE_CHANGED");
      const missing = await checkSources(
        root,
        [{ path: "missing", checked_at: "git:abcdef012345" }],
        "guide.md",
      );
      expect(missing.map((d) => d.code)).toEqual([
        "SOURCE_MISSING",
        "SOURCE_BASELINE_UNAVAILABLE",
      ]);
      expect(
        (
          await checkSources(
            root,
            [{ path: "*.json", checked_at: baseline }],
            "guide.md",
          )
        )[0]?.code,
      ).toBe("SOURCE_BASELINE_UNAVAILABLE");
      await mkdir(resolve(root, "directory"));
      expect(
        (
          await checkSources(
            root,
            [{ path: "directory", checked_at: baseline }],
            "guide.md",
          )
        )[0]?.details?.reason,
      ).toBe("unsupported-file-type");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports missing ancestor baselines in a real shallow clone", async () => {
    const { root, baseline } = await repository();
    const clone = await tempProject();
    try {
      await put(root, "src/a.txt", "new\n");
      await git(root, "add", ".");
      await git(root, "commit", "-qm", "next");
      await git(clone, "clone", "--depth", "1", pathToFileURL(root).href, ".");
      expect(await git(clone, "rev-parse", "--is-shallow-repository")).toBe(
        "true",
      );
      const result = await checkSources(
        clone,
        [{ path: "src/**", checked_at: `git:${baseline}` }],
        "guide.md",
      );
      expect(result.map((d) => d.code)).toEqual([
        "SOURCE_BASELINE_UNAVAILABLE",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(clone, { recursive: true, force: true });
    }
  }, 15000);
});
