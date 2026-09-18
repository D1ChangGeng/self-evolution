import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWrite, guardedAtomicWrite } from "../src/fs.js";
import { tempProject } from "./helpers.js";

describe("atomic filesystem writes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supports concurrent writes to the same path without temporary-file EEXIST failures", async () => {
    const root = await tempProject();
    const target = resolve(root, "directory with spaces/settings.yaml");

    await expect(
      Promise.all([
        atomicWrite(target, "first\r\n"),
        atomicWrite(target, "second\r\n"),
      ]),
    ).resolves.toEqual([true, true]);

    expect(["first\r\n", "second\r\n"]).toContain(
      await readFile(target, "utf8"),
    );
    expect(
      (await readdir(resolve(root, "directory with spaces"))).filter((name) =>
        name.includes(".tmp-"),
      ),
    ).toEqual([]);
  });

  it("rejects stale guarded writes and leaves the winner intact", async () => {
    const root = await tempProject();
    const target = resolve(root, "knowledge.md");
    await atomicWrite(target, "base\n");
    const digest = (await readFile(target)).toString();
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(digest).digest("hex");
    await atomicWrite(target, "winner\n");
    await expect(
      guardedAtomicWrite(target, "loser\n", expected),
    ).rejects.toMatchObject({ code: "CONCURRENT_WRITE" });
    expect(await readFile(target, "utf8")).toBe("winner\n");
  });
});
