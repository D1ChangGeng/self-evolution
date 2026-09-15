import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { sha256File } from "../src/fs.js";
import { decision, put, tempProject } from "./helpers.js";

const exec = promisify(execFile);
const cli = resolve(
  import.meta.dirname,
  "../../../skills/self-evolution/references/bin/kb.mjs",
);
async function call(root: string, args: string[]) {
  try {
    const result = await exec(
      process.execPath,
      [cli, ...args, "--project-root", root, "--format", "json"],
      { windowsHide: true },
    );
    return { code: 0, ...result };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe("controlled knowledge writes across real processes", () => {
  it("retains one winner and the losing proposal when two stale writers race", async () => {
    const root = await tempProject();
    try {
      await call(root, ["init"]);
      const target = ".agents/knowledge/decisions/cache.md";
      await put(root, target, decision);
      const hash = await sha256File(resolve(root, target));
      await put(root, "one.md", decision + "\nFirst proposal.\n");
      await put(root, "two.md", decision + "\nSecond proposal.\n");
      const results = await Promise.all([
        call(root, ["write", target, "one.md", hash]),
        call(root, ["write", target, "two.md", hash]),
      ]);
      expect(results.map((r) => r.code).sort()).toEqual([0, 3]);
      expect(results.find((r) => r.code === 3)?.stderr).toContain(
        "CONCURRENT_WRITE",
      );
      const final = await readFile(resolve(root, target), "utf8");
      expect([
        await readFile(resolve(root, "one.md"), "utf8"),
        await readFile(resolve(root, "two.md"), "utf8"),
      ]).toContain(final);
      expect(
        await readdir(resolve(root, ".agents/knowledge/decisions")),
      ).toEqual(["cache.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports independent edits and worktree-local locks", async () => {
    const roots = [await tempProject(), await tempProject()];
    try {
      for (const root of roots) {
        await call(root, ["init"]);
        await put(root, "one.md", decision);
        await put(
          root,
          "two.md",
          decision.replace("adr-001-cache", "adr-002-cache"),
        );
        await put(root, "unrelated.txt", "user work\n");
      }
      const results = await Promise.all(
        roots.flatMap((root) => [
          call(root, [
            "write",
            ".agents/knowledge/decisions/a.md",
            "one.md",
            "absent",
          ]),
          call(root, [
            "write",
            ".agents/knowledge/decisions/b.md",
            "two.md",
            "absent",
          ]),
        ]),
      );
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0]);
      for (const root of roots) {
        expect((await call(root, ["index"])).code).toBe(0);
        expect((await call(root, ["index"])).stdout).toContain(
          '"changed": false',
        );
        expect(await readFile(resolve(root, "unrelated.txt"), "utf8")).toBe(
          "user work\n",
        );
      }
    } finally {
      for (const root of roots)
        await rm(root, { recursive: true, force: true });
    }
  });

  it("times out while another process owns the lock and recovers after forced exit", async () => {
    const root = await tempProject();
    // Node 22 strip-types cannot resolve the project's .js TS imports; import
    // the bundled test helper built from the same source instead.
    const { build } = await import("esbuild");
    const helper = resolve(root, "lock.mjs");
    await build({
      stdin: {
        contents: `import {withKnowledgeLock} from ${JSON.stringify(resolve(import.meta.dirname, "../src/fs.ts"))}; await withKnowledgeLock(process.argv[2], async()=>{console.log('locked'); await new Promise(()=>{});});`,
        resolveDir: root,
      },
      outfile: helper,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
    });
    const child = spawn(process.execPath, [helper, root], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await once(child.stdout!, "data");
      const { withKnowledgeLock } = await import("../src/fs.js");
      await expect(
        withKnowledgeLock(root, async () => true, 80),
      ).rejects.toMatchObject({ code: "WRITE_LOCK_TIMEOUT" });
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
      expect(await withKnowledgeLock(root, async () => "recovered")).toBe(
        "recovered",
      );
    } finally {
      child.kill();
      await rm(root, { recursive: true, force: true });
    }
  }, 10000);

  it("rejects target traversal, malformed proposals, and stale create", async () => {
    const root = await tempProject();
    try {
      await call(root, ["init"]);
      await put(
        root,
        "bad.md",
        "---\nkind: decision\nstatus: accepted\n---\n# Invalid\n",
      );
      expect(
        (
          await call(root, [
            "write",
            ".agents/knowledge/decisions/a.md",
            "bad.md",
            "absent",
          ])
        ).code,
      ).toBe(2);
      await put(root, "good.md", decision);
      expect(
        (
          await call(root, [
            "write",
            ".agents/knowledge/decisions/../../../../escape.md",
            "good.md",
            "absent",
          ])
        ).code,
      ).toBe(2);
      expect(
        (
          await call(root, [
            "write",
            ".agents/knowledge/decisions/a.md",
            "good.md",
            "absent",
          ])
        ).code,
      ).toBe(0);
      expect(
        (
          await call(root, [
            "write",
            ".agents/knowledge/decisions/a.md",
            "good.md",
            "absent",
          ])
        ).code,
      ).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
