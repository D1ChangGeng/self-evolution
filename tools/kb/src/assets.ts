import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";
import { pathExists, readText } from "./fs.js";

const fallbackAssets: Record<string, string> = {
  "templates/agents.md": `# Project Context

## Project Purpose

No project purpose has been recorded yet. During onboarding, replace this sentence only when current project evidence supports a concise purpose.

## Essential Commands

No essential commands have been recorded yet. Add commands only after verifying them from manifests, CI, scripts, or direct execution.

## Critical Rules

No critical project rules have been recorded yet. Add only adopted, high-impact rules that must be known in most sessions.

## Where to Look

| Task / Scope | Read |
|---|---|
| Project knowledge | .agents/knowledge/index.yaml |

## Knowledge Rule

Use project knowledge as guidance, then verify material claims against current code, tests, configuration, or runtime evidence. Correct knowledge when reality disagrees.
`,
  "templates/settings.yaml": `schema_version: "2.0"
routing:
  generate_scope_rules: false
adapters:
  active: {}
`,
  "templates/index.yaml": `schema_version: "2.0"
documents: []
`,
};

export function referencesRoot(): string {
  const current = dirname(fileURLToPath(import.meta.url));
  const bundledRoot = resolve(current, "..");
  const sourceRoot = resolve(
    current,
    "../../../skills/self-evolution/references",
  );
  return basename(current) === "src" &&
    basename(dirname(current)) === "kb" &&
    basename(dirname(dirname(current))) === "tools"
    ? sourceRoot
    : bundledRoot;
}

export async function loadAsset(relativePath: string): Promise<string> {
  const path = resolve(referencesRoot(), relativePath);
  if (await pathExists(path)) return readText(path);
  const fallback = fallbackAssets[relativePath];
  if (fallback === undefined)
    throw new Error(`Required skill asset is missing: ${relativePath}`);
  return fallback;
}

export function assetPath(relativePath: string): string {
  return resolve(referencesRoot(), relativePath);
}
