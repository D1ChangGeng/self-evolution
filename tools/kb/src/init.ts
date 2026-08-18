import { resolve } from "node:path";
import { parse } from "yaml";
import { loadAsset } from "./assets.js";
import { atomicWrite, pathExists, readText } from "./fs.js";
import type { CommandResult } from "./types.js";
import { KbError } from "./types.js";

const v1Markers = [
  "manifest.json",
  "domains",
  "reference",
  "patterns",
  "crystallized",
  "inbox",
];

export async function hasV1(projectRoot: string): Promise<boolean> {
  const knowledge = resolve(projectRoot, ".agents/knowledge");
  for (const marker of v1Markers) {
    if (await pathExists(resolve(knowledge, marker))) return true;
  }
  return pathExists(resolve(knowledge, "SKILL-LOCAL.md"));
}

export async function initCommand(projectRoot: string): Promise<CommandResult> {
  if (await hasV1(projectRoot)) {
    throw new KbError(
      "A v1 knowledge base was detected. Run `kb migrate prepare` before initializing v2.",
      3,
      "V1_DETECTED",
    );
  }

  const targets = [
    [resolve(projectRoot, "AGENTS.md"), "templates/agents.md"],
    [resolve(projectRoot, ".agents/settings.yaml"), "templates/settings.yaml"],
    [
      resolve(projectRoot, ".agents/knowledge/index.yaml"),
      "templates/index.yaml",
    ],
  ] as const;
  const created: string[] = [];
  for (const [path, asset] of targets) {
    if (await pathExists(path)) continue;
    const content = await loadAsset(asset);
    if (path.endsWith(".yaml")) parse(content);
    await atomicWrite(path, content.replaceAll("\r\n", "\n"));
    created.push(path);
  }
  return {
    command: "init",
    ok: true,
    changed: created.length > 0,
    data: { created },
  };
}

export async function readSettings(
  projectRoot: string,
): Promise<Record<string, any>> {
  const path = resolve(projectRoot, ".agents/settings.yaml");
  if (!(await pathExists(path)))
    return parse(await loadAsset("templates/settings.yaml"));
  const value = parse(await readText(path));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KbError(
      ".agents/settings.yaml must contain a YAML map.",
      2,
      "SETTINGS_INVALID",
    );
  }
  const topKeys = new Set(["schema_version", "routing", "adapters"]);
  const routingValid =
    value.routing &&
    typeof value.routing === "object" &&
    !Array.isArray(value.routing) &&
    Object.keys(value.routing).every((key) => key === "generate_scope_rules") &&
    typeof value.routing.generate_scope_rules === "boolean";
  const adapterNames = new Set([
    "claude-code",
    "cursor",
    "opencode",
    "augment-code",
  ]);
  const active = value.adapters?.active;
  const adaptersValid =
    value.adapters &&
    typeof value.adapters === "object" &&
    !Array.isArray(value.adapters) &&
    Object.keys(value.adapters).every((key) => key === "active") &&
    active &&
    typeof active === "object" &&
    !Array.isArray(active) &&
    Object.entries(active).every(([tool, features]) => {
      if (
        !adapterNames.has(tool) ||
        !features ||
        typeof features !== "object" ||
        Array.isArray(features)
      )
        return false;
      const featureMap = features as Record<string, unknown>;
      return (
        Object.keys(featureMap).every(
          (key) => key === "context_recovery" || key === "post_task_reminder",
        ) &&
        typeof featureMap.context_recovery === "boolean" &&
        typeof featureMap.post_task_reminder === "boolean"
      );
    });
  if (
    Object.keys(value).some((key) => !topKeys.has(key)) ||
    value.schema_version !== "2.0" ||
    !routingValid ||
    !adaptersValid
  ) {
    throw new KbError(
      ".agents/settings.yaml does not match the v2 settings schema.",
      2,
      "SETTINGS_INVALID",
    );
  }
  return value;
}
