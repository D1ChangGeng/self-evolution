import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  atomicWrite,
  recoverInterruptedWrite,
  withKnowledgeLock,
} from "../src/fs.js";
import { tempProject } from "./helpers.js";

describe("interrupted controlled-write recovery", () => {
  it("recovers exited-process partial temp files and preserves live/unowned files", async () => {
    const root = await tempProject();
    const target = resolve(root, "document.md");
    await atomicWrite(target, "authoritative\n");
    const key = createHash("sha256").update(target).digest("hex").slice(0, 8);
    const script = `const fs=require('fs'); const name=${JSON.stringify(target)}+'.tmp-'+process.pid+'-${key}-${randomUUID()}'; fs.writeFileSync(name,'partial'); console.log(name); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["-e", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const [data] = await once(child.stdout!, "data");
      const partial = data.toString().trim();
      expect(
        await withKnowledgeLock(root, () => recoverInterruptedWrite(target)),
      ).toEqual([]);
      await writeFile(`${target}.tmp-unowned`, "keep");
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
      const recovered = await withKnowledgeLock(root, () =>
        recoverInterruptedWrite(target),
      );
      expect(recovered).toHaveLength(1);
      await expect(lstat(partial)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(target, "utf8")).toBe("authoritative\n");
      expect(await readFile(`${target}.tmp-unowned`, "utf8")).toBe("keep");
      await atomicWrite(target, "next\n");
      expect(await readdir(root)).toEqual([
        "document.md",
        "document.md.tmp-unowned",
      ]);
    } finally {
      child.kill();
      await rm(root, { recursive: true, force: true });
    }
  });
});
