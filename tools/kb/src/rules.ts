import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { stringify } from "yaml";
import type { KnowledgeDocument } from "./documents.js";
import { atomicWrite, pathExists } from "./fs.js";
import type { GuideFrontmatter } from "./types.js";

export async function syncScopeRules(
  projectRoot: string,
  documents: KnowledgeDocument[],
  enabled: boolean,
): Promise<void> {
  const rulesRoot = resolve(projectRoot, ".agents/generated/rules");
  if (!enabled) {
    await rm(rulesRoot, { recursive: true, force: true });
    return;
  }
  const expected = new Set<string>();
  for (const document of documents.filter(
    (item) =>
      item.type === "guide" &&
      (item.data as GuideFrontmatter).status === "active",
  )) {
    const data = document.data as GuideFrontmatter;
    const name = `${document.path
      .replace(/^guides\//, "")
      .replace(/\.md$/i, "")
      .replaceAll("/", "--")}.md`;
    expected.add(name);
    const frontmatter = stringify(
      {
        description: `Read ${document.title ?? document.path} before work in this scope`,
        globs: data.scope,
      },
      { lineWidth: 0 },
    ).trimEnd();
    await atomicWrite(
      resolve(rulesRoot, name),
      `---\n${frontmatter}\n---\nRead \`.agents/knowledge/${document.path}\` before changing files in this scope. Verify material claims against current reality.\n`,
    );
  }
  if (!(await pathExists(rulesRoot))) return;
  for (const name of await readdir(rulesRoot)) {
    if (!expected.has(name))
      await rm(resolve(rulesRoot, name), { force: true, recursive: true });
  }
}
