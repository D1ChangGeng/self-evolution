import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import { assetPath } from "./assets.js";
import {
  atomicWrite,
  pathExists,
  readText,
  safeResolve,
  toPosix,
} from "./fs.js";
import { readSettings } from "./init.js";
import type { CommandResult, Diagnostic } from "./types.js";
import { KbError } from "./types.js";

export const tools = [
  "claude-code",
  "cursor",
  "opencode",
  "augment-code",
] as const;
export type AdapterTool = (typeof tools)[number];
export type AdapterFeature = "context-recovery" | "post-task-reminder";

const owner = "self-evolution-v2";
const pluginSuffix = "/.agents/generated/adapters/opencode/opencode-plugin.mjs";
const configPaths: Record<AdapterTool, string> = {
  "claude-code": ".claude/settings.json",
  cursor: ".cursor/hooks.json",
  opencode: ".opencode/opencode.json",
  "augment-code": ".augment/settings.json",
};

function parseJsonc(content: string): any {
  let stripped = content.replace(/^\uFEFF/, "");
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < stripped.length; index += 1) {
    const current = stripped[index]!;
    const next = stripped[index + 1];
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      while (index + 1 < stripped.length && stripped[index + 1] !== "\n")
        index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (
        index < stripped.length &&
        !(stripped[index] === "*" && stripped[index + 1] === "/")
      )
        index += 1;
      index += 1;
      continue;
    }
    output += current;
  }
  stripped = output.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(stripped);
}

async function readJsonConfig(path: string): Promise<any> {
  if (!(await pathExists(path))) return {};
  try {
    const value = parseJsonc(await readText(path));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("config must be an object");
    return value;
  } catch (error) {
    throw new KbError(
      `Cannot safely parse ${path}: ${(error as Error).message}`,
      3,
      "ADAPTER_CONFIG_INVALID",
    );
  }
}

function commandHook(command: string, event: string): any {
  return {
    matcher: event === "SessionStart" ? "compact" : "",
    hooks: [
      { type: "command", command, timeout: 5000, _self_evolution_owner: owner },
    ],
  };
}

function ownedHook(item: any): boolean {
  return (
    item?.hooks?.some?.(
      (hook: any) => hook?._self_evolution_owner === owner,
    ) === true
  );
}

function expectedHook(
  tool: AdapterTool,
  feature: AdapterFeature,
): { event: string; command: string } {
  return feature === "context-recovery"
    ? {
        event: "SessionStart",
        command: `node .agents/generated/adapters/${tool}/context-recovery.mjs`,
      }
    : {
        event: "Stop",
        command: `node .agents/generated/adapters/${tool}/post-task-reminder.mjs`,
      };
}

function ownedHookRegistrations(
  config: any,
): Array<{ event: string; command: unknown; type: unknown }> {
  const registrations: Array<{
    event: string;
    command: unknown;
    type: unknown;
  }> = [];
  for (const [event, values] of Object.entries(config.hooks ?? {})) {
    if (!Array.isArray(values)) continue;
    for (const item of values) {
      if (!Array.isArray(item?.hooks)) continue;
      for (const hook of item.hooks) {
        if (hook?._self_evolution_owner === owner)
          registrations.push({ event, command: hook.command, type: hook.type });
      }
    }
  }
  return registrations;
}

function addHook(config: any, event: string, command: string): void {
  config.hooks ??= {};
  const values = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
  config.hooks[event] = [
    ...values.filter((item: any) => !ownedHook(item)),
    commandHook(command, event),
  ];
}

function removeOwnedHooks(config: any): boolean {
  if (!config.hooks || typeof config.hooks !== "object") return false;
  let changed = false;
  for (const [event, values] of Object.entries(config.hooks)) {
    if (!Array.isArray(values)) continue;
    const remaining = values.filter((item) => !ownedHook(item));
    if (remaining.length !== values.length) changed = true;
    if (remaining.length > 0) config.hooks[event] = remaining;
    else delete config.hooks[event];
  }
  if (Object.keys(config.hooks).length === 0) delete config.hooks;
  return changed;
}

const legacyHookScripts = new Set([
  "compact-recovery.sh",
  "session-end.sh",
  "stop.sh",
]);

function isLegacyOwnedCommand(command: unknown): boolean {
  if (typeof command !== "string") return false;
  const normalized = command.replaceAll("\\", "/");
  return [...legacyHookScripts].some((script) =>
    normalized.includes(`.agents/hooks/${script}`),
  );
}

function removeLegacyOwnedHooks(config: any): boolean {
  if (!config.hooks || typeof config.hooks !== "object") return false;
  let changed = false;
  for (const [event, values] of Object.entries(config.hooks)) {
    if (!Array.isArray(values)) continue;
    const remaining = [];
    for (const item of values) {
      if (!Array.isArray(item?.hooks)) {
        remaining.push(item);
        continue;
      }
      const hooks = item.hooks.filter(
        (hook: any) => !isLegacyOwnedCommand(hook?.command),
      );
      if (hooks.length !== item.hooks.length) changed = true;
      if (hooks.length > 0) remaining.push({ ...item, hooks });
    }
    if (remaining.length > 0) config.hooks[event] = remaining;
    else delete config.hooks[event];
  }
  if (Object.keys(config.hooks).length === 0) delete config.hooks;
  return changed;
}

async function backup(path: string): Promise<void> {
  if (!(await pathExists(path))) return;
  const backupPath = `${path}.self-evolution-v2.bak`;
  if (!(await pathExists(backupPath))) await copyFile(path, backupPath);
}

async function writeSettings(
  projectRoot: string,
  settings: any,
): Promise<void> {
  await atomicWrite(
    resolve(projectRoot, ".agents/settings.yaml"),
    stringify(settings, { lineWidth: 0 }),
  );
}

function validateTool(value: string): AdapterTool {
  if (!tools.includes(value as AdapterTool))
    throw new KbError(
      `Unsupported adapter tool: ${value}`,
      2,
      "ADAPTER_TOOL_INVALID",
    );
  return value as AdapterTool;
}

function normalizeFeatures(values: string[]): AdapterFeature[] {
  const features =
    values.length > 0 ? values : ["context-recovery", "post-task-reminder"];
  for (const feature of features) {
    if (feature !== "context-recovery" && feature !== "post-task-reminder")
      throw new KbError(
        `Unsupported adapter feature: ${feature}`,
        2,
        "ADAPTER_FEATURE_INVALID",
      );
  }
  return [...new Set(features)] as AdapterFeature[];
}

export async function installAdapter(
  projectRoot: string,
  toolValue: string,
  featureValues: string[],
): Promise<CommandResult> {
  const tool = validateTool(toolValue);
  const features = normalizeFeatures(featureValues);
  const generated = resolve(projectRoot, ".agents/generated/adapters", tool);
  const configPath = safeResolve(projectRoot, configPaths[tool]);
  const settingsPath = resolve(projectRoot, ".agents/settings.yaml");
  const beforeConfig = (await pathExists(configPath))
    ? await readText(configPath)
    : null;
  const beforeSettings = (await pathExists(settingsPath))
    ? await readText(settingsPath)
    : null;
  const beforePayloads = await Promise.all(
    [
      "context-recovery.mjs",
      "post-task-reminder.mjs",
      "opencode-plugin.mjs",
      "features.json",
    ].map(async (name) => {
      const path = resolve(generated, name);
      return [
        name,
        (await pathExists(path)) ? await readText(path) : null,
      ] as const;
    }),
  );
  const config = await readJsonConfig(configPath);
  const settings = await readSettings(projectRoot);
  const payloads = [
    ...(features.includes("context-recovery") ? ["context-recovery.mjs"] : []),
    ...(features.includes("post-task-reminder")
      ? ["post-task-reminder.mjs"]
      : []),
    ...(tool === "opencode" ? ["opencode-plugin.mjs"] : []),
  ];
  const desiredPayloads = new Set(payloads);
  await mkdir(generated, { recursive: true });
  for (const name of [
    "context-recovery.mjs",
    "post-task-reminder.mjs",
    "opencode-plugin.mjs",
  ]) {
    const destination = resolve(generated, name);
    if (!desiredPayloads.has(name)) {
      await rm(destination, { force: true });
      continue;
    }
    const source = assetPath(`adapters/${name}`);
    if (!(await pathExists(source)))
      throw new KbError(
        `Required adapter asset is missing: ${name}`,
        3,
        "ADAPTER_ASSET_MISSING",
      );
    const content = await readText(source);
    if (
      !(await pathExists(destination)) ||
      (await readText(destination)) !== content
    )
      await atomicWrite(destination, content);
  }
  const featureState = `${JSON.stringify({ context_recovery: features.includes("context-recovery"), post_task_reminder: features.includes("post-task-reminder") }, null, 2)}\n`;
  const featurePath = resolve(generated, "features.json");
  if (
    !(await pathExists(featurePath)) ||
    (await readText(featurePath)) !== featureState
  )
    await atomicWrite(featurePath, featureState);

  if (tool === "opencode") {
    const plugin = pathToFileURL(
      resolve(generated, "opencode-plugin.mjs"),
    ).href;
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    config.plugin = [
      ...plugins.filter(
        (item: unknown) =>
          typeof item !== "string" || !item.includes(pluginSuffix),
      ),
      plugin,
    ];
  } else {
    removeOwnedHooks(config);
    if (features.includes("context-recovery"))
      addHook(
        config,
        "SessionStart",
        `node .agents/generated/adapters/${tool}/context-recovery.mjs`,
      );
    if (features.includes("post-task-reminder"))
      addHook(
        config,
        "Stop",
        `node .agents/generated/adapters/${tool}/post-task-reminder.mjs`,
      );
  }
  const nextConfig = `${JSON.stringify(config, null, 2)}\n`;
  if (beforeConfig !== nextConfig) {
    await backup(configPath);
    await atomicWrite(configPath, nextConfig);
  }

  settings.adapters ??= { active: {} };
  settings.adapters.active ??= {};
  settings.adapters.active[tool] = {
    context_recovery: features.includes("context-recovery"),
    post_task_reminder: features.includes("post-task-reminder"),
  };
  const nextSettings = stringify(settings, { lineWidth: 0 });
  if (beforeSettings !== nextSettings)
    await atomicWrite(settingsPath, nextSettings);
  const status = await adapterStatus(projectRoot, tool);
  if (status.diagnostics.some((item) => item.severity === "error"))
    throw new KbError(
      "Adapter verification failed after installation.",
      3,
      "ADAPTER_VERIFY_FAILED",
    );
  const afterConfig = await readText(configPath);
  const afterSettings = await readText(settingsPath);
  const afterPayloads = await Promise.all(
    beforePayloads.map(async ([name]) => {
      const path = resolve(generated, name);
      return [
        name,
        (await pathExists(path)) ? await readText(path) : null,
      ] as const;
    }),
  );
  return {
    command: "adapter install",
    ok: true,
    changed:
      beforeConfig !== afterConfig ||
      beforeSettings !== afterSettings ||
      JSON.stringify(beforePayloads) !== JSON.stringify(afterPayloads),
    data: {
      tool,
      features,
      config: toPosix(relative(projectRoot, configPath)),
    },
  };
}

export async function removeAdapter(
  projectRoot: string,
  toolValue: string,
): Promise<CommandResult> {
  const tool = validateTool(toolValue);
  const configPath = safeResolve(projectRoot, configPaths[tool]);
  let changed = false;
  if (await pathExists(configPath)) {
    const config = await readJsonConfig(configPath);
    let configChanged = false;
    if (tool === "opencode") {
      if (Array.isArray(config.plugin)) {
        const before = config.plugin.length;
        config.plugin = config.plugin.filter(
          (item: unknown) =>
            typeof item !== "string" || !item.includes(pluginSuffix),
        );
        configChanged = config.plugin.length !== before;
        if (config.plugin.length === 0) delete config.plugin;
      }
    } else configChanged = removeOwnedHooks(config);
    if (configChanged) {
      await backup(configPath);
      await atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`);
      changed = true;
    }
  }
  const settings = await readSettings(projectRoot);
  if (
    settings.adapters?.active &&
    Object.prototype.hasOwnProperty.call(settings.adapters.active, tool)
  ) {
    delete settings.adapters.active[tool];
    await writeSettings(projectRoot, settings);
    changed = true;
  }
  const generated = resolve(projectRoot, ".agents/generated/adapters", tool);
  if (await pathExists(generated)) {
    await rm(generated, { recursive: true, force: true });
    changed = true;
  }
  return { command: "adapter remove", ok: true, changed, data: { tool } };
}

export async function removeLegacyAdapter(
  projectRoot: string,
  toolValue: string,
): Promise<void> {
  const tool = validateTool(toolValue);
  const configPath = safeResolve(projectRoot, configPaths[tool]);
  if (!(await pathExists(configPath))) return;
  const config = await readJsonConfig(configPath);
  await backup(configPath);
  if (tool === "opencode") {
    if (Array.isArray(config.plugin)) {
      config.plugin = config.plugin.filter(
        (item: unknown) =>
          typeof item !== "string" ||
          !item.includes("/.agents/hooks/opencode-plugin.mjs"),
      );
      if (config.plugin.length === 0) delete config.plugin;
    }
  } else if (config.hooks && typeof config.hooks === "object") {
    removeLegacyOwnedHooks(config);
  }
  await atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function adapterStatus(
  projectRoot: string,
  toolValue?: string,
): Promise<{
  command: string;
  ok: boolean;
  diagnostics: Diagnostic[];
  data: unknown;
}> {
  const settings = await readSettings(projectRoot);
  const selected = toolValue ? [validateTool(toolValue)] : tools;
  const diagnostics: Diagnostic[] = [];
  const data: Record<string, unknown> = {};
  for (const tool of selected) {
    const configured = settings.adapters?.active?.[tool];
    if (!configured) {
      data[tool] = { enabled: false };
      continue;
    }
    const configPath = safeResolve(projectRoot, configPaths[tool]);
    if (!(await pathExists(configPath))) {
      diagnostics.push({
        code: "ADAPTER_CONFIG_MISSING",
        severity: "error",
        message: `Configured adapter file is missing: ${configPaths[tool]}`,
        path: configPaths[tool],
      });
      data[tool] = { enabled: true, valid: false };
      continue;
    }
    const config = await readJsonConfig(configPath);
    const configValid =
      tool === "opencode"
        ? Array.isArray(config.plugin) &&
          config.plugin.includes(
            pathToFileURL(
              resolve(
                projectRoot,
                ".agents/generated/adapters/opencode/opencode-plugin.mjs",
              ),
            ).href,
          )
        : true;
    const expectedPayloads = [
      ...(configured.context_recovery ? ["context-recovery.mjs"] : []),
      ...(configured.post_task_reminder ? ["post-task-reminder.mjs"] : []),
      ...(tool === "opencode" ? ["opencode-plugin.mjs", "features.json"] : []),
    ];
    const payloadsValid = (
      await Promise.all(
        expectedPayloads.map((name) =>
          pathExists(
            resolve(projectRoot, ".agents/generated/adapters", tool, name),
          ),
        ),
      )
    ).every(Boolean);
    let featureStateValid = true;
    if (tool === "opencode" && payloadsValid) {
      try {
        const featureState = JSON.parse(
          await readText(
            resolve(
              projectRoot,
              ".agents/generated/adapters",
              tool,
              "features.json",
            ),
          ),
        );
        featureStateValid =
          featureState?.context_recovery === configured.context_recovery &&
          featureState?.post_task_reminder === configured.post_task_reminder;
      } catch {
        featureStateValid = false;
      }
    }
    const enabledFeatures = [
      ...(configured.context_recovery ? ["context-recovery"] : []),
      ...(configured.post_task_reminder ? ["post-task-reminder"] : []),
    ] as AdapterFeature[];
    const expectedRegistrations = enabledFeatures.map((feature) =>
      expectedHook(tool, feature),
    );
    const actualRegistrations =
      tool === "opencode" ? [] : ownedHookRegistrations(config);
    const featureConfigValid =
      tool === "opencode" ||
      (actualRegistrations.length === expectedRegistrations.length &&
        expectedRegistrations.every((expected) =>
          actualRegistrations.some(
            (actual) =>
              actual.event === expected.event &&
              actual.command === expected.command &&
              actual.type === "command",
          ),
        ));
    const valid =
      configValid && payloadsValid && featureConfigValid && featureStateValid;
    if (!valid)
      diagnostics.push({
        code: "ADAPTER_CONFIG_STALE",
        severity: "error",
        message: `Adapter config no longer contains the owned integration for ${tool}.`,
        path: configPaths[tool],
      });
    data[tool] = { enabled: true, valid, features: configured };
  }
  return {
    command: "adapter status",
    ok: !diagnostics.some((item) => item.severity === "error"),
    diagnostics,
    data,
  };
}
