import { resolve } from "node:path";
import {
  assertNoSymlinks,
  atomicWrite,
  recoverInterruptedWrite,
  withKnowledgeLock,
} from "./fs.js";
import {
  buildIndexDocuments,
  readKnowledgeDocuments,
  serializeIndex,
} from "./documents.js";
import { readSettings } from "./init.js";
import { syncScopeRules } from "./rules.js";
import type { CommandResult } from "./types.js";

export async function indexCommand(
  projectRoot: string,
): Promise<CommandResult> {
  // Preserve the existing single-writer index path on other Node platforms;
  // explicit guarded writes disclose their narrower process-lock support.
  if (!["win32", "linux"].includes(process.platform))
    return buildLockedIndex(projectRoot);
  return withKnowledgeLock(projectRoot, () => buildLockedIndex(projectRoot));
}

async function buildLockedIndex(projectRoot: string): Promise<CommandResult> {
  await assertNoSymlinks(
    projectRoot,
    resolve(projectRoot, ".agents/knowledge/index.yaml"),
  );
  const scanned = await readKnowledgeDocuments(projectRoot);
  if (scanned.diagnostics.some((item) => item.severity === "error")) {
    return { command: "index", ok: false, diagnostics: scanned.diagnostics };
  }
  const documents = buildIndexDocuments(scanned.documents);
  if (["win32", "linux"].includes(process.platform))
    await recoverInterruptedWrite(
      resolve(projectRoot, ".agents/knowledge/index.yaml"),
    );
  const changed = await atomicWrite(
    resolve(projectRoot, ".agents/knowledge/index.yaml"),
    serializeIndex(documents),
  );
  const settings = await readSettings(projectRoot);
  await syncScopeRules(
    projectRoot,
    scanned.documents,
    settings.routing?.generate_scope_rules === true,
  );
  return {
    command: "index",
    ok: true,
    changed,
    diagnostics: scanned.diagnostics,
    data: { documents: documents.length },
  };
}
