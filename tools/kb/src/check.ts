import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import picomatch from "picomatch";
import { adapterStatus } from "./adapter.js";
import {
  buildIndexDocuments,
  readKnowledgeDocuments,
  serializeIndex,
} from "./documents.js";
import { pathExists, readText, safeResolve } from "./fs.js";
import { markdownLinks } from "./markdown.js";
import { checkSources } from "./source-check.js";
import type {
  CommandResult,
  DecisionFrontmatter,
  Diagnostic,
  GuideFrontmatter,
} from "./types.js";
import { readSettings } from "./init.js";

function localLink(link: string): string | undefined {
  if (/^(?:[a-z]+:|#)/i.test(link)) return undefined;
  return decodeURIComponent(link.split("#", 1)[0] ?? "");
}

const inputDiagnosticCodes = new Set([
  "FRONTMATTER_MISSING",
  "FRONTMATTER_UNTERMINATED",
  "FRONTMATTER_INVALID",
  "FRONTMATTER_FIELD_UNKNOWN",
  "SETTINGS_INVALID",
  "GUIDE_KIND_INVALID",
  "GUIDE_STATUS_INVALID",
  "DECISION_KIND_INVALID",
  "DECISION_ID_INVALID",
  "DECISION_STATUS_INVALID",
  "DECISION_DATE_INVALID",
  "SOURCES_INVALID",
  "USE_WHEN_INVALID",
  "REVIEW_WHEN_INVALID",
  "SUPERSEDES_INVALID",
  "SCOPE_INVALID",
]);

async function projectFiles(projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string, segments: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const next = [...segments, entry.name];
      const relativePath = next.join("/");
      if (entry.isDirectory()) {
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          [
            ".agents/knowledge",
            ".agents/generated",
            ".agents/.migrations",
            ".agents/legacy",
          ].includes(relativePath)
        )
          continue;
        await walk(resolve(directory, entry.name), next);
      } else if (entry.isFile()) {
        if (relativePath !== ".git" && relativePath !== "node_modules")
          files.push(relativePath);
      }
    }
  }
  await walk(projectRoot, []);
  return files;
}

function inputDiagnostic(diagnostic: Diagnostic): boolean {
  return inputDiagnosticCodes.has(diagnostic.code);
}

export async function checkCommand(
  projectRoot: string,
): Promise<CommandResult> {
  const scanned = await readKnowledgeDocuments(projectRoot);
  const diagnostics: Diagnostic[] = [...scanned.diagnostics];
  if (!(await pathExists(resolve(projectRoot, ".agents/settings.yaml"))))
    diagnostics.push({
      code: "SETTINGS_MISSING",
      severity: "error",
      message: ".agents/settings.yaml is missing.",
      path: ".agents/settings.yaml",
    });
  else
    try {
      await readSettings(projectRoot);
    } catch (error) {
      diagnostics.push({
        code: "SETTINGS_INVALID",
        severity: "error",
        message: (error as Error).message,
        path: ".agents/settings.yaml",
      });
    }
  if (!(await pathExists(resolve(projectRoot, "AGENTS.md"))))
    diagnostics.push({
      code: "AGENTS_MISSING",
      severity: "error",
      message: "AGENTS.md is missing.",
      path: "AGENTS.md",
    });
  const ids = new Map<string, string>();
  const exactScopes = new Map<string, string>();
  const files = await projectFiles(projectRoot);

  for (const document of scanned.documents) {
    if (!document.title)
      diagnostics.push({
        code: "TITLE_MISSING",
        severity: "error",
        message: "Document needs one H1 title.",
        path: document.path,
      });
    for (const link of markdownLinks(document.body)) {
      const target = localLink(link);
      if (!target) continue;
      let absolute: string;
      try {
        const resolvedTarget =
          document.type === "guide" || document.type === "decision"
            ? resolve(dirname(document.absolutePath), target)
            : resolve(projectRoot, target);
        absolute = safeResolve(projectRoot, resolvedTarget);
      } catch {
        diagnostics.push({
          code: "LINK_PATH_ESCAPE",
          severity: "error",
          message: `Link escapes project root: ${link}`,
          path: document.path,
        });
        continue;
      }
      if (!(await pathExists(absolute)))
        diagnostics.push({
          code: "BROKEN_LINK",
          severity: "error",
          message: `Linked path does not exist: ${link}`,
          path: document.path,
        });
    }
    diagnostics.push(
      ...(await checkSources(
        projectRoot,
        document.data.sources,
        document.path,
      )),
    );
    for (const scope of document.data.scope) {
      let matches: (path: string) => boolean;
      try {
        matches = picomatch(scope, { dot: true, strictBrackets: true });
      } catch {
        diagnostics.push({
          code: "SCOPE_INVALID",
          severity: "error",
          message: `Invalid scope glob: ${scope}`,
          path: document.path,
        });
        continue;
      }
      if (!files.some((path) => matches(path)))
        diagnostics.push({
          code: "SCOPE_MISSING",
          severity: "warning",
          message: `Scope does not match any project file: ${scope}`,
          path: document.path,
        });
      if (document.type === "guide") {
        const previous = exactScopes.get(scope);
        if (previous)
          diagnostics.push({
            code: "DUPLICATE_ROUTING",
            severity: "error",
            message: `Exact scope is also routed by ${previous}: ${scope}`,
            path: document.path,
          });
        else exactScopes.set(scope, document.path);
      }
    }
    if (document.type === "decision") {
      const decision = document.data as DecisionFrontmatter;
      const previous = ids.get(decision.id);
      if (previous)
        diagnostics.push({
          code: "DUPLICATE_DECISION_ID",
          severity: "error",
          message: `Decision id duplicates ${previous}: ${decision.id}`,
          path: document.path,
        });
      else ids.set(decision.id, document.path);
    }
  }

  for (const document of scanned.documents.filter(
    (item) => item.type === "decision",
  )) {
    const decision = document.data as DecisionFrontmatter;
    const references =
      decision.supersedes === null
        ? []
        : Array.isArray(decision.supersedes)
          ? decision.supersedes
          : [decision.supersedes];
    for (const id of references)
      if (!ids.has(id))
        diagnostics.push({
          code: "SUPERSEDES_MISSING",
          severity: "error",
          message: `Superseded decision does not exist: ${id}`,
          path: document.path,
        });
  }

  const guides = scanned.documents.filter((item) => item.type === "guide");
  for (let left = 0; left < guides.length; left += 1) {
    for (let right = left + 1; right < guides.length; right += 1) {
      const a = guides[left]!;
      const b = guides[right]!;
      const aScopes = (a.data as GuideFrontmatter).scope;
      const bScopes = (b.data as GuideFrontmatter).scope;
      const overlap = aScopes.some((scope) =>
        bScopes.some((other) => {
          const aPrefix = scope.replace(/[*?].*$/, "");
          const bPrefix = other.replace(/[*?].*$/, "");
          return (
            scope !== other &&
            aPrefix !== "" &&
            bPrefix !== "" &&
            (aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix))
          );
        }),
      );
      if (overlap)
        diagnostics.push({
          code: "SCOPE_OVERLAP_RISK",
          severity: "warning",
          message: `Scopes may overlap with ${b.path}. Review semantic routing boundaries.`,
          path: a.path,
        });
    }
  }

  const expected = serializeIndex(buildIndexDocuments(scanned.documents));
  const indexPath = resolve(projectRoot, ".agents/knowledge/index.yaml");
  if (
    !(await pathExists(indexPath)) ||
    (await readText(indexPath)).replaceAll("\r\n", "\n") !== expected
  ) {
    diagnostics.push({
      code: "INDEX_DRIFT",
      severity: "error",
      message: "index.yaml does not match current knowledge files.",
      path: ".agents/knowledge/index.yaml",
    });
  }
  const agentsPath = resolve(projectRoot, "AGENTS.md");
  if (await pathExists(agentsPath)) {
    for (const link of markdownLinks(await readText(agentsPath))) {
      const target = localLink(link);
      if (!target) continue;
      try {
        const absolute = safeResolve(projectRoot, resolve(projectRoot, target));
        if (!(await pathExists(absolute)))
          diagnostics.push({
            code: "BROKEN_LINK",
            severity: "error",
            message: `AGENTS.md linked path does not exist: ${link}`,
            path: "AGENTS.md",
          });
      } catch {
        diagnostics.push({
          code: "LINK_PATH_ESCAPE",
          severity: "error",
          message: `AGENTS.md link escapes project root: ${link}`,
          path: "AGENTS.md",
        });
      }
    }
  }
  try {
    const status = await adapterStatus(projectRoot);
    diagnostics.push(...status.diagnostics);
  } catch (error) {
    diagnostics.push({
      code: "SETTINGS_INVALID",
      severity: "error",
      message: (error as Error).message,
      path: ".agents/settings.yaml",
    });
  }
  const hasFindings = diagnostics.some(
    (item) => item.severity === "warning" || item.severity === "error",
  );
  const exitCode = diagnostics.some(inputDiagnostic)
    ? 2
    : hasFindings
      ? 1
      : undefined;
  return {
    command: "check",
    ok: !hasFindings,
    ...(exitCode ? { exitCode } : {}),
    diagnostics,
    data: { documents: scanned.documents.length },
  };
}
