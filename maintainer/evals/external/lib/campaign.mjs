import { randomBytes } from "node:crypto";
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  aggregateCampaign,
  assertNoVersionLeak,
  assertSafeRelativePath,
  createSchedule,
  campaignGateStatus,
  evidencePhase,
  exists,
  fileSha256,
  freezeSubjects,
  hashTree,
  initialState,
  isTerminalUnitState,
  loadTaskSpecs,
  makeCampaignId,
  markReviewSchemaInvalid,
  readJson,
  repositoryRootSha256,
  reviewSealDigest,
  sha256,
  sealReviews,
  stableJson,
  transitionState,
  validateOnboardingEvidence,
  validateWorkspaceEditEvidence,
  validateStateChain,
  validateVerdict,
  validateVerdictAgainstRuns,
  verificationEvidence,
  VERIFICATION_ARTIFACTS,
  verifyChecksums,
  VERSIONS,
  writeChecksums,
  writeJson,
} from "./core.mjs";
import {
  createUnitWorkspace,
  installUnitWorkspace,
  PINNED_WSL_TOOLCHAIN,
  prepareTask,
  verifyRepairedWorkspace,
  writeTaskBinding,
} from "./prepare.mjs";
import {
  executionCampaignRoot,
  materializeExternalWorkspace,
  prewarmRestrictedWsl,
  reviewWorkspacePath,
  smokeWorkspacePath,
  unitWorkspacePath,
  verifyRestrictedWslAvailability,
} from "./confinement.mjs";
import { collectWorkspaceManifest } from "./collector.mjs";
import {
  EXTERNAL_ISOLATION_CONTRACT,
  WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256,
} from "./opencode.mjs";

const PHASE_ORDER = Object.freeze(["onboarding", "repair", "verification"]);
export const WORKSPACE_EDIT_GATEWAY_COMMAND = "/harness/workspace-edit";

export function workspaceEditPhasePolicy(phase, outputDir) {
  if (!["onboarding", "repair"].includes(phase)) {
    throw new Error(`workspace edit gateway is not available during ${phase}`);
  }
  return {
    schema_version: "1.0",
    phase,
    command: WORKSPACE_EDIT_GATEWAY_COMMAND,
    receipt_dir: resolve(outputDir, "workspace-edit-receipts"),
    workspace_root: "/workspace",
    subject_root: "/subject/self-evolution",
    git_metadata: {
      mount: "read-only",
      GIT_OPTIONAL_LOCKS: "0",
    },
    write_scope:
      phase === "onboarding"
        ? { allow: ["AGENTS.md", ".agents/**"] }
        : { allow: ["workspace source", "visible tests"] },
    deny: [
      ".git/**",
      "node_modules/**",
      ".external-eval/**",
      "package.json",
      "package-lock.json",
      "hidden/**",
      "oracle/**",
      "sealed/**",
    ],
  };
}

export function requireExplicitCampaignOption(options) {
  if (!options?.campaign) {
    throw new Error(
      "--campaign is required; implicit latest campaign selection is disabled",
    );
  }
}

export function validateCampaignId(value) {
  if (
    typeof value !== "string" ||
    !/^external-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    throw new Error(
      "--campaign must be a safe external-* directory name without path separators",
    );
  }
  return value;
}

export const FORMAL_TASK_IDS = Object.freeze([
  "p-limit-detached-map",
  "qs-surrogate-boundary",
  "request-primitive-json-error",
]);

export const DEFAULT_CONFIG = Object.freeze({
  schema_version: "1.0",
  opencode_version: "1.17.10",
  execution_model: "zeo/gpt-5.5-high",
  review_model: "dev-claude/claude-sonnet-4-6-thinking-high",
  attempts: 3,
  onboarding: { max_tool_calls: 90, timeout_ms: 45 * 60 * 1000 },
  repair: { max_tool_calls: 60, timeout_ms: 45 * 60 * 1000 },
  environment: {
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  },
  toolchain: PINNED_WSL_TOOLCHAIN,
  execution_assurance: {
    network_enforcement: EXTERNAL_ISOLATION_CONTRACT.network_enforcement,
    network_namespace: EXTERNAL_ISOLATION_CONTRACT.network_namespace,
    network_canaries: EXTERNAL_ISOLATION_CONTRACT.network_canaries,
    filesystem_enforcement: EXTERNAL_ISOLATION_CONTRACT.filesystem_enforcement,
    windows_confinement: EXTERNAL_ISOLATION_CONTRACT.windows_confinement,
    codex_sandbox_profile: EXTERNAL_ISOLATION_CONTRACT.codex_sandbox_profile,
    credential_transport: EXTERNAL_ISOLATION_CONTRACT.credential_transport,
  },
  toolchain_shim_enforcement:
    EXTERNAL_ISOLATION_CONTRACT.toolchain_shim_enforcement,
  workspace_edit_runtime_sha256: WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256,
  release_gate_effect: "none",
});

export const FORMAL_CAMPAIGN_PROTOCOL = Object.freeze({
  attempts: 3,
  task_ids: FORMAL_TASK_IDS,
  opencode_version: DEFAULT_CONFIG.opencode_version,
  execution_model: DEFAULT_CONFIG.execution_model,
  review_model: DEFAULT_CONFIG.review_model,
  onboarding: DEFAULT_CONFIG.onboarding,
  repair: DEFAULT_CONFIG.repair,
  environment: DEFAULT_CONFIG.environment,
  toolchain: DEFAULT_CONFIG.toolchain,
  execution_assurance: DEFAULT_CONFIG.execution_assurance,
  toolchain_shim_enforcement: DEFAULT_CONFIG.toolchain_shim_enforcement,
  workspace_edit_runtime_sha256: DEFAULT_CONFIG.workspace_edit_runtime_sha256,
  release_gate_effect: "none",
});

export function validateFormalCampaignProtocol(campaign) {
  if (campaign?.diagnostic === true) return;
  const actualTaskIds = campaign?.tasks
    ?.map((task) => task.id)
    .sort((left, right) => left.localeCompare(right, "en"));
  const expectedTaskIds = [...FORMAL_TASK_IDS].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const actual = {
    attempts: campaign?.attempts,
    task_ids: actualTaskIds,
    opencode_version: campaign?.opencode_version,
    execution_model: campaign?.execution_model,
    review_model: campaign?.review_model,
    onboarding: campaign?.onboarding,
    repair: campaign?.repair,
    environment: campaign?.environment,
    toolchain: campaign?.toolchain,
    execution_assurance: campaign?.execution_assurance,
    toolchain_shim_enforcement: campaign?.toolchain_shim_enforcement,
    workspace_edit_runtime_sha256: campaign?.workspace_edit_runtime_sha256,
    release_gate_effect: campaign?.release_gate_effect,
  };
  const expected = {
    ...FORMAL_CAMPAIGN_PROTOCOL,
    task_ids: expectedTaskIds,
  };
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error("formal campaign protocol constants do not match");
  }
}

function commandLineOptions(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      options._.push(item);
      continue;
    }
    const [key, inline] = item.slice(2).split("=", 2);
    if (inline !== undefined) options[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      options[key] = argv[index + 1];
      index += 1;
    } else options[key] = true;
  }
  return options;
}

export function parseCli(argv) {
  const options = commandLineOptions(argv);
  const command = options._[0];
  if (
    !command ||
    !["prepare", "run", "review", "verify", "report"].includes(command)
  ) {
    throw new Error(
      "usage: eval:external -- <prepare|run|review|verify|report> [options]",
    );
  }
  return { command, options };
}

async function latestCampaign(campaignsRoot) {
  if (!(await exists(campaignsRoot))) return null;
  const entries = (await readdir(campaignsRoot, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("external-"),
    )
    .sort((left, right) => right.name.localeCompare(left.name, "en"));
  return entries[0]?.name ?? null;
}

export async function resolveCampaignContext({
  repositoryRoot,
  options,
  requireExisting = true,
}) {
  const campaignsRoot = resolve(
    options.output ??
      process.env.SELF_EVOLUTION_EXTERNAL_ROOT ??
      resolve(repositoryRoot, "..", "self-evolution-campaigns", "external"),
  );
  const selectedId =
    options.campaign ??
    (requireExisting ? await latestCampaign(campaignsRoot) : null);
  if (requireExisting) requireExplicitCampaignOption(options);
  if (requireExisting && !selectedId)
    throw new Error(`no campaign found under ${campaignsRoot}`);
  const id = selectedId == null ? null : validateCampaignId(selectedId);
  return {
    campaignsRoot,
    campaignId: id,
    campaignRoot: id ? resolve(campaignsRoot, id) : null,
    executionRoot: id
      ? executionCampaignRoot(id, {
          campaignRoot: resolve(campaignsRoot, id),
          executionRoot: options.execution,
        })
      : null,
  };
}

async function validateRepositoryRootBinding(repositoryRoot, campaign) {
  const actual = await repositoryRootSha256(repositoryRoot);
  if (campaign?.repository_root_sha256 !== actual) {
    throw new Error("repository root hash drifted since campaign prepare");
  }
  return actual;
}

function campaignExecutionRoot(campaignRoot, campaign, options = {}) {
  const actual = executionCampaignRoot(campaign.campaign_id, {
    campaignRoot,
    executionRoot: options.execution,
  });
  if (
    typeof campaign.execution_root !== "string" ||
    resolve(campaign.execution_root) !== actual
  ) {
    throw new Error("campaign execution root binding mismatch");
  }
  return actual;
}

function taskRoot(repositoryRoot, taskId) {
  return resolve(repositoryRoot, "maintainer/evals/external/tasks", taskId);
}

async function loadExecutor() {
  const module = await import("./opencode.mjs");
  const required = [
    "prepareExecutionEnvironment",
    "smokeModels",
    "runPhase",
    "collectRunEvidence",
    "createBlindBundle",
    "runBlindReview",
  ];
  for (const name of required) {
    if (typeof module[name] !== "function") {
      throw new Error(`executor adapter is missing export ${name}`);
    }
  }
  return module;
}

async function saveState(campaignRoot, state) {
  await writeJson(resolve(campaignRoot, "state.json"), state);
}

async function checkpointState(campaignRoot, state) {
  await saveState(campaignRoot, state);
  await writeChecksums(campaignRoot, [], { allowMutation: true });
}

async function loadCampaignFiles(campaignRoot) {
  return {
    campaign: await readJson(resolve(campaignRoot, "campaign.json")),
    schedule: await readJson(resolve(campaignRoot, "schedule.json")),
    sealed: await readJson(resolve(campaignRoot, "sealed/arm-mapping.json")),
    state: await readJson(resolve(campaignRoot, "state.json")),
  };
}

async function loadFrozenTasks(campaignRoot, campaign) {
  const tasks = [];
  for (const binding of campaign.tasks) {
    const frozenRoot = resolve(campaignRoot, "contracts", binding.id);
    const task = await readJson(resolve(frozenRoot, "task.json"));
    const tree = await hashTree(frozenRoot);
    if (tree.sha256 !== binding.contract_sha256) {
      throw new Error(`${binding.id}: frozen task contract hash mismatch`);
    }
    tasks.push({
      ...task,
      contract_sha256: tree.sha256,
      contract_root: frozenRoot,
    });
  }
  return tasks;
}

async function validateCampaignBindings(
  campaignRoot,
  files,
  { repositoryRoot = null, options = {} } = {},
) {
  validateFormalCampaignProtocol(files.campaign);
  const executionRoot = campaignExecutionRoot(
    campaignRoot,
    files.campaign,
    options,
  );
  if (files.state.execution_root !== files.campaign.execution_root) {
    throw new Error("campaign and state execution root bindings do not match");
  }
  if (
    resolve(files.campaign.campaign_root ?? "") !== resolve(campaignRoot) ||
    files.state.campaign_root !== files.campaign.campaign_root
  ) {
    throw new Error("campaign root binding mismatch");
  }
  if (repositoryRoot) {
    await validateRepositoryRootBinding(repositoryRoot, files.campaign);
    if (
      files.state.repository_root_sha256 !==
      files.campaign.repository_root_sha256
    ) {
      throw new Error(
        "campaign and state repository root bindings do not match",
      );
    }
  }
  if (files.schedule.campaign_id !== files.campaign.campaign_id)
    throw new Error("schedule campaign_id does not match campaign.json");
  if (files.sealed.campaign_id !== files.campaign.campaign_id)
    throw new Error("sealed mapping campaign_id does not match campaign.json");
  if (sha256(stableJson(files.schedule)) !== files.sealed.schedule_sha256)
    throw new Error("schedule hash mismatch");
  const labels = files.schedule.units.map((unit) => unit.blind_label);
  if (new Set(labels).size !== labels.length)
    throw new Error("blind labels are not unique");
  for (const label of labels) {
    if (!VERSIONS.includes(files.sealed.mapping[label]))
      throw new Error(`mapping for ${label} is missing or invalid`);
  }
  validateStateChain(files.state, files.schedule, files.sealed.mapping);
  const tasks = await loadFrozenTasks(campaignRoot, files.campaign);
  const subjectRoots = {
    v1: resolve(campaignRoot, "subjects/v1/self-evolution"),
    v2: resolve(campaignRoot, "subjects/v2/self-evolution"),
  };
  const v1 = await hashTree(subjectRoots.v1);
  const v2Skill = await hashTree(subjectRoots.v2);
  const v2Bundle = await fileSha256(
    resolve(subjectRoots.v2, "references/bin/kb.mjs"),
  );
  const v2Subject = sha256(
    stableJson({
      bundle_sha256: v2Bundle,
      skill_tree_sha256: v2Skill.sha256,
    }),
  );
  if (v1.sha256 !== files.campaign.subjects?.v1?.sha256) {
    throw new Error("v1 subject hash mismatch");
  }
  if (
    v2Skill.sha256 !== files.campaign.subjects?.v2?.skill_tree_sha256 ||
    v2Bundle !== files.campaign.subjects?.v2?.bundle_sha256 ||
    v2Subject !== files.campaign.subjects?.v2?.sha256
  ) {
    throw new Error("v2 subject hash mismatch");
  }
  const stopRules = {
    attempts: files.campaign.attempts,
    onboarding: files.campaign.onboarding,
    repair: files.campaign.repair,
  };
  if (
    files.campaign.stop_rules_sha256 !== sha256(stableJson(stopRules)) ||
    files.campaign.toolchain_sha256 !==
      sha256(stableJson(files.campaign.toolchain))
  ) {
    throw new Error("campaign stop-rule or toolchain binding mismatch");
  }
  for (const task of tasks) {
    const binding = await readJson(
      resolve(campaignRoot, "bindings", `${task.id}.json`),
    );
    const preflight = await readJson(
      resolve(campaignRoot, "prepared", task.id, "preflight.json"),
    );
    if (
      binding.task_contract_sha256 !== task.contract_sha256 ||
      binding.repository?.base_sha !== task.repository.base_sha ||
      binding.repository?.oracle_sha !== task.repository.oracle_sha ||
      binding.lockfile_sha256 !== preflight.lockfile_sha256 ||
      binding.prompt_sha256?.onboarding !== sha256(task.prompt.onboarding) ||
      binding.prompt_sha256?.repair !== sha256(task.prompt.repair) ||
      preflight.repository?.base_sha !== task.repository.base_sha ||
      preflight.repository?.oracle_sha !== task.repository.oracle_sha ||
      preflight.oracle_lockfile_sha256 !== binding.lockfile_sha256 ||
      stableJson(preflight.toolchain) !== stableJson(files.campaign.toolchain)
    ) {
      throw new Error(`${task.id}: frozen binding mismatch`);
    }
  }
  return { tasks, executionRoot };
}

async function verifyBeforeMutation(campaignRoot) {
  await verifyChecksums(campaignRoot);
}

export async function validateSmokeGate(campaignRoot, files) {
  const campaignSmoke = files.campaign.smoke;
  const stateSmoke = files.state.smoke;
  if (campaignSmoke?.status !== "passed" || stateSmoke?.status !== "passed") {
    throw new Error("campaign model smoke gate has not passed");
  }
  if (
    campaignSmoke.artifact !== stateSmoke.artifact ||
    campaignSmoke.sha256 !== stateSmoke.sha256 ||
    campaignSmoke.environment_artifact !== stateSmoke.environment_artifact ||
    campaignSmoke.environment_sha256 !== stateSmoke.environment_sha256
  ) {
    throw new Error("campaign and state smoke bindings do not match");
  }
  assertSafeRelativePath(campaignSmoke.artifact, "smoke.artifact");
  const artifact = resolve(campaignRoot, campaignSmoke.artifact);
  if (!(await exists(artifact))) throw new Error("smoke artifact is missing");
  if ((await fileSha256(artifact)) !== campaignSmoke.sha256) {
    throw new Error("smoke artifact hash mismatch");
  }
  assertSafeRelativePath(
    campaignSmoke.environment_artifact,
    "smoke.environment_artifact",
  );
  const environmentArtifact = resolve(
    campaignRoot,
    campaignSmoke.environment_artifact,
  );
  if (!(await exists(environmentArtifact))) {
    throw new Error("smoke environment artifact is missing");
  }
  if (
    (await fileSha256(environmentArtifact)) !== campaignSmoke.environment_sha256
  ) {
    throw new Error("smoke environment artifact hash mismatch");
  }
  const environment = await readJson(environmentArtifact);
  const passed = (value) => value?.status === "passed";
  const confinementBranches = [
    environment.confinement?.execution,
    environment.confinement?.review,
  ];
  const credentialBranches = [
    environment.credentials?.execution,
    environment.credentials?.review,
  ];
  const confinementValid = confinementBranches.every(
    (branch) =>
      ["enforced", "passed"].includes(branch?.restricted_token?.status) &&
      Array.isArray(branch?.coordinator_acl) &&
      branch.coordinator_acl.length > 0 &&
      branch.coordinator_acl.every(
        (launch) =>
          ["restored", "not-applicable"].includes(launch?.status) &&
          (launch.status === "not-applicable" ||
            /^[0-9a-f]{64}$/.test(launch?.restore_receipt_sha256)),
      ) &&
      ["passed", "not-applicable"].includes(branch?.windows_canary?.status),
  );
  const credentialsValid = credentialBranches.every(
    (branch) =>
      branch?.transport ===
        files.campaign.execution_assurance?.credential_transport &&
      branch?.content_env_absent === true &&
      /^[0-9a-f]{64}$/.test(branch?.config_path_sha256) &&
      (branch?.auth_path_sha256 === null ||
        /^[0-9a-f]{64}$/.test(branch?.auth_path_sha256)),
  );
  if (
    environment.assurance?.network_enforcement !==
      files.campaign.execution_assurance?.network_enforcement ||
    environment.assurance?.network_namespace !==
      files.campaign.execution_assurance?.network_namespace ||
    environment.assurance?.network_canaries !==
      files.campaign.execution_assurance?.network_canaries ||
    environment.assurance?.filesystem_enforcement !==
      files.campaign.execution_assurance?.filesystem_enforcement ||
    environment.assurance?.windows_confinement !==
      files.campaign.execution_assurance?.windows_confinement ||
    environment.assurance?.codex_sandbox_profile !==
      files.campaign.execution_assurance?.codex_sandbox_profile ||
    environment.assurance?.toolchain_shim_enforcement !==
      files.campaign.toolchain_shim_enforcement ||
    !confinementValid ||
    !passed(environment.network_namespace_canaries?.execution) ||
    !passed(environment.network_namespace_canaries?.review) ||
    !credentialsValid ||
    environment.instructions?.path !== "AGENTS.md" ||
    !/^[0-9a-f]{64}$/.test(environment.instructions?.sha256) ||
    !["present", "not-exercised-by-config-probe"].includes(
      environment.shell_wrapper?.receipt_status,
    ) ||
    !/^[0-9a-f]{64}$/.test(environment.shell_wrapper?.path_sha256) ||
    environment.shell_wrapper?.workspace_edit_runtime_sha256 !==
      files.campaign.workspace_edit_runtime_sha256 ||
    environment.workspace_edit_gateway?.status !== "passed" ||
    environment.workspace_edit_gateway?.runtime_sha256 !==
      files.campaign.workspace_edit_runtime_sha256 ||
    !/^[0-9a-f]{64}$/.test(
      environment.workspace_edit_gateway?.command_sha256,
    ) ||
    !/^[0-9a-f]{64}$/.test(environment.workspace_edit_gateway?.patch_sha256) ||
    !/^[0-9a-f]{64}$/.test(
      environment.workspace_edit_gateway?.receipt_sha256,
    ) ||
    (environment.shell_wrapper?.receipt_status === "present" &&
      !/^[0-9a-f]{64}$/.test(environment.shell_wrapper?.receipt_sha256))
  ) {
    throw new Error(
      "smoke environment artifact does not satisfy isolation gates",
    );
  }
  const summary = await readJson(artifact);
  if (summary.status !== "passed" || !Array.isArray(summary.results)) {
    throw new Error("smoke artifact does not record a passed model smoke");
  }
  const expected = new Map([
    ["execution", files.campaign.execution_model],
    ["review", files.campaign.review_model],
  ]);
  const roles = summary.results.map((result) => result.role);
  if (
    summary.results.length !== expected.size ||
    roles.some((role) => !expected.has(role)) ||
    new Set(roles).size !== expected.size ||
    summary.results.some(
      (result) =>
        result.status !== "passed" ||
        result.model !== expected.get(result.role) ||
        !Number.isInteger(result.response_count) ||
        result.response_count < 1 ||
        !Array.isArray(result.response_usage) ||
        result.response_usage.length !== result.response_count,
    )
  ) {
    throw new Error("smoke artifact does not bind both models and usage");
  }
  const probes = summary.skill_load_probes;
  const expectedProbeVersions = new Set(VERSIONS);
  if (
    !Array.isArray(probes) ||
    probes.length !== expectedProbeVersions.size ||
    new Set(probes.map((probe) => probe.version)).size !==
      expectedProbeVersions.size ||
    probes.some(
      (probe) =>
        !expectedProbeVersions.has(probe.version) ||
        probe.status !== "passed" ||
        probe.subject_sha256 !==
          files.campaign.subjects?.[probe.version]?.sha256 ||
        probe.runtime_path !== "/subject/self-evolution" ||
        probe.runtime_status !== "readable" ||
        probe.runtime_sha256 !==
          files.campaign.subjects?.[probe.version]?.sha256 ||
        typeof probe.entrypoint !== "string" ||
        probe.entrypoint.length === 0 ||
        probe.entrypoint_status !== "passed" ||
        !/^[0-9a-f]{64}$/.test(probe.entrypoint_stdout_sha256) ||
        !/^[0-9a-f]{64}$/.test(probe.entrypoint_stderr_sha256) ||
        probe.subject_write_status !== "blocked" ||
        !/^[0-9a-f]{64}$/.test(probe.subject_write_stdout_sha256) ||
        !/^[0-9a-f]{64}$/.test(probe.subject_write_stderr_sha256) ||
        typeof probe.loaded_skill_path !== "string" ||
        probe.loaded_skill_path.length === 0 ||
        !/[/\\]subject[/\\]self-evolution[/\\]SKILL\.md$/i.test(
          probe.loaded_skill_path,
        ) ||
        !/^[0-9a-f]{64}$/.test(probe.effective_config_sha256) ||
        !/^[0-9a-f]{64}$/.test(probe.effective_config_probe_sha256) ||
        !/^[0-9a-f]{64}$/.test(probe.probe_sha256),
    )
  ) {
    throw new Error(
      "smoke artifact does not bind exact v1/v2 skill-load probes",
    );
  }
  return summary;
}

function selectedTasks(tasks, options) {
  if (!options.task) return tasks;
  const wanted = new Set(String(options.task).split(","));
  const selected = tasks.filter((task) => wanted.has(task.id));
  if (selected.length !== wanted.size)
    throw new Error("--task contains an unknown task id");
  return selected;
}

function validatePrepareScope(tasks, options) {
  const diagnostic = options.diagnostic === true;
  if (options.task && !diagnostic) {
    throw new Error("--task is allowed only with explicit --diagnostic");
  }
  const taskIds = tasks.map((task) => task.id).sort();
  const formalIds = [...FORMAL_TASK_IDS].sort();
  if (!diagnostic && stableJson(taskIds) !== stableJson(formalIds)) {
    throw new Error(
      `formal prepare requires exactly the frozen task ids ${formalIds.join(", ")}`,
    );
  }
  return diagnostic;
}

async function runCampaignSmoke({
  campaignRoot,
  executionRoot,
  config,
  state,
  subjects,
}) {
  const executor = await loadExecutor();
  const smokeRoot = resolve(campaignRoot, "smoke");
  const smokeWorkspace = smokeWorkspacePath({
    campaignId: config.campaign_id,
    campaignRoot,
    executionRoot: dirname(executionRoot),
  });
  const smokeSource = resolve(
    campaignRoot,
    "prepared",
    config.tasks[0].id,
    "base",
  );
  if (resolve(executionRoot) !== resolve(config.execution_root)) {
    throw new Error("smoke execution root binding mismatch");
  }
  if (!(await exists(smokeWorkspace))) {
    await materializeExternalWorkspace(smokeSource, smokeWorkspace, {
      campaignRoot,
    });
  }
  const smokeInstructions = resolve(smokeWorkspace, "AGENTS.md");
  if (!(await exists(smokeInstructions))) {
    await writeFile(
      smokeInstructions,
      [
        "# External campaign smoke workspace",
        "",
        "Do not access paths outside this workspace. Do not use network tools.",
        "The smoke prompt must be answered without tool calls.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  try {
    const environment = await executor.prepareExecutionEnvironment({
      config,
      skillDir: subjects.v2.path,
      workspaceDir: smokeWorkspace,
      campaignRoot,
      outputDir: smokeRoot,
    });
    const environmentArtifact = resolve(smokeRoot, "environment.json");
    await writeJson(environmentArtifact, environment);
    await executor.smokeModels({
      config,
      skillDir: subjects.v2.path,
      workspaceDir: smokeWorkspace,
      outputDir: smokeRoot,
      campaignRoot,
    });
    const binding = {
      status: "passed",
      artifact: "smoke/smoke.json",
      sha256: await fileSha256(resolve(smokeRoot, "smoke.json")),
      environment_artifact: "smoke/environment.json",
      environment_sha256: await fileSha256(environmentArtifact),
    };
    config.smoke = binding;
    state.smoke = { ...binding };
  } catch (error) {
    const artifact = resolve(smokeRoot, "smoke.json");
    const binding = {
      status: "blocked",
      artifact: "smoke/smoke.json",
      sha256: (await exists(artifact)) ? await fileSha256(artifact) : null,
      environment_artifact: "smoke/environment.json",
      environment_sha256: (await exists(resolve(smokeRoot, "environment.json")))
        ? await fileSha256(resolve(smokeRoot, "environment.json"))
        : null,
      error: error instanceof Error ? error.message : String(error),
    };
    config.smoke = binding;
    state.smoke = { ...binding };
    throw error;
  } finally {
    await writeJson(resolve(campaignRoot, "campaign.json"), config);
    await saveState(campaignRoot, state);
  }
}

export function selectedUnits(
  schedule,
  sealed,
  options,
  { review = false } = {},
) {
  if (review && options.arm !== undefined) {
    throw new Error(
      "--arm is not supported for review; blind review requires both arms",
    );
  }
  let units = schedule.units;
  if (options.task !== undefined) {
    const wanted = new Set(String(options.task).split(","));
    const known = new Set(schedule.units.map((unit) => unit.task_id));
    if ([...wanted].some((taskId) => !known.has(taskId))) {
      throw new Error("--task contains an unknown task id");
    }
    units = units.filter((unit) => wanted.has(unit.task_id));
  }
  if (options.attempt !== undefined) {
    const attempt =
      typeof options.attempt === "number"
        ? options.attempt
        : /^[123]$/.test(String(options.attempt))
          ? Number(options.attempt)
          : Number.NaN;
    if (![1, 2, 3].includes(attempt)) {
      throw new Error("--attempt must be one of 1, 2, or 3");
    }
    units = units.filter((unit) => unit.attempt === attempt);
  }
  if (options.arm !== undefined) {
    if (!Object.hasOwn(sealed.mapping, options.arm)) {
      throw new Error("--arm contains an unknown opaque arm label");
    }
    units = units.filter((unit) => unit.blind_label === options.arm);
  }
  if (units.length === 0)
    throw new Error("campaign filters selected zero units");
  return units.map((unit) => ({
    ...unit,
    version: sealed.mapping[unit.blind_label],
  }));
}

export async function prepareCampaign({
  repositoryRoot,
  options,
  runtime = {},
}) {
  const context = await resolveCampaignContext({
    repositoryRoot,
    options,
    requireExisting: false,
  });
  const verifyRestrictedWsl =
    runtime.verifyRestrictedWslAvailability ?? verifyRestrictedWslAvailability;
  const prewarmWsl = runtime.prewarmRestrictedWsl ?? prewarmRestrictedWsl;
  const campaignId = options.campaign ?? makeCampaignId();
  const campaignRoot = resolve(context.campaignsRoot, campaignId);
  const executionRoot = executionCampaignRoot(campaignId, {
    campaignRoot,
    executionRoot: options.execution,
  });
  if (await exists(campaignRoot)) {
    if (!options.resume)
      throw new Error(`${campaignRoot} already exists; pass --resume`);
    await verifyBeforeMutation(campaignRoot);
    const files = await loadCampaignFiles(campaignRoot);
    const { tasks, executionRoot: boundExecutionRoot } =
      await validateCampaignBindings(campaignRoot, files, {
        repositoryRoot,
        options,
      });
    if (files.campaign.smoke?.status !== "blocked") {
      throw new Error(
        "prepare --resume is allowed only for a blocked smoke gate",
      );
    }
    if (tasks.length === 0)
      throw new Error("blocked campaign has no frozen tasks");
    const subjects = {
      v2: { path: resolve(campaignRoot, "subjects/v2/self-evolution") },
    };
    if (files.campaign.diagnostic !== true) {
      throw new Error(
        "formal blocked smoke campaigns are sealed; create a new campaign instead of resuming",
      );
    }
    await prewarmWsl({ distro: files.campaign.toolchain.distro });
    await verifyRestrictedWsl({
      distro: files.campaign.toolchain.distro,
      scratchRoot: dirname(boundExecutionRoot),
    });
    try {
      await runCampaignSmoke({
        campaignRoot,
        executionRoot: boundExecutionRoot,
        config: files.campaign,
        state: files.state,
        subjects,
      });
    } finally {
      await writeChecksums(campaignRoot, [], { allowMutation: true });
    }
    return { campaignId, campaignRoot, resumed: true };
  }
  const tasks = selectedTasks(
    await loadTaskSpecs(
      resolve(repositoryRoot, "maintainer/evals/external/tasks"),
    ),
    options,
  );
  const diagnostic = validatePrepareScope(tasks, options);
  await prewarmWsl({ distro: DEFAULT_CONFIG.toolchain.distro });
  await verifyRestrictedWsl({
    distro: DEFAULT_CONFIG.toolchain.distro,
    scratchRoot: dirname(executionRoot),
  });
  await mkdir(resolve(campaignRoot, "sealed"), { recursive: true });
  const config = {
    ...DEFAULT_CONFIG,
    created_at: new Date().toISOString(),
    campaign_id: campaignId,
    campaign_root: campaignRoot,
    diagnostic,
    repository_root_sha256: await repositoryRootSha256(repositoryRoot),
    execution_root: executionRoot,
    smoke: {
      status: "pending",
      artifact: "smoke/smoke.json",
      sha256: null,
      environment_artifact: "smoke/environment.json",
      environment_sha256: null,
    },
    tasks: [],
  };
  config.toolchain_sha256 = sha256(stableJson(config.toolchain));
  config.stop_rules_sha256 = sha256(
    stableJson({
      attempts: config.attempts,
      onboarding: config.onboarding,
      repair: config.repair,
    }),
  );
  for (const task of tasks) {
    const source = taskRoot(repositoryRoot, task.id);
    const target = resolve(campaignRoot, "contracts", task.id);
    await cp(source, target, { recursive: true, preserveTimestamps: true });
    const frozen = await hashTree(target);
    if (frozen.sha256 !== task.contract_sha256)
      throw new Error(`${task.id}: task contract changed while freezing`);
    config.tasks.push({ id: task.id, contract_sha256: frozen.sha256 });
  }
  const subjects = await freezeSubjects(repositoryRoot, campaignRoot);
  config.subjects = {
    v1: {
      sha256: subjects.v1.sha256,
      archive_ref: "legacy/v1/skill",
      archive_sha256: subjects.v1.archive_sha256,
      skill_sha256: subjects.v1.skill_sha256,
      source_commit_sha: subjects.v1.source_commit_sha,
    },
    v2: {
      sha256: subjects.v2.sha256,
      skill_tree_sha256: subjects.v2.skill_tree_sha256,
      bundle_sha256: subjects.v2.bundle_sha256,
    },
  };
  const schedule = createSchedule(
    tasks.map((task) => task.id),
    campaignId,
    randomBytes(32),
  );
  await writeJson(resolve(campaignRoot, "campaign.json"), config);
  await writeJson(resolve(campaignRoot, "schedule.json"), schedule.public);
  await writeJson(
    resolve(campaignRoot, "sealed/arm-mapping.json"),
    schedule.sealed,
  );
  const state = initialState(schedule.public);
  state.repository_root_sha256 = config.repository_root_sha256;
  state.execution_root = config.execution_root;
  state.campaign_root = config.campaign_root;
  state.smoke = { ...config.smoke };
  await saveState(campaignRoot, state);
  const cacheRoot = resolve(context.campaignsRoot, ".cache", "repositories");
  for (const task of tasks) {
    const preflight = await prepareTask({
      task,
      taskRoot: taskRoot(repositoryRoot, task.id),
      campaignRoot,
      cacheRoot,
    });
    await writeTaskBinding(campaignRoot, task, preflight);
  }
  try {
    await runCampaignSmoke({
      campaignRoot,
      executionRoot,
      config,
      state,
      subjects,
    });
  } catch (error) {
    await writeChecksums(campaignRoot, [], { allowInitial: true });
    throw error;
  }
  await writeChecksums(campaignRoot, [], { allowInitial: true });
  return { campaignId, campaignRoot, resumed: false };
}

export async function runUnit({
  repositoryRoot,
  campaignRoot,
  campaign,
  state,
  unit,
  task,
  executor,
  executionRoot = null,
}) {
  const unitState = state.units[unit.id];
  const unitRoot = resolve(
    campaignRoot,
    "runs",
    unit.task_id,
    String(unit.attempt),
    unit.blind_label,
  );
  if (unitState.phases.verification.status === "completed") return "skipped";
  const sealedPhase = PHASE_ORDER.find((phase) =>
    ["running", "failed", "blocked"].includes(unitState.phases[phase].status),
  );
  if (sealedPhase) return "sealed";
  const onboardingComplete = unitState.phases.onboarding.status === "completed";
  const workspaceDir = unitWorkspacePath({
    campaignId: campaign.campaign_id,
    taskId: task.id,
    unit,
    campaignRoot,
    executionRoot: dirname(executionRoot ?? campaign.execution_root),
  });
  if (!onboardingComplete) {
    try {
      await createUnitWorkspace({
        taskId: task.id,
        unit,
        campaignRoot,
        workspaceDir,
      });
    } catch (error) {
      transitionState(state, { unit: unit.id, phase: "onboarding" }, "failed", {
        reason: "workspace-materialization-failed",
      });
      await writeJson(resolve(unitRoot, "run.json"), {
        schema_version: "1.0",
        campaign_id: campaign.campaign_id,
        task_id: unit.task_id,
        attempt: unit.attempt,
        blind_label: unit.blind_label,
        status: "failed",
        failure: {
          phase: "workspace",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      await checkpointState(campaignRoot, state);
      return "failed";
    }
  } else if (!(await exists(workspaceDir))) {
    throw new Error(`${unit.id}: completed onboarding workspace is missing`);
  }
  const installDir = resolve(unitRoot, "install");
  if (!onboardingComplete) {
    try {
      await installUnitWorkspace({ task, workspaceDir, outputDir: installDir });
    } catch (error) {
      transitionState(state, { unit: unit.id, phase: "onboarding" }, "failed", {
        reason: "unit-install-failed",
      });
      await writeJson(resolve(unitRoot, "run.json"), {
        schema_version: "1.0",
        campaign_id: campaign.campaign_id,
        task_id: unit.task_id,
        attempt: unit.attempt,
        blind_label: unit.blind_label,
        status: "failed",
        failure: {
          phase: "install",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      await checkpointState(campaignRoot, state);
      return "failed";
    }
  }
  const skillDir = resolve(
    campaignRoot,
    "subjects",
    unit.version,
    "self-evolution",
  );
  let onboardingEvidence = null;
  let repairEvidence = null;
  let onboardingWorkspacePostManifestSha256 = null;
  if (onboardingComplete) {
    const priorOnboardingPath = resolve(unitRoot, "onboarding/evidence.json");
    const priorOnboarding = (await exists(priorOnboardingPath))
      ? await readJson(priorOnboardingPath)
      : null;
    onboardingWorkspacePostManifestSha256 =
      priorOnboarding?.workspace_manifest?.post?.manifest_sha256 ?? null;
    if (priorOnboarding && !onboardingWorkspacePostManifestSha256) {
      throw new Error(
        `${unit.id}: completed onboarding has no bound workspace post-manifest`,
      );
    }
    onboardingEvidence = priorOnboarding;
  }
  const writeRun = async ({ status, failure = null, verification = null }) => {
    const metric = (evidence) => {
      if (!evidence) return null;
      const usage = evidence.usage?.value;
      return {
        usage_status: evidence.usage?.status ?? "not-measured",
        input_tokens: usage?.input_tokens ?? null,
        output_tokens: usage?.output_tokens ?? null,
        duration_ms: evidence.execution?.duration_ms ?? null,
        selected_context_bytes: Array.isArray(evidence.selected_context)
          ? evidence.selected_context.reduce(
              (total, item) =>
                total + (Number.isInteger(item.bytes) ? item.bytes : 0),
              0,
            )
          : null,
        knowledge_bytes: Array.isArray(evidence.knowledge_diff)
          ? evidence.knowledge_diff.reduce(
              (total, item) =>
                total +
                (item.change !== "removed" && Number.isInteger(item.bytes)
                  ? item.bytes
                  : 0),
              0,
            )
          : null,
        capture_items: Array.isArray(evidence.capture)
          ? evidence.capture.length
          : null,
      };
    };
    const executionBinding = (evidence) => {
      if (!evidence) return null;
      return {
        subject_sha256: evidence.skill_load?.subject_sha256 ?? null,
        loaded_skill_path: evidence.skill_load?.loaded_skill_path ?? null,
        skill_load_probe_sha256: evidence.skill_load?.probe_sha256 ?? null,
        effective_config_sha256: evidence.effective_config?.sha256 ?? null,
        effective_config_probe_sha256:
          evidence.effective_config?.resolved_probe_sha256 ?? null,
        toolchain_shim_sha256: evidence.toolchain_shims?.sha256 ?? null,
        toolchain_shim_enforcement:
          evidence.toolchain_shims?.enforcement ?? null,
        toolchain_sha256: evidence.toolchain_shims?.toolchain
          ? sha256(stableJson(evidence.toolchain_shims.toolchain))
          : null,
        workspace_final_state_binding_sha256:
          evidence.workspace_manifest?.final_state_binding_sha256 ?? null,
        workspace_post_manifest_sha256:
          evidence.workspace_manifest?.post?.manifest_sha256 ?? null,
        session_chain_sha256: evidence.session_chain
          ? sha256(stableJson(evidence.session_chain))
          : null,
        confinement_sha256: evidence.confinement
          ? sha256(stableJson(evidence.confinement))
          : null,
        credentials_sha256: evidence.credentials
          ? sha256(stableJson(evidence.credentials))
          : null,
        instructions_sha256: evidence.instructions
          ? sha256(stableJson(evidence.instructions))
          : null,
        shell_wrapper_sha256: evidence.shell_wrapper
          ? sha256(stableJson(evidence.shell_wrapper))
          : null,
      };
    };
    const verificationBinding = async () => {
      if (!verification) return null;
      const verificationPath = resolve(
        unitRoot,
        "verification/verification.json",
      );
      return {
        verification_artifact_sha256: (await exists(verificationPath))
          ? await fileSha256(verificationPath)
          : null,
        artifact_binding_sha256:
          verification.artifact_bindings?.binding_sha256 ?? null,
        patch_binding_sha256: verification.patch_binding_sha256 ?? null,
      };
    };
    await writeJson(resolve(unitRoot, "run.json"), {
      schema_version: "1.0",
      campaign_id: campaign.campaign_id,
      task_id: unit.task_id,
      attempt: unit.attempt,
      blind_label: unit.blind_label,
      status,
      failure,
      metrics: {
        onboarding: metric(onboardingEvidence),
        repair: metric(repairEvidence),
      },
      execution_bindings: {
        onboarding: executionBinding(onboardingEvidence),
        repair: executionBinding(repairEvidence),
        verification: await verificationBinding(),
      },
      verification,
    });
  };
  const failPhase = async (phase, reason, error, verification = null) => {
    const outputDir = resolve(unitRoot, phase);
    await mkdir(outputDir, { recursive: true });
    const message = error instanceof Error ? error.message : String(error);
    const resultPath = resolve(outputDir, "result.json");
    if (!(await exists(resultPath))) {
      await writeJson(resultPath, {
        schema_version: "1.0",
        campaign_id: campaign.campaign_id,
        task_id: unit.task_id,
        attempt: unit.attempt,
        blind_label: unit.blind_label,
        phase,
        model: campaign.execution_model,
        status: "failed",
        exit_code: 1,
        started_at: null,
        finished_at: new Date().toISOString(),
        duration_ms: null,
        timed_out: false,
        tool_budget_exceeded: false,
        usage_status: "not-measured",
        usage: [],
        final: null,
        provider_error_count: 1,
        termination_reason: reason,
        error: message,
      });
    }
    if (phase !== "verification") {
      const prompt =
        phase === "onboarding" ? task.prompt.onboarding : task.prompt.repair;
      const gateway = workspaceEditPhasePolicy(phase, outputDir);
      const fallbackFiles = [
        ["prompt.txt", prompt],
        ["opencode.jsonl", ""],
        ["stderr.txt", `${message}\n`],
      ];
      for (const [name, content] of fallbackFiles) {
        const path = resolve(outputDir, name);
        if (!(await exists(path))) await writeFile(path, content, "utf8");
      }
      const preKnowledgePath = resolve(outputDir, "knowledge.pre.json");
      if (!(await exists(preKnowledgePath)))
        await writeJson(preKnowledgePath, []);
      try {
        const evidence = await executor.collectRunEvidence({
          campaign,
          unit,
          phase,
          workspaceDir,
          outputDir,
          verification,
          gatewayReceiptDir: gateway.receipt_dir,
          gatewayCommand: gateway.command,
        });
        if (phase === "onboarding") onboardingEvidence = evidence;
        else repairEvidence = evidence;
      } catch (collectionError) {
        await writeJson(resolve(outputDir, "collection-failure.json"), {
          schema_version: "1.0",
          reason: "evidence-collection-failed",
          message:
            collectionError instanceof Error
              ? collectionError.message
              : String(collectionError),
        });
      }
    }
    transitionState(state, { unit: unit.id, phase }, "failed", {
      reason,
      error: message,
    });
    await writeRun({
      status: "failed",
      failure: { phase, reason, message },
      verification,
    });
    await checkpointState(campaignRoot, state);
    return "failed";
  };
  const pendingModelPhase = ["onboarding", "repair"].find(
    (phase) => unitState.phases[phase].status === "pending",
  );
  try {
    if (pendingModelPhase) {
      await executor.prepareExecutionEnvironment({
        config: campaign,
        skillDir,
        workspaceDir,
        campaignRoot,
        outputDir: resolve(unitRoot, "environment"),
      });
    }
  } catch (error) {
    transitionState(
      state,
      { unit: unit.id, phase: pendingModelPhase },
      "running",
    );
    await checkpointState(campaignRoot, state);
    return failPhase(pendingModelPhase, "execution-environment-failed", error);
  }
  for (const phase of ["onboarding", "repair"]) {
    const phaseState = unitState.phases[phase];
    if (phaseState.status === "completed") continue;
    transitionState(state, { unit: unit.id, phase }, "running");
    await checkpointState(campaignRoot, state);
    const outputDir = resolve(unitRoot, phase);
    await mkdir(outputDir, { recursive: true });
    const prompt =
      phase === "onboarding" ? task.prompt.onboarding : task.prompt.repair;
    const gateway = workspaceEditPhasePolicy(phase, outputDir);
    if (phase === "repair") {
      const currentWorkspace = await collectWorkspaceManifest(workspaceDir);
      if (
        onboardingWorkspacePostManifestSha256 &&
        currentWorkspace.manifest_sha256 !==
          onboardingWorkspacePostManifestSha256
      ) {
        return failPhase(
          phase,
          "onboarding-repair-workspace-chain-mismatch",
          new Error(
            `${unit.id}: workspace bytes changed after onboarding and before repair`,
          ),
        );
      }
    }
    let result;
    let evidence;
    try {
      result = await executor.runPhase({
        campaign,
        campaignRoot,
        unit,
        task,
        phase,
        workspaceDir,
        skillDir,
        outputDir,
        prompt,
        workspaceEdit: gateway,
        expectedWorkspacePreManifestSha256:
          phase === "repair" ? onboardingWorkspacePostManifestSha256 : null,
      });
      evidence = await executor.collectRunEvidence({
        campaign,
        unit,
        phase,
        workspaceDir,
        outputDir,
        gatewayReceiptDir: gateway.receipt_dir,
        gatewayCommand: gateway.command,
      });
    } catch (error) {
      return failPhase(phase, "phase-execution-exception", error);
    }
    const completed = result?.status === "completed" && result?.exit_code === 0;
    if (phase === "onboarding") onboardingEvidence = evidence;
    else repairEvidence = evidence;
    if (!completed) {
      transitionState(state, { unit: unit.id, phase }, "failed", {
        result: resolve(outputDir, "result.json"),
        reason:
          "model execution failed; retry is disabled after first response",
      });
      await writeRun({
        status: "failed",
        failure: { phase, reason: "model-execution-failed" },
      });
      await checkpointState(campaignRoot, state);
      return "failed";
    }
    const workspaceEdit = validateWorkspaceEditEvidence(evidence, phase);
    if (!workspaceEdit.valid) {
      transitionState(state, { unit: unit.id, phase }, "failed", {
        reason: `workspace edit receipt violation: ${workspaceEdit.violations.join(", ")}`,
      });
      await writeRun({
        status: "failed",
        failure: {
          phase,
          reason: "workspace-edit-receipt-violation",
          violations: workspaceEdit.violations,
        },
      });
      await checkpointState(campaignRoot, state);
      return "failed";
    }
    if (phase === "onboarding") {
      const onboarding = validateOnboardingEvidence(evidence);
      if (!onboarding.valid) {
        transitionState(state, { unit: unit.id, phase }, "failed", {
          reason: `onboarding allowlist violation: ${onboarding.violations.join(", ")}`,
        });
        await writeRun({
          status: "failed",
          failure: {
            phase,
            reason: "onboarding-allowlist-violation",
            violations: onboarding.violations,
          },
        });
        await checkpointState(campaignRoot, state);
        return "failed";
      }
      onboardingWorkspacePostManifestSha256 =
        evidence.workspace_manifest?.post?.manifest_sha256 ?? null;
      if (!onboardingWorkspacePostManifestSha256) {
        transitionState(state, { unit: unit.id, phase }, "failed", {
          reason: "onboarding workspace post-manifest is missing",
        });
        await writeRun({
          status: "failed",
          failure: {
            phase,
            reason: "onboarding-workspace-post-manifest-missing",
          },
        });
        await checkpointState(campaignRoot, state);
        return "failed";
      }
    }
    transitionState(state, { unit: unit.id, phase }, "completed", {
      result: resolve(outputDir, "result.json"),
    });
    await checkpointState(campaignRoot, state);
  }
  transitionState(state, { unit: unit.id, phase: "verification" }, "running");
  await checkpointState(campaignRoot, state);
  let verification;
  try {
    verification = await verifyRepairedWorkspace({
      task,
      unit,
      taskRoot: task.contract_root,
      workspaceDir,
      outputDir: resolve(unitRoot, "verification"),
    });
    repairEvidence = await executor.collectRunEvidence({
      campaign,
      unit,
      phase: "repair",
      workspaceDir,
      outputDir: resolve(unitRoot, "repair"),
      verification,
      gatewayReceiptDir: workspaceEditPhasePolicy(
        "repair",
        resolve(unitRoot, "repair"),
      ).receipt_dir,
      gatewayCommand: WORKSPACE_EDIT_GATEWAY_COMMAND,
    });
  } catch (error) {
    return failPhase("verification", "verification-exception", error);
  }
  if (
    repairEvidence?.path_escape_detected ||
    repairEvidence?.network_violation_detected
  ) {
    transitionState(state, { unit: unit.id, phase: "verification" }, "failed", {
      reason: repairEvidence?.path_escape_detected
        ? "execution accessed an out-of-bounds path"
        : "execution attempted a forbidden network command",
    });
    await writeRun({
      status: "failed",
      failure: {
        phase: "verification",
        reason: repairEvidence?.path_escape_detected
          ? "path-escape"
          : "network-access",
      },
      verification,
    });
    await checkpointState(campaignRoot, state);
    return "failed";
  }
  await writeRun({ status: "completed", verification });
  transitionState(
    state,
    { unit: unit.id, phase: "verification" },
    "completed",
    {
      hard_correct:
        verification.hidden_tests === "pass" &&
        verification.full_suite === "pass" &&
        verification.regression_safety === "pass",
    },
  );
  await checkpointState(campaignRoot, state);
  return "completed";
}

export async function runCampaign({ repositoryRoot, options }) {
  const { campaignRoot } = await resolveCampaignContext({
    repositoryRoot,
    options,
  });
  await verifyBeforeMutation(campaignRoot);
  const files = await loadCampaignFiles(campaignRoot);
  const { tasks, executionRoot } = await validateCampaignBindings(
    campaignRoot,
    files,
    { repositoryRoot, options },
  );
  await validateSmokeGate(campaignRoot, files);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const executor = await loadExecutor();
  const units = selectedUnits(files.schedule, files.sealed, options);
  for (const unit of units) {
    const task = taskById.get(unit.task_id);
    if (!task) throw new Error(`campaign task ${unit.task_id} is unavailable`);
    await runUnit({
      repositoryRoot,
      campaignRoot,
      campaign: files.campaign,
      state: files.state,
      unit,
      task,
      executor,
      executionRoot,
    });
  }
  await writeChecksums(campaignRoot, [], { allowMutation: true });
  return { campaignRoot, units: units.length };
}

function pairKey(unit) {
  return `${unit.task_id}-${unit.attempt}`;
}

export function isReviewSchemaError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^(?:reviewer|verdict(?:\.|:)|Unexpected token|Expected property name|Unterminated string|Bad control character|Unexpected end of JSON input)/i.test(
      message,
    ) || message.includes("JSON object")
  );
}

export async function reviewCampaign({ repositoryRoot, options }) {
  const { campaignRoot } = await resolveCampaignContext({
    repositoryRoot,
    options,
  });
  await verifyBeforeMutation(campaignRoot);
  const files = await loadCampaignFiles(campaignRoot);
  const { executionRoot } = await validateCampaignBindings(
    campaignRoot,
    files,
    { repositoryRoot, options },
  );
  await validateSmokeGate(campaignRoot, files);
  const executor = await loadExecutor();
  const units = selectedUnits(files.schedule, files.sealed, options, {
    review: true,
  });
  const pairs = new Map();
  for (const unit of units) {
    const key = pairKey(unit);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(unit);
  }
  for (const [key, pair] of pairs) {
    if (
      pair.length !== 2 ||
      new Set(pair.map((unit) => unit.version)).size !== 2
    ) {
      throw new Error(`${key}: expected one v1 and one v2 unit`);
    }
    const reviewState = files.state.reviews[key];
    if (reviewState.status === "completed") continue;
    for (const unit of pair) {
      if (!isTerminalUnitState(files.state.units[unit.id]))
        throw new Error(
          `${key}: both arms must reach a sealed terminal state before review`,
        );
    }
    transitionState(files.state, { pair: key }, "running");
    await checkpointState(campaignRoot, files.state);
    const outputDir = resolve(
      campaignRoot,
      "blind",
      pair[0].task_id,
      String(pair[0].attempt),
    );
    await mkdir(outputDir, { recursive: true });
    const reviewWorkspace = reviewWorkspacePath({
      campaignId: files.campaign.campaign_id,
      taskId: pair[0].task_id,
      attempt: pair[0].attempt,
      campaignRoot,
      executionRoot: dirname(executionRoot ?? files.campaign.execution_root),
    });
    const bundle = await executor.createBlindBundle({
      campaignDir: campaignRoot,
      pair,
      outputDir,
      subjectRedactions: files.campaign.subjects,
    });
    const bundlePath = bundle?.path ?? resolve(outputDir, "bundle.json");
    await assertNoVersionLeak(bundlePath, files.campaign.subjects);
    if (!(await exists(reviewWorkspace))) {
      await materializeExternalWorkspace(outputDir, reviewWorkspace, {
        campaignRoot,
      });
    }
    const externalBundlePath = resolve(reviewWorkspace, "bundle.json");
    let verdict;
    try {
      verdict = await executor.runBlindReview({
        campaign: files.campaign,
        bundlePath: externalBundlePath,
        outputDir,
        campaignRoot,
      });
      const sorted = [...pair].sort((left, right) =>
        left.blind_label.localeCompare(right.blind_label, "en"),
      );
      const boundVerdict = {
        ...verdict,
        schema_version: "1.0",
        task_id: pair[0].task_id,
        attempt: pair[0].attempt,
        arms: {
          A: sorted[0].blind_label,
          B: sorted[1].blind_label,
        },
      };
      validateVerdict(boundVerdict, pair);
      verdict = boundVerdict;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const schemaInvalid = isReviewSchemaError(error);
      if (schemaInvalid) {
        markReviewSchemaInvalid(files.state, key, {
          reason: message,
          retry_allowed_before_reveal: true,
        });
      } else {
        transitionState(files.state, { pair: key }, "failed", {
          error_category: "execution-failure",
          reason: message,
        });
      }
      await checkpointState(campaignRoot, files.state);
      throw error;
    }
    const boundVerdict = verdict;
    await writeJson(resolve(outputDir, "verdict.json"), boundVerdict);
    const valid = true;
    transitionState(
      files.state,
      { pair: key },
      valid ? "completed" : "failed",
      { verdict: resolve(outputDir, "verdict.json") },
    );
    await checkpointState(campaignRoot, files.state);
    if (!valid) throw new Error(`${key}: reviewer returned an invalid verdict`);
  }
  const allVerdicts = await collectJsonArtifacts(
    resolve(campaignRoot, "blind"),
    "verdict.json",
  );
  if (allVerdicts.length === files.state.review_seal.expected) {
    sealReviews(
      files.state,
      allVerdicts.map((item) => ({ ...item.value, sha256: item.sha256 })),
    );
    await writeJson(resolve(campaignRoot, "blind/verdict-seal.json"), {
      schema_version: "1.0",
      campaign_id: files.campaign.campaign_id,
      expected: files.state.review_seal.expected,
      verdicts_sha256: files.state.review_seal.verdicts_sha256,
      sealed_at: files.state.review_seal.sealed_at,
    });
    await checkpointState(campaignRoot, files.state);
  }
  await writeChecksums(campaignRoot, [], { allowMutation: true });
  return { campaignRoot, pairs: pairs.size };
}

async function loadEvidenceArtifact(campaignRoot, path) {
  const artifactPath = relative(campaignRoot, path).replaceAll("\\", "/");
  if (!(await exists(path))) {
    return { status: "missing", path: artifactPath, sha256: null, value: null };
  }
  const sha256 = await fileSha256(path);
  try {
    return {
      status: "loaded",
      path: artifactPath,
      sha256,
      value: await readJson(path),
    };
  } catch {
    return { status: "malformed", path: artifactPath, sha256, value: null };
  }
}

async function loadOpaqueArtifact(campaignRoot, path) {
  const artifactPath = relative(campaignRoot, path).replaceAll("\\", "/");
  if (!(await exists(path))) {
    return { status: "missing", path: artifactPath, sha256: null };
  }
  return {
    status: "loaded",
    path: artifactPath,
    sha256: await fileSha256(path),
  };
}

async function collectRunArtifacts(campaignRoot) {
  const root = resolve(campaignRoot, "runs");
  const values = [];
  if (!(await exists(root))) return values;
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === "run.json") {
        const run = await readJson(path);
        values.push({
          ...run,
          raw_evidence: {
            onboarding: await loadEvidenceArtifact(
              campaignRoot,
              resolve(current, "onboarding/evidence.json"),
            ),
            repair: await loadEvidenceArtifact(
              campaignRoot,
              resolve(current, "repair/evidence.json"),
            ),
          },
          raw_verification: {
            verification: await loadEvidenceArtifact(
              campaignRoot,
              resolve(current, "verification/verification.json"),
            ),
            ...Object.fromEntries(
              await Promise.all(
                Object.entries(VERIFICATION_ARTIFACTS).map(
                  async ([name, filename]) => [
                    name,
                    await loadEvidenceArtifact(
                      campaignRoot,
                      resolve(current, "verification", filename),
                    ),
                  ],
                ),
              ),
            ),
            patch: await loadOpaqueArtifact(
              campaignRoot,
              resolve(current, "verification/patch.diff"),
            ),
            changed_paths: await loadOpaqueArtifact(
              campaignRoot,
              resolve(current, "verification/changed-paths.txt"),
            ),
          },
        });
      }
    }
  }
  await visit(root);
  return values;
}

async function collectJsonArtifacts(root, filename) {
  const artifacts = [];
  if (!(await exists(root))) return artifacts;
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === filename)
        artifacts.push({
          path,
          sha256: await fileSha256(path),
          value: await readJson(path),
        });
    }
  }
  await visit(root);
  return artifacts;
}

function scheduledPairs(schedule) {
  const pairs = new Map();
  for (const unit of schedule.units) {
    const key = `${unit.task_id}:${unit.attempt}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(unit);
  }
  return pairs;
}

export function expectedRunBindings(files, run, phase) {
  const version = files.sealed.mapping?.[run.blind_label];
  if (!VERSIONS.includes(version)) return null;
  return {
    subject_sha256: files.campaign.subjects?.[version]?.sha256 ?? null,
    toolchain: files.campaign.toolchain,
    toolchain_shim_enforcement: files.campaign.toolchain_shim_enforcement,
    workspace_edit_runtime_sha256: files.campaign.workspace_edit_runtime_sha256,
    assurance: files.campaign.execution_assurance,
    phase,
  };
}

function validateRunEvidence(files, run) {
  if (
    run.schema_version !== "1.0" ||
    typeof run.campaign_id !== "string" ||
    !["completed", "failed"].includes(run.status)
  ) {
    throw new Error(
      `${run.task_id ?? "unknown"}:${run.attempt ?? "?"}:${run.blind_label ?? "unknown"}: run artifact is invalid`,
    );
  }
  const phases =
    run.status === "completed" ||
    ["repair", "verification"].includes(run.failure?.phase)
      ? ["onboarding", "repair"]
      : run.failure?.phase === "onboarding"
        ? ["onboarding"]
        : [];
  if (phases.length === 0) {
    throw new Error(
      `${run.task_id}:${run.attempt}:${run.blind_label}: failed run does not identify an evidentiary phase`,
    );
  }
  for (const phase of phases) {
    const binding = evidencePhase(run, phase, {
      strict: true,
      expectedBindings: expectedRunBindings(files, run, phase),
    }).binding;
    if (
      binding.status !== "verified" ||
      binding.metrics_cache_status !== "match"
    ) {
      throw new Error(
        `${run.task_id}:${run.attempt}:${run.blind_label}: ${phase} raw evidence is ${binding.status} (${binding.metrics_cache_status})`,
      );
    }
  }
  if (run.verification) {
    const binding = verificationEvidence(run, { strict: true });
    if (binding.status !== "verified") {
      throw new Error(
        `${run.task_id}:${run.attempt}:${run.blind_label}: verification evidence is ${binding.status}`,
      );
    }
  }
}

export async function validateFormalCampaignArtifacts({
  campaignRoot,
  files,
  runs,
  verdictArtifacts,
}) {
  await validateSmokeGate(campaignRoot, files);
  const pairs = scheduledPairs(files.schedule);
  for (const item of verdictArtifacts) {
    const key = `${item.value?.task_id}:${item.value?.attempt}`;
    const pair = pairs.get(key);
    if (!pair) throw new Error(`${key}: verdict does not match the schedule`);
    validateVerdict(item.value, pair);
    validateVerdictAgainstRuns(item.value, runs);
  }
  if (files.state.review_seal?.status !== "sealed") {
    throw new Error("blind verdict set is not sealed");
  }
  const digest = reviewSealDigest(
    verdictArtifacts.map((item) => ({
      ...item.value,
      sha256: item.sha256,
    })),
  );
  const sealPath = resolve(campaignRoot, "blind/verdict-seal.json");
  if (!(await exists(sealPath)))
    throw new Error("blind verdict seal artifact is missing");
  const seal = await readJson(sealPath);
  if (
    seal.schema_version !== "1.0" ||
    seal.campaign_id !== files.campaign.campaign_id ||
    seal.expected !== files.state.review_seal.expected ||
    seal.verdicts_sha256 !== files.state.review_seal.verdicts_sha256 ||
    seal.sealed_at !== files.state.review_seal.sealed_at ||
    verdictArtifacts.length !== files.state.review_seal.expected ||
    digest !== files.state.review_seal.verdicts_sha256
  ) {
    throw new Error("blind verdict seal artifact does not match state");
  }
  for (const run of runs) {
    if (run.campaign_id !== files.campaign.campaign_id) {
      throw new Error(
        `${run.task_id}: run campaign_id does not match campaign`,
      );
    }
    validateRunEvidence(files, run);
  }
  return { seal, digest };
}

export async function verifyCampaign({ repositoryRoot, options }) {
  const { campaignRoot } = await resolveCampaignContext({
    repositoryRoot,
    options,
  });
  const files = await loadCampaignFiles(campaignRoot);
  await validateCampaignBindings(campaignRoot, files, {
    repositoryRoot,
    options,
  });
  const verdicts = await collectJsonArtifacts(
    resolve(campaignRoot, "blind"),
    "verdict.json",
  );
  const checked = await verifyChecksums(campaignRoot);
  const runs = await collectRunArtifacts(campaignRoot);
  await validateFormalCampaignArtifacts({
    campaignRoot,
    files,
    runs,
    verdictArtifacts: verdicts,
  });
  const completion = campaignGateStatus({
    campaign: files.campaign,
    schedule: files.schedule,
    state: files.state,
    runs,
    verdicts: verdicts.map((item) => item.value),
    strictEvidence: true,
    expectedBindingsForRun: (run, phase) =>
      expectedRunBindings(files, run, phase),
  });
  return {
    campaignRoot,
    checked,
    completion_status: completion.completion_status,
    complete: completion.complete,
    reasons: completion.reasons,
    gates: {
      checksums: { status: "passed", artifacts: checked },
      ...completion.gates,
    },
  };
}

function metricText(metric) {
  if (metric?.status !== "measured") {
    const coverage =
      Number.isInteger(metric?.measured_runs) &&
      Number.isInteger(metric?.expected_runs)
        ? `not-measured (${metric.measured_runs}/${metric.expected_runs})`
        : "not-measured";
    return coverage;
  }
  return `${metric.value} ${metric.unit}`;
}

export function reportMarkdown(summary, campaign) {
  const lines = [
    `# self-evolution v1/v2 真实任务对照实验`,
    "",
    `Campaign: \`${campaign.campaign_id}\``,
    "",
    `结论：**${summary.winner === "no-clear-winner" ? "无明确胜者" : summary.winner}**。`,
    `判定依据：${summary.basis}。`,
    "",
    `本实验不写入正式 integrated gates，也不改变 release_ready。`,
    "",
    "| 版本 | 通过任务 | 正确运行 | 严重回归 | 盲审胜/负/平 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const version of VERSIONS) {
    const item = summary.versions[version];
    lines.push(
      `| ${version} | ${item.task_passes}/${campaign.tasks.length} | ${item.correct_runs}/${campaign.tasks.length * 3} | ${item.severe_regressions} | ${item.review_wins}/${item.review_losses}/${item.review_ties} |`,
    );
  }
  lines.push("", "## 逐任务结果", "");
  for (const task of campaign.tasks) {
    lines.push(`### ${task.id}`, "");
    lines.push(
      "| 版本 | 正确次数 | 任务通过 | 严重回归 |",
      "|---|---:|---:|---:|",
    );
    for (const version of VERSIONS) {
      const item = summary.versions[version].tasks[task.id];
      lines.push(
        `| ${version} | ${item.correct}/3 | ${item.passed ? "yes" : "no"} | ${item.severe_regressions} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## 效率字段",
    "",
    "效率仅在正确性、安全性和盲审质量不退化时作为后续依据。当前不可测值保留为 `not-measured`，不会写成 0。",
    "",
    "| 版本 | Onboarding tokens | Total tokens | 耗时 | Selected context | 知识写入 | Capture items | 低价值 Capture |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const version of VERSIONS) {
    const metrics = summary.versions[version].efficiency;
    lines.push(
      `| ${version} | ${metricText(metrics.onboarding_tokens)} | ${metricText(metrics.total_tokens)} | ${metricText(metrics.duration_ms)} | ${metricText(metrics.selected_context_bytes)} | ${metricText(metrics.knowledge_bytes)} | ${metricText(metrics.capture_items)} | ${metricText(metrics.low_value_captures)} |`,
    );
  }
  lines.push(
    "",
    "`knowledge_bytes` 是 onboarding 与 repair 两阶段新增或改写的知识文件内容字节总和；`capture_items` 是两阶段 Capture diff 项数。低价值 Capture 只在盲审逐项标签完整且无 `unresolved` 时计数。",
    "",
    "效率字段从每阶段原始 `evidence.json` 重新派生；报告记录其 SHA-256。`run.json.metrics` 仅作为缓存互检，不作为统计来源。",
    "",
    "| 版本 | 已验证原始证据 | 缺失 | 无效 | 缓存不一致 |",
    "|---|---:|---:|---:|---:|",
  );
  for (const version of VERSIONS) {
    const evidence = summary.versions[version].evidence;
    lines.push(
      `| ${version} | ${evidence.verified_phase_artifacts}/${evidence.expected_phase_artifacts} | ${evidence.missing_phase_artifacts} | ${evidence.invalid_phase_artifacts} | ${evidence.metrics_cache_mismatches} |`,
    );
  }
  lines.push(
    "",
    "## 盲审记录",
    "",
    "| 任务 | 重复 | Verdict | 揭盲结果 | SHA-256 |",
    "|---|---:|---|---|---|",
  );
  for (const review of summary.blind_reviews) {
    const verdict = review.verdict_path
      ? `[verdict](${review.verdict_path})`
      : "not-measured";
    lines.push(
      `| ${review.task_id} | ${review.attempt} | ${verdict} | ${review.winner_version} | ${review.verdict_sha256 ?? "not-measured"} |`,
    );
  }
  lines.push(
    "",
    `Evidence complete: **${summary.complete ? "yes" : "no"}**`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

export async function reportCampaign({ repositoryRoot, options }) {
  const { campaignRoot } = await resolveCampaignContext({
    repositoryRoot,
    options,
  });
  await verifyBeforeMutation(campaignRoot);
  const files = await loadCampaignFiles(campaignRoot);
  await validateCampaignBindings(campaignRoot, files, {
    repositoryRoot,
    options,
  });
  if (files.campaign.diagnostic === true) {
    throw new Error("diagnostic campaigns cannot produce a formal report");
  }
  if (files.state.review_seal?.status !== "sealed") {
    throw new Error(
      `blind verdicts are not sealed (${files.state.review_seal?.status ?? "missing"}); report and reveal are forbidden`,
    );
  }
  const runs = await collectRunArtifacts(campaignRoot);
  const reviewArtifacts = await collectJsonArtifacts(
    resolve(campaignRoot, "blind"),
    "verdict.json",
  );
  await validateFormalCampaignArtifacts({
    campaignRoot,
    files,
    runs,
    verdictArtifacts: reviewArtifacts,
  });
  const completion = campaignGateStatus({
    campaign: files.campaign,
    schedule: files.schedule,
    state: files.state,
    runs,
    verdicts: reviewArtifacts.map((item) => item.value),
    strictEvidence: true,
    expectedBindingsForRun: (run, phase) =>
      expectedRunBindings(files, run, phase),
  });
  if (!completion.complete) {
    throw new Error(
      `formal campaign evidence is incomplete: ${completion.reasons.join("; ")}`,
    );
  }
  const reviews = reviewArtifacts.map((item) => ({
    ...item.value,
    verdict_path: relative(campaignRoot, item.path).replaceAll("\\", "/"),
    verdict_sha256: item.sha256,
  }));
  const summary = aggregateCampaign({
    tasks: files.campaign.tasks,
    runs,
    reviews,
    mapping: files.sealed.mapping,
    diagnostic: files.campaign.diagnostic === true,
    evidenceComplete: completion.complete,
  });
  await writeJson(resolve(campaignRoot, "summary.json"), summary);
  await writeFile(
    resolve(campaignRoot, "report.zh-CN.md"),
    reportMarkdown(summary, files.campaign),
    "utf8",
  );
  await writeChecksums(campaignRoot, [], { allowMutation: true });
  await verifyCampaign({ repositoryRoot, options });
  return { campaignRoot, summary };
}

export async function runCli(
  argv,
  repositoryRoot = resolve(import.meta.dirname, "../../../.."),
) {
  const { command, options } = parseCli(argv);
  if (command === "prepare")
    return prepareCampaign({ repositoryRoot, options });
  if (command === "run") return runCampaign({ repositoryRoot, options });
  if (command === "review") return reviewCampaign({ repositoryRoot, options });
  if (command === "verify") return verifyCampaign({ repositoryRoot, options });
  return reportCampaign({ repositoryRoot, options });
}
