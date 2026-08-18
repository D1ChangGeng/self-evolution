import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { checkCommand } from "./check.js";
import {
  atomicWrite,
  copyTree,
  hashFiles,
  listFiles,
  pathExists,
  readText,
  safeResolve,
  sha256File,
  toPosix,
  writeJson,
} from "./fs.js";
import { indexCommand } from "./index-command.js";
import { markdownTitle, parseMarkdown, serializeMarkdown } from "./markdown.js";
import type { CommandResult } from "./types.js";
import { KbError } from "./types.js";
import {
  installAdapter,
  removeLegacyAdapter,
  tools as adapterTools,
  type AdapterTool,
} from "./adapter.js";
import { loadAsset } from "./assets.js";

type MigrationPlan = {
  schema_version: "2.0";
  run_id: string;
  source_hash: string;
  source_files: string[];
  candidate_root: string;
  semantic_review: Array<{
    id: string;
    source: string;
    proposed: string;
    reason: string;
    disposition: "preserve" | "merge" | "split" | "archive" | "drop" | null;
    resolved: boolean;
  }>;
  adapter_review: {
    required: boolean;
    selection: "convert" | "disable" | null;
    tools?: AdapterTool[];
  };
  agents_approved: boolean;
  state: "prepared" | "applied" | "rolled_back";
  backup_root: string | null;
  applied_hashes?: Record<string, string | null>;
};

const v1Directories = [
  "domains",
  "reference",
  "patterns",
  "crystallized",
  "decisions",
  "inbox",
  "archive",
];
const controlledPaths = [
  "AGENTS.md",
  ".agents/knowledge",
  ".agents/settings.yaml",
  ".agents/generated",
  ".agents/rules",
  ".agents/hooks",
  ".claude/settings.json",
  ".claude/settings.json.self-evolution-v2.bak",
  ".cursor/hooks.json",
  ".cursor/hooks.json.self-evolution-v2.bak",
  ".opencode/opencode.json",
  ".opencode/opencode.json.self-evolution-v2.bak",
  ".augment/settings.json",
  ".augment/settings.json.self-evolution-v2.bak",
];

const adapterConfigPaths: Record<AdapterTool, string> = {
  "claude-code": ".claude/settings.json",
  cursor: ".cursor/hooks.json",
  opencode: ".opencode/opencode.json",
  "augment-code": ".augment/settings.json",
};

function containsLegacyAdapterReference(content: string): boolean {
  const normalized = content
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
  return [
    "compact-recovery.sh",
    "session-end.sh",
    "stop.sh",
    "opencode-plugin.mjs",
  ].some((name) => normalized.includes(`.agents/hooks/${name}`));
}

function parseJsonc(content: string): any {
  let output = "";
  let inString = false;
  let escaped = false;
  const source = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!;
    const next = source[index + 1];
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
      while (index + 1 < source.length && source[index + 1] !== "\n")
        index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      )
        index += 1;
      index += 1;
      continue;
    }
    output += current;
  }
  return JSON.parse(output.replace(/,\s*([}\]])/g, "$1"));
}

function containsLegacyAdapterRegistration(
  tool: AdapterTool,
  content: string,
): boolean {
  let config: any;
  try {
    config = parseJsonc(content);
  } catch {
    // Unsafe host config must block script deletion until it can be reviewed.
    return containsLegacyAdapterReference(content);
  }
  if (tool === "opencode")
    return (
      Array.isArray(config?.plugin) &&
      config.plugin.some(
        (item: unknown) =>
          typeof item === "string" &&
          containsLegacyAdapterReference(item) &&
          item.toLowerCase().includes("opencode-plugin.mjs"),
      )
    );
  return Object.values(config?.hooks ?? {}).some(
    (values) =>
      Array.isArray(values) &&
      values.some(
        (item: any) =>
          Array.isArray(item?.hooks) &&
          item.hooks.some(
            (hook: any) =>
              typeof hook?.command === "string" &&
              containsLegacyAdapterReference(hook.command),
          ),
      ),
  );
}

async function legacyAdapterTools(projectRoot: string): Promise<AdapterTool[]> {
  const detected: AdapterTool[] = [];
  for (const tool of adapterTools) {
    const path = resolve(projectRoot, adapterConfigPaths[tool]);
    if (
      (await pathExists(path)) &&
      containsLegacyAdapterRegistration(tool, await readText(path))
    )
      detected.push(tool);
  }
  return detected;
}

async function manifestAdapterTool(
  projectRoot: string,
): Promise<AdapterTool | null> {
  const path = resolve(projectRoot, ".agents/knowledge/manifest.json");
  if (!(await pathExists(path))) return null;
  try {
    const manifest = JSON.parse(await readText(path));
    return adapterTools.includes(manifest?.hooks?.integration)
      ? manifest.hooks.integration
      : null;
  } catch {
    return null;
  }
}

async function sourceFiles(projectRoot: string): Promise<string[]> {
  const result: string[] = [];
  for (const directory of v1Directories) {
    for (const file of await listFiles(
      resolve(projectRoot, ".agents/knowledge", directory),
    ))
      result.push(toPosix(relative(projectRoot, file)));
  }
  for (const directory of [".agents/rules", ".agents/hooks"])
    for (const file of await listFiles(resolve(projectRoot, directory)))
      result.push(toPosix(relative(projectRoot, file)));
  for (const file of [
    ".agents/knowledge/manifest.json",
    ".agents/knowledge/SKILL-LOCAL.md",
    "AGENTS.md",
  ]) {
    if (await pathExists(resolve(projectRoot, file))) result.push(file);
  }
  for (const tool of await legacyAdapterTools(projectRoot))
    result.push(adapterConfigPaths[tool]);
  return [...new Set(result)].sort((a, b) => a.localeCompare(b, "en"));
}

function candidatePath(v1Path: string): {
  path: string;
  kind?: string;
  review?: string;
} {
  const relativePath = v1Path.replace(/^\.agents\/knowledge\//, "");
  if (relativePath.startsWith("domains/"))
    return {
      path: `guides/${relativePath.slice("domains/".length)}`,
      kind: "guide",
    };
  if (relativePath.startsWith("reference/"))
    return {
      path: `guides/reference/${relativePath.slice("reference/".length)}`,
      kind: "map",
    };
  if (relativePath.startsWith("patterns/"))
    return {
      path: `guides/patterns/${relativePath.slice("patterns/".length)}`,
      kind: "guide",
      review: "Decide whether to merge this pattern into a scoped Guide.",
    };
  if (relativePath.startsWith("crystallized/"))
    return {
      path: `guides/runbooks/${relativePath.slice("crystallized/".length)}`,
      kind: "runbook",
    };
  if (relativePath.startsWith("decisions/"))
    return {
      path: relativePath,
      kind: "decision",
      review:
        "Convert v1 Decision frontmatter to the required v2 id, scope, supersedes, and status fields.",
    };
  if (relativePath.startsWith("inbox/"))
    return {
      path: `observations/${relativePath.slice("inbox/".length)}`,
      review: "Filter entries using future-action value before activation.",
    };
  if (relativePath.startsWith("archive/")) return { path: relativePath };
  if (relativePath === "SKILL-LOCAL.md")
    return {
      path: "archive/SKILL-LOCAL.v1.md",
      review:
        "Move adopted rules to AGENTS policy, a scoped policy Guide, or settings.",
    };
  if (v1Path.startsWith(".agents/rules/"))
    return {
      path: `archive/v1/rules/${v1Path.slice(".agents/rules/".length)}`,
      review:
        "Classify this v1 rule as generated routing or user-owned policy before removing the active v1 rules tree.",
    };
  if (v1Path.startsWith(".agents/hooks/"))
    return {
      path: `archive/v1/hooks/${v1Path.slice(".agents/hooks/".length)}`,
      review:
        "Classify this v1 Hook as generated lifecycle code or user-owned automation before removing the active v1 hooks tree.",
    };
  return { path: `archive/v1/${relativePath}` };
}

function convertKnowledge(
  content: string,
  kind: string | undefined,
  source: string,
): string {
  if (!kind) return content.replaceAll("\r\n", "\n");
  const parsed = parseMarkdown(content, source);
  if (parsed.diagnostics.some((item) => item.severity === "error")) {
    const detail = parsed.diagnostics
      .map((item) => `${item.code}: ${item.message}`)
      .join("; ");
    throw new KbError(
      `Cannot migrate malformed v1 knowledge ${source}: ${detail}`,
      2,
      "MIGRATION_V1_INVALID",
    );
  }
  if (kind === "decision") return content.replaceAll("\r\n", "\n");
  const scope =
    Array.isArray(parsed.data.scope) && parsed.data.scope.length > 0
      ? parsed.data.scope
      : ["**/*"];
  const title = markdownTitle(parsed.body) ?? basename(source, ".md");
  return serializeMarkdown(
    {
      kind,
      status: "draft",
      scope,
      use_when: [`reviewing migrated knowledge from ${source}`],
    },
    parsed.body || `# ${title}\n\nMigrated from \`${source}\`.\n`,
  );
}

async function readPlan(
  projectRoot: string,
  runId: string,
): Promise<{ plan: MigrationPlan; path: string }> {
  if (!/^[a-f0-9]{16}$/.test(runId))
    throw new KbError(
      "Migration run id is invalid.",
      2,
      "MIGRATION_ID_INVALID",
    );
  const path = safeResolve(
    projectRoot,
    `.agents/.migrations/${runId}/plan.yaml`,
  );
  if (!(await pathExists(path)))
    throw new KbError(
      `Migration run does not exist: ${runId}`,
      2,
      "MIGRATION_NOT_FOUND",
    );
  const plan = parse(await readText(path)) as MigrationPlan;
  const expectedCandidate = `.agents/.migrations/${runId}/candidate/knowledge`;
  if (
    !plan ||
    plan.run_id !== runId ||
    plan.schema_version !== "2.0" ||
    plan.candidate_root !== expectedCandidate ||
    !Array.isArray(plan.source_files) ||
    plan.source_files.some(
      (item) => typeof item !== "string" || !safePlanPath(item),
    ) ||
    !Array.isArray(plan.semantic_review) ||
    plan.semantic_review.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        typeof item.source !== "string" ||
        !safePlanPath(item.source) ||
        typeof item.proposed !== "string" ||
        !safePlanPath(item.proposed) ||
        typeof item.reason !== "string" ||
        ![null, "preserve", "merge", "split", "archive", "drop"].includes(
          item.disposition,
        ) ||
        typeof item.resolved !== "boolean",
    ) ||
    !plan.adapter_review ||
    typeof plan.adapter_review.required !== "boolean" ||
    ![null, "convert", "disable"].includes(plan.adapter_review.selection) ||
    (plan.adapter_review.tools !== undefined &&
      (!Array.isArray(plan.adapter_review.tools) ||
        plan.adapter_review.tools.some((tool) => !adapterTools.includes(tool))))
  ) {
    throw new KbError(
      "Migration plan is invalid or contains unsafe paths.",
      3,
      "MIGRATION_PLAN_INVALID",
    );
  }
  if (
    plan.backup_root !== null &&
    plan.backup_root !== `.agents/legacy/v1-${runId}`
  )
    throw new KbError(
      "Migration backup path was modified.",
      3,
      "MIGRATION_PLAN_INVALID",
    );
  if (
    plan.applied_hashes !== undefined &&
    (!plan.applied_hashes ||
      typeof plan.applied_hashes !== "object" ||
      Array.isArray(plan.applied_hashes) ||
      Object.entries(plan.applied_hashes).some(
        ([path, hash]) =>
          !safePlanPath(path) ||
          !(hash === null || /^[0-9a-f]{64}$/.test(hash)),
      ))
  ) {
    throw new KbError(
      "Migration applied-state hashes are invalid.",
      3,
      "MIGRATION_PLAN_INVALID",
    );
  }
  return { plan, path };
}

function safePlanPath(value: string): boolean {
  return (
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split("/").includes("..")
  );
}

async function savePlan(path: string, plan: MigrationPlan): Promise<void> {
  const { atomicWrite } = await import("./fs.js");
  await atomicWrite(path, stringify(plan, { lineWidth: 0 }));
}

export async function prepareMigration(
  projectRoot: string,
): Promise<CommandResult> {
  const files = await sourceFiles(projectRoot);
  if (
    files.length === 0 ||
    !files.some((file) => file.startsWith(".agents/knowledge/"))
  )
    throw new KbError("No v1 knowledge base was detected.", 2, "V1_NOT_FOUND");
  const sourceHash = await hashFiles(projectRoot, files);
  const runId = sourceHash.slice(0, 16);
  const runRoot = resolve(projectRoot, ".agents/.migrations", runId);
  const candidateRoot = resolve(runRoot, "candidate/knowledge");
  const planPath = resolve(runRoot, "plan.yaml");
  if (await pathExists(planPath))
    return {
      command: "migrate prepare",
      ok: true,
      changed: false,
      data: { run_id: runId, plan: toPosix(relative(projectRoot, planPath)) },
    };
  await mkdir(candidateRoot, { recursive: true });
  const review: MigrationPlan["semantic_review"] = [];
  const trace: Array<{
    source: string;
    proposed: string;
    review_id: string | null;
    disposition: string;
  }> = [];
  let counter = 0;
  for (const source of files.filter(
    (file) =>
      (file.startsWith(".agents/knowledge/") &&
        !file.endsWith("manifest.json")) ||
      file.startsWith(".agents/rules/") ||
      file.startsWith(".agents/hooks/"),
  )) {
    const target = candidatePath(source);
    const destination = resolve(candidateRoot, target.path);
    await mkdir(dirname(destination), { recursive: true });
    const content = convertKnowledge(
      await readText(resolve(projectRoot, source)),
      target.kind,
      source,
    );
    const { atomicWrite } = await import("./fs.js");
    await atomicWrite(destination, content);
    const reviewId = target.review
      ? `R${String(++counter).padStart(3, "0")}`
      : null;
    trace.push({
      source,
      proposed: `knowledge/${target.path}`,
      review_id: reviewId,
      disposition: target.review
        ? "semantic review required"
        : "mechanical candidate",
    });
    if (target.review)
      review.push({
        id: reviewId!,
        source,
        proposed: `knowledge/${target.path}`,
        reason: target.review,
        disposition: null,
        resolved: false,
      });
  }
  const manifestPath = resolve(projectRoot, ".agents/knowledge/manifest.json");
  const detectedAdapterTools = await legacyAdapterTools(projectRoot);
  const manifestAdapter = await manifestAdapterTool(projectRoot);
  if (await pathExists(manifestPath)) {
    trace.push({
      source: ".agents/knowledge/manifest.json",
      proposed: "index/settings or intentionally omitted fields",
      review_id: null,
      disposition:
        "inventory is regenerated; hooks require review; health, counters, and skill queues are not migrated",
    });
  }
  const legacyAdapters = [
    ...new Set([
      ...detectedAdapterTools,
      ...(manifestAdapter ? [manifestAdapter] : []),
    ]),
  ];
  for (const tool of detectedAdapterTools)
    trace.push({
      source: adapterConfigPaths[tool],
      proposed: `adapter review for ${tool}`,
      review_id: null,
      disposition: "legacy v1 registration requires convert or disable",
    });
  const proposedAgents = resolve(runRoot, "AGENTS.md.v2-proposed");
  const { loadAsset } = await import("./assets.js");
  const { atomicWrite } = await import("./fs.js");
  await atomicWrite(proposedAgents, await loadAsset("templates/agents.md"));
  if (files.includes("AGENTS.md"))
    trace.push({
      source: "AGENTS.md",
      proposed: "AGENTS.md.v2-proposed",
      review_id: null,
      disposition: "separate human approval required",
    });
  const plan: MigrationPlan = {
    schema_version: "2.0",
    run_id: runId,
    source_hash: sourceHash,
    source_files: files,
    candidate_root: toPosix(relative(projectRoot, candidateRoot)),
    semantic_review: review,
    adapter_review: {
      required: legacyAdapters.length > 0,
      selection: null,
      tools: legacyAdapters,
    },
    agents_approved: false,
    state: "prepared",
    backup_root: null,
  };
  await savePlan(planPath, plan);
  await atomicWrite(
    resolve(runRoot, "traceability.yaml"),
    stringify({ mappings: trace }, { lineWidth: 0 }),
  );
  return {
    command: "migrate prepare",
    ok: true,
    changed: true,
    data: {
      run_id: runId,
      plan: toPosix(relative(projectRoot, planPath)),
      semantic_review_items: review.length,
      adapter_choice_required: legacyAdapters.length > 0,
    },
  };
}

async function backupInputs(
  projectRoot: string,
  backupRoot: string,
): Promise<string[]> {
  await rm(backupRoot, { recursive: true, force: true });
  const present: string[] = [];
  const absent: string[] = [];
  for (const path of controlledPaths) {
    const source = resolve(projectRoot, path);
    if (!(await pathExists(source))) {
      absent.push(path);
      continue;
    }
    await copyTree(source, resolve(backupRoot, "files", path));
    present.push(path);
  }
  const hashes: Record<string, string> = {};
  for (const file of await listFiles(resolve(backupRoot, "files")))
    hashes[toPosix(relative(resolve(backupRoot, "files"), file))] =
      await sha256File(file);
  await writeJson(resolve(backupRoot, "manifest.json"), {
    present,
    absent,
    hashes,
  });
  return present;
}

async function controlledState(
  projectRoot: string,
): Promise<Record<string, string | null>> {
  const state: Record<string, string | null> = {};
  for (const path of controlledPaths) {
    const absolute = resolve(projectRoot, path);
    if (!(await pathExists(absolute))) {
      state[path] = null;
      continue;
    }
    const info = await lstat(absolute);
    if (info.isFile()) {
      state[path] = await sha256File(absolute);
      continue;
    }
    const files = await listFiles(absolute);
    const hashInput = files.map((file) => toPosix(relative(projectRoot, file)));
    state[path] = await hashFiles(projectRoot, hashInput);
  }
  return state;
}

async function assertControlledState(
  projectRoot: string,
  expected: Record<string, string | null>,
): Promise<void> {
  const actual = await controlledState(projectRoot);
  const changed = controlledPaths.filter(
    (path) => actual[path] !== expected[path],
  );
  if (changed.length > 0) {
    throw new KbError(
      `Controlled files changed after migration: ${changed.join(", ")}`,
      3,
      "ROLLBACK_STATE_CHANGED",
    );
  }
}

async function restoreBackup(
  projectRoot: string,
  backupRoot: string,
): Promise<void> {
  const manifest = JSON.parse(
    await readText(resolve(backupRoot, "manifest.json")),
  ) as { present: string[]; absent: string[]; hashes: Record<string, string> };
  for (const path of controlledPaths)
    await rm(resolve(projectRoot, path), { recursive: true, force: true });
  for (const path of manifest.present)
    await copyTree(
      resolve(backupRoot, "files", path),
      resolve(projectRoot, path),
    );
  for (const [path, expected] of Object.entries(manifest.hashes)) {
    const actual = await sha256File(resolve(projectRoot, path));
    if (actual !== expected)
      throw new KbError(
        `Rollback hash mismatch: ${path}`,
        3,
        "ROLLBACK_HASH_MISMATCH",
      );
  }
}

async function recoverCandidate(
  projectRoot: string,
  runId: string,
  backupRoot: string,
): Promise<void> {
  const candidate = safeResolve(
    projectRoot,
    `.agents/.migrations/${runId}/candidate/knowledge`,
  );
  const live = resolve(projectRoot, ".agents/knowledge");
  const movedV1 = resolve(backupRoot, "active-v1-knowledge");
  if (
    (await pathExists(movedV1)) &&
    (await pathExists(live)) &&
    !(await pathExists(candidate))
  ) {
    await mkdir(dirname(candidate), { recursive: true });
    await rename(live, candidate);
  }
}

export async function applyMigration(
  projectRoot: string,
  runId: string,
): Promise<CommandResult> {
  const loaded = await readPlan(projectRoot, runId);
  const plan = loaded.plan;
  const journalPath = resolve(
    projectRoot,
    ".agents/.migrations",
    runId,
    "journal.json",
  );
  if (await pathExists(journalPath)) {
    const journal = JSON.parse(await readText(journalPath)) as {
      state?: string;
      backup_root?: string;
    };
    if (journal.state === "applying" && journal.backup_root) {
      const expected = `.agents/legacy/v1-${runId}`;
      if (journal.backup_root !== expected)
        throw new KbError(
          "Migration journal contains an unsafe backup path.",
          3,
          "MIGRATION_JOURNAL_INVALID",
        );
      const interruptedBackup = safeResolve(projectRoot, expected);
      await recoverCandidate(projectRoot, runId, interruptedBackup);
      await restoreBackup(projectRoot, interruptedBackup);
      await writeJson(journalPath, {
        state: "restored_after_interruption",
        backup_root: expected,
      });
      throw new KbError(
        "Recovered an interrupted migration. Review state and run prepare again.",
        3,
        "MIGRATION_INTERRUPTED_RECOVERED",
      );
    }
  }
  if (plan.state === "applied")
    return {
      command: "migrate apply",
      ok: true,
      changed: false,
      data: { run_id: runId, state: plan.state },
    };
  if (plan.state !== "prepared")
    throw new KbError(
      `Migration is not prepared: ${plan.state}`,
      3,
      "MIGRATION_STATE_CONFLICT",
    );
  if (
    plan.semantic_review.some(
      (item) => !item.resolved || item.disposition === null,
    )
  )
    throw new KbError(
      "Semantic review items need an explicit disposition and resolved: true in plan.yaml.",
      3,
      "MIGRATION_REVIEW_REQUIRED",
    );
  if (!plan.agents_approved)
    throw new KbError(
      "Set agents_approved: true in plan.yaml after reviewing AGENTS.md.v2-proposed.",
      3,
      "AGENTS_APPROVAL_REQUIRED",
    );
  const detectedAdapterTools = await legacyAdapterTools(projectRoot);
  const manifestAdapter = await manifestAdapterTool(projectRoot);
  const legacyAdapters = [
    ...new Set([
      ...detectedAdapterTools,
      ...(manifestAdapter ? [manifestAdapter] : []),
    ]),
  ];
  const adapterReviewRequired =
    plan.adapter_review.required || legacyAdapters.length > 0;
  if (adapterReviewRequired && !plan.adapter_review.selection)
    throw new KbError(
      "Choose adapter_review.selection: convert or disable in plan.yaml.",
      3,
      "ADAPTER_CHOICE_REQUIRED",
    );
  const actualFiles = await sourceFiles(projectRoot);
  if (
    JSON.stringify(actualFiles) !== JSON.stringify(plan.source_files) ||
    (await hashFiles(projectRoot, actualFiles)) !== plan.source_hash
  )
    throw new KbError(
      "v1 inputs changed after prepare; run prepare again.",
      3,
      "MIGRATION_INPUT_CHANGED",
    );

  const backupRoot = safeResolve(projectRoot, `.agents/legacy/v1-${runId}`);
  await backupInputs(projectRoot, backupRoot);
  await writeJson(journalPath, {
    state: "applying",
    backup_root: toPosix(relative(projectRoot, backupRoot)),
  });
  try {
    const liveKnowledge = resolve(projectRoot, ".agents/knowledge");
    const preservedV1 = resolve(backupRoot, "active-v1-knowledge");
    if (await pathExists(liveKnowledge))
      await rename(liveKnowledge, preservedV1);
    await rename(safeResolve(projectRoot, plan.candidate_root), liveKnowledge);
    await copyTree(
      resolve(
        projectRoot,
        `.agents/.migrations/${runId}/AGENTS.md.v2-proposed`,
      ),
      resolve(projectRoot, "AGENTS.md"),
    );
    await atomicWrite(
      resolve(projectRoot, ".agents/settings.yaml"),
      await loadAsset("templates/settings.yaml"),
    );
    if (adapterReviewRequired) {
      for (const tool of legacyAdapters) {
        await removeLegacyAdapter(projectRoot, tool);
      }
      if (plan.adapter_review.selection === "convert") {
        if (legacyAdapters.length === 0)
          throw new Error("legacy adapter tool could not be determined");
        for (const tool of legacyAdapters)
          await installAdapter(projectRoot, tool, [
            "context-recovery",
            "post-task-reminder",
          ]);
      }
    }
    const remainingLegacyAdapters = await legacyAdapterTools(projectRoot);
    if (remainingLegacyAdapters.length > 0)
      throw new Error(
        `legacy adapter registrations remain: ${remainingLegacyAdapters.join(", ")}`,
      );
    await rm(resolve(projectRoot, ".agents/hooks"), {
      recursive: true,
      force: true,
    });
    await rm(resolve(projectRoot, ".agents/rules"), {
      recursive: true,
      force: true,
    });
    await indexCommand(projectRoot);
    const checked = await checkCommand(projectRoot);
    if (!checked.ok) throw new Error("post-migration check failed");
  } catch (error) {
    await recoverCandidate(projectRoot, runId, backupRoot);
    await restoreBackup(projectRoot, backupRoot);
    await writeJson(journalPath, {
      state: "restored_after_failure",
      error: (error as Error).message,
    });
    throw new KbError(
      `Migration failed and was restored: ${(error as Error).message}`,
      3,
      "MIGRATION_APPLY_FAILED",
    );
  }
  plan.state = "applied";
  plan.backup_root = toPosix(relative(projectRoot, backupRoot));
  plan.applied_hashes = await controlledState(projectRoot);
  await savePlan(loaded.path, plan);
  await writeJson(journalPath, {
    state: "applied",
    backup_root: plan.backup_root,
  });
  return {
    command: "migrate apply",
    ok: true,
    changed: true,
    data: { run_id: runId, backup_root: plan.backup_root },
  };
}

export async function rollbackMigration(
  projectRoot: string,
  runId: string,
): Promise<CommandResult> {
  const loaded = await readPlan(projectRoot, runId);
  const plan = loaded.plan;
  if (plan.state === "rolled_back")
    return {
      command: "migrate rollback",
      ok: true,
      changed: false,
      data: { run_id: runId, state: plan.state },
    };
  if (plan.state !== "applied" || !plan.backup_root)
    throw new KbError(
      "Only an applied migration can be rolled back.",
      3,
      "MIGRATION_STATE_CONFLICT",
    );
  if (!plan.applied_hashes)
    throw new KbError(
      "Migration lacks an applied-state baseline; rollback cannot safely overwrite current files.",
      3,
      "ROLLBACK_BASELINE_MISSING",
    );
  await assertControlledState(projectRoot, plan.applied_hashes);
  await rm(resolve(projectRoot, ".agents/knowledge"), {
    recursive: true,
    force: true,
  });
  await restoreBackup(projectRoot, safeResolve(projectRoot, plan.backup_root));
  plan.state = "rolled_back";
  await savePlan(loaded.path, plan);
  await writeJson(
    resolve(projectRoot, `.agents/.migrations/${runId}/journal.json`),
    { state: "rolled_back", backup_root: plan.backup_root },
  );
  return {
    command: "migrate rollback",
    ok: true,
    changed: true,
    data: { run_id: runId },
  };
}
