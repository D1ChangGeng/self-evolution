import { parse, stringify } from "yaml";
import type { Diagnostic } from "./types.js";

export type ParsedMarkdown = {
  data: Record<string, unknown>;
  body: string;
  diagnostics: Diagnostic[];
};

export function parseMarkdown(content: string, path?: string): ParsedMarkdown {
  const normalized = content.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      data: {},
      body: normalized,
      diagnostics: [
        {
          code: "FRONTMATTER_MISSING",
          severity: "error",
          message: "Markdown frontmatter is missing.",
          ...(path ? { path } : {}),
        },
      ],
    };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return {
      data: {},
      body: normalized,
      diagnostics: [
        {
          code: "FRONTMATTER_UNTERMINATED",
          severity: "error",
          message: "Markdown frontmatter is unterminated.",
          ...(path ? { path } : {}),
        },
      ],
    };
  }
  try {
    const value = parse(normalized.slice(4, end));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("frontmatter must be a map");
    return {
      data: value as Record<string, unknown>,
      body: normalized.slice(end + 5),
      diagnostics: [],
    };
  } catch (error) {
    return {
      data: {},
      body: normalized.slice(end + 5),
      diagnostics: [
        {
          code: "FRONTMATTER_INVALID",
          severity: "error",
          message: `Invalid YAML frontmatter: ${(error as Error).message}`,
          ...(path ? { path } : {}),
        },
      ],
    };
  }
}

export function markdownTitle(body: string): string | undefined {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match?.[1]?.trim();
}

export function serializeMarkdown(
  data: Record<string, unknown>,
  body: string,
): string {
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n${body.startsWith("\n") ? "" : "\n"}${body.trimEnd()}\n`;
}

export function markdownLinks(body: string): string[] {
  const links: string[] = [];
  const pattern = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of body.matchAll(pattern)) {
    const target = match[1]?.trim();
    if (target) links.push(target.replace(/^<|>$/g, ""));
  }
  return links;
}
