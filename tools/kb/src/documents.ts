import { relative, resolve } from "node:path";
import { stringify } from "yaml";
import { listFiles, readText, toPosix } from "./fs.js";
import { markdownTitle, parseMarkdown } from "./markdown.js";
import {
  isCurrentDecision,
  isCurrentGuide,
  validateDecision,
  validateGuide,
} from "./schema.js";
import type {
  DecisionFrontmatter,
  Diagnostic,
  GuideFrontmatter,
  IndexDocument,
} from "./types.js";

export type KnowledgeDocument = {
  absolutePath: string;
  path: string;
  title?: string;
  body: string;
  data: GuideFrontmatter | DecisionFrontmatter;
  type: "guide" | "decision";
};

export async function readKnowledgeDocuments(projectRoot: string): Promise<{
  documents: KnowledgeDocument[];
  diagnostics: Diagnostic[];
}> {
  const knowledgeRoot = resolve(projectRoot, ".agents/knowledge");
  const files = [
    ...(await listFiles(resolve(knowledgeRoot, "guides"))),
    ...(await listFiles(resolve(knowledgeRoot, "decisions"))),
  ].filter((path) => path.toLowerCase().endsWith(".md"));
  files.sort((left, right) => left.localeCompare(right, "en"));
  const documents: KnowledgeDocument[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const absolutePath of files) {
    const path = toPosix(relative(knowledgeRoot, absolutePath));
    const parsed = parseMarkdown(await readText(absolutePath), path);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.length > 0) continue;
    const expected = path.startsWith("decisions/") ? "decision" : "guide";
    if (expected === "decision") {
      const validation = validateDecision(parsed.data, path);
      diagnostics.push(...validation.diagnostics);
      if (validation.value) {
        const title = markdownTitle(parsed.body);
        documents.push({
          absolutePath,
          path,
          body: parsed.body,
          data: validation.value,
          type: "decision",
          ...(title ? { title } : {}),
        });
      }
    } else {
      const validation = validateGuide(parsed.data, path);
      diagnostics.push(...validation.diagnostics);
      if (validation.value) {
        const title = markdownTitle(parsed.body);
        documents.push({
          absolutePath,
          path,
          body: parsed.body,
          data: validation.value,
          type: "guide",
          ...(title ? { title } : {}),
        });
      }
    }
  }
  return { documents, diagnostics };
}

export function buildIndexDocuments(
  documents: KnowledgeDocument[],
): IndexDocument[] {
  return documents
    .filter((document) =>
      document.type === "guide"
        ? isCurrentGuide(document.data as GuideFrontmatter)
        : isCurrentDecision(document.data as DecisionFrontmatter),
    )
    .map((document) => {
      if (document.type === "decision") {
        const data = document.data as DecisionFrontmatter;
        return {
          path: document.path,
          kind: "decision" as const,
          status: data.status,
          id: data.id,
          date: data.date,
          scope: data.scope,
        };
      }
      const data = document.data as GuideFrontmatter;
      return {
        path: document.path,
        kind: data.kind,
        status: data.status,
        scope: data.scope,
        use_when: data.use_when,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
}

export function serializeIndex(documents: IndexDocument[]): string {
  return stringify(
    { schema_version: "2.0", documents },
    { lineWidth: 0, sortMapEntries: false },
  );
}
