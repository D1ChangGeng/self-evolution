import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWrite } from "../src/fs.js";
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
});
