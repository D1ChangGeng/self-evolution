import { resolve } from "node:path";
import { atomicWrite } from "./fs.js";
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
  const scanned = await readKnowledgeDocuments(projectRoot);
  if (scanned.diagnostics.some((item) => item.severity === "error")) {
    return { command: "index", ok: false, diagnostics: scanned.diagnostics };
  }
  const documents = buildIndexDocuments(scanned.documents);
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
