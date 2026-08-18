import type {
  DecisionFrontmatter,
  Diagnostic,
  GuideFrontmatter,
  SourceBaseline,
} from "./types.js";

const guideKinds = new Set(["guide", "runbook", "map", "policy"]);
const guideStatuses = new Set(["draft", "active", "superseded", "retired"]);
const decisionStatuses = new Set([
  "proposed",
  "accepted",
  "superseded",
  "rejected",
]);
const guideKeys = new Set([
  "kind",
  "status",
  "scope",
  "use_when",
  "review_when",
  "sources",
]);
const decisionKeys = new Set([
  "kind",
  "id",
  "status",
  "date",
  "scope",
  "supersedes",
  "sources",
]);

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function projectPaths(value: unknown): value is string[] {
  return (
    stringArray(value) &&
    value.every(
      (item) =>
        !item.includes("\\") &&
        !item.startsWith("/") &&
        !/^[A-Za-z]:/.test(item) &&
        !item.split("/").includes(".."),
    )
  );
}

function sources(value: unknown): value is SourceBaseline[] {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          return false;
        const source = item as Record<string, unknown>;
        return (
          Object.keys(source).every(
            (key) => key === "path" || key === "checked_at",
          ) &&
          typeof source.path === "string" &&
          projectPaths([source.path]) &&
          typeof source.checked_at === "string" &&
          /^(?:git:[0-9A-Fa-f]{7,64}|sha256:[0-9a-f]{64})$/.test(
            source.checked_at,
          )
        );
      }))
  );
}

function error(code: string, message: string, path: string): Diagnostic {
  return { code, severity: "error", message, path };
}

export function validateGuide(
  data: Record<string, unknown>,
  path: string,
): { value?: GuideFrontmatter; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(data))
    if (!guideKeys.has(key))
      diagnostics.push(
        error(
          "FRONTMATTER_FIELD_UNKNOWN",
          `Unknown Guide frontmatter field: ${key}`,
          path,
        ),
      );
  if (!guideKinds.has(String(data.kind)))
    diagnostics.push(
      error(
        "GUIDE_KIND_INVALID",
        "Guide kind must be guide, runbook, map, or policy.",
        path,
      ),
    );
  if (!guideStatuses.has(String(data.status)))
    diagnostics.push(
      error("GUIDE_STATUS_INVALID", "Guide status is invalid.", path),
    );
  if (!projectPaths(data.scope))
    diagnostics.push(
      error(
        "SCOPE_INVALID",
        "Guide scope must contain unique, project-relative POSIX paths or globs.",
        path,
      ),
    );
  if (!stringArray(data.use_when))
    diagnostics.push(
      error(
        "USE_WHEN_INVALID",
        "Guide use_when must be a non-empty string array.",
        path,
      ),
    );
  if (data.review_when !== undefined && !stringArray(data.review_when))
    diagnostics.push(
      error(
        "REVIEW_WHEN_INVALID",
        "Guide review_when must be a non-empty string array when present.",
        path,
      ),
    );
  if (!sources(data.sources))
    diagnostics.push(
      error(
        "SOURCES_INVALID",
        "Sources must contain path and checked_at strings.",
        path,
      ),
    );
  if (diagnostics.length > 0) return { diagnostics };
  return { value: data as GuideFrontmatter, diagnostics };
}

export function validateDecision(
  data: Record<string, unknown>,
  path: string,
): { value?: DecisionFrontmatter; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(data))
    if (!decisionKeys.has(key))
      diagnostics.push(
        error(
          "FRONTMATTER_FIELD_UNKNOWN",
          `Unknown Decision frontmatter field: ${key}`,
          path,
        ),
      );
  if (data.kind !== "decision")
    diagnostics.push(
      error("DECISION_KIND_INVALID", "Decision kind must be decision.", path),
    );
  if (typeof data.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(data.id))
    diagnostics.push(
      error(
        "DECISION_ID_INVALID",
        "Decision id must use lowercase letters, numbers, dot, underscore, or hyphen.",
        path,
      ),
    );
  if (!decisionStatuses.has(String(data.status)))
    diagnostics.push(
      error("DECISION_STATUS_INVALID", "Decision status is invalid.", path),
    );
  if (
    typeof data.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
    Number.isNaN(Date.parse(`${data.date}T00:00:00Z`)) ||
    new Date(`${data.date}T00:00:00Z`).toISOString().slice(0, 10) !== data.date
  )
    diagnostics.push(
      error(
        "DECISION_DATE_INVALID",
        "Decision date must be a real YYYY-MM-DD date.",
        path,
      ),
    );
  if (!projectPaths(data.scope))
    diagnostics.push(
      error(
        "SCOPE_INVALID",
        "Decision scope must contain unique, project-relative POSIX paths or globs.",
        path,
      ),
    );
  const validDecisionId = (value: unknown): value is string =>
    typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(value);
  if (!(
    data.supersedes === null ||
    validDecisionId(data.supersedes) ||
    (stringArray(data.supersedes) && data.supersedes.every(validDecisionId))
  ))
    diagnostics.push(
      error(
        "SUPERSEDES_INVALID",
        "Decision supersedes must be null, an id, or a unique non-empty id array.",
        path,
      ),
    );
  if (!sources(data.sources))
    diagnostics.push(
      error(
        "SOURCES_INVALID",
        "Sources must contain path and checked_at strings.",
        path,
      ),
    );
  if (diagnostics.length > 0) return { diagnostics };
  return { value: data as DecisionFrontmatter, diagnostics };
}

export function isCurrentGuide(data: GuideFrontmatter): boolean {
  return data.status === "active";
}

export function isCurrentDecision(data: DecisionFrontmatter): boolean {
  return data.status === "accepted";
}
