import { describe, expect, it } from "vitest";
import { checkCommand } from "../src/check.js";
import { indexCommand } from "../src/index-command.js";
import { initCommand } from "../src/init.js";
import { decision, guide, put, tempProject } from "./helpers.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function project() {
  const root = await tempProject();
  await initCommand(root);
  await put(root, "src/payments/index.ts", "export {};\n");
  await put(root, "src/cache/index.ts", "export {};\n");
  return root;
}
const codes = async (root: string) => {
  await indexCommand(root);
  return (await checkCommand(root)).diagnostics?.map((d) => d.code) ?? [];
};

describe("knowledge lifecycle", () => {
  it("allows shared scope for distinct current consumers and ignores retired routes", async () => {
    const root = await project();
    await put(root, ".agents/knowledge/guides/a.md", guide());
    await put(
      root,
      ".agents/knowledge/guides/b.md",
      guide()
        .replace("kind: guide", "kind: runbook")
        .replace("changing payments", "investigating payment outages"),
    );
    await put(
      root,
      ".agents/knowledge/guides/c.md",
      guide().replace("status: active", "status: retired"),
    );
    expect(await codes(root)).toEqual([]);
  });
  it("resolves archived Decision ids while excluding archived bodies from routes", async () => {
    const root = await project();
    await put(
      root,
      ".agents/knowledge/archive/old.md",
      decision.replace("status: accepted", "status: superseded"),
    );
    await put(
      root,
      ".agents/knowledge/archive/notes.md",
      "# Historical notes\nOld unstructured evidence.\n",
    );
    await put(
      root,
      ".agents/knowledge/decisions/new.md",
      decision
        .replace("id: adr-001-cache", "id: adr-002-cache")
        .replace("supersedes: null", "supersedes: adr-001-cache"),
    );
    expect(await codes(root)).toEqual([]);
    const index = await readFile(
      resolve(root, ".agents/knowledge/index.yaml"),
      "utf8",
    );
    expect(index).not.toContain("archive/");
    expect((await indexCommand(root)).changed).toBe(false);
  });
  it.each([
    ["self", "SUPERSEDES_SELF"],
    ["cycle", "SUPERSEDES_CYCLE"],
    ["missing", "SUPERSEDES_MISSING"],
    ["active", "SUPERSEDES_AUTHORITY_CONFLICT"],
    ["duplicate", "DUPLICATE_DECISION_ID"],
  ])("detects %s relations", async (variant, expected) => {
    const root = await project();
    let a = decision;
    let b = decision.replace("id: adr-001-cache", "id: adr-002-cache");
    if (variant === "self")
      a = a.replace("supersedes: null", "supersedes: adr-001-cache");
    if (variant === "cycle") {
      a = a
        .replace("supersedes: null", "supersedes: adr-002-cache")
        .replace("status: accepted", "status: superseded");
      b = b
        .replace("supersedes: null", "supersedes: adr-001-cache")
        .replace("status: accepted", "status: superseded");
    }
    if (variant === "missing")
      a = a.replace("supersedes: null", "supersedes: adr-missing");
    if (variant === "active")
      b = b.replace("supersedes: null", "supersedes: adr-001-cache");
    if (variant === "duplicate") b = decision;
    await put(root, ".agents/knowledge/decisions/a.md", a);
    await put(root, ".agents/knowledge/decisions/b.md", b);
    expect(await codes(root)).toContain(expected);
  });

  it("rejects two current replacements and an accepted Decision hidden in archive", async () => {
    const root = await project();
    await put(
      root,
      ".agents/knowledge/archive/old.md",
      decision.replace("status: accepted", "status: superseded"),
    );
    for (const id of ["adr-two", "adr-three"])
      await put(
        root,
        `.agents/knowledge/decisions/${id}.md`,
        decision
          .replace("id: adr-001-cache", `id: ${id}`)
          .replace("supersedes: null", "supersedes: adr-001-cache"),
      );
    expect(await codes(root)).toContain("SUPERSEDES_AUTHORITY_CONFLICT");
    await put(
      root,
      ".agents/knowledge/archive/current.md",
      decision.replace("id: adr-001-cache", "id: adr-hidden"),
    );
    expect(await codes(root)).toContain("ARCHIVED_DECISION_CURRENT");
  });

  it("keeps draft, retired, superseded and rejected records out of active review", async () => {
    const root = await project();
    for (const status of ["draft", "retired", "superseded"])
      await put(
        root,
        `.agents/knowledge/guides/${status}.md`,
        guide()
          .replace("status: active", `status: ${status}`)
          .replace("src/payments/**", "gone/**"),
      );
    await put(
      root,
      ".agents/knowledge/decisions/rejected.md",
      decision
        .replace("status: accepted", "status: rejected")
        .replace("src/cache/**", "gone/**"),
    );
    expect(await codes(root)).toEqual([]);
    await put(
      root,
      ".agents/knowledge/archive/invalid.md",
      decision.replace("status: accepted", "status: invalid"),
    );
    expect(await codes(root)).toContain("DECISION_STATUS_INVALID");
  });
});
