import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";

import {
  buildFilesystemTrace,
  collectRunEvidence,
  collectWorkspaceManifest,
  collectWorkspacePatch,
  diffWorkspaceManifests,
  hasForbiddenNetworkCommand,
  hasForbiddenPathCommand,
  onboardingHasDisallowedChanges,
  onboardingManifestHasDisallowedChanges,
  parseOpenCodeExport,
  parseOpenCodeJsonl,
  writeWorkspaceManifest,
} from "../lib/collector.mjs";
import {
  isolatedRuntimeParent,
  phaseAllowedCommands,
  probeAgentShellNetworkIsolation,
  toolchainShimSource,
  validateResolvedConfig,
  validateToolchainShimSource,
} from "../lib/opencode.mjs";

test("OpenCode isolated runtime avoids the system temporary directory", () => {
  assert.equal(
    isolatedRuntimeParent({
      campaignRoot:
        "D:/Chatgpt/self-evolution-campaigns/external/external-test",
      workspaceDir:
        "D:/Chatgpt/self-evolution-execution/external-test/smoke/workspace",
    }),
    resolve("D:/Chatgpt/self-evolution-campaigns/external"),
  );
  assert.equal(
    isolatedRuntimeParent({
      workspaceDir:
        "D:/Chatgpt/self-evolution-execution/external-test/smoke/workspace",
    }),
    resolve("D:/Chatgpt/self-evolution-execution/external-test/smoke"),
  );
});

test("onboarding modification policy is an allowlist", () => {
  assert.equal(
    onboardingHasDisallowedChanges("?? .agents/settings.yaml\n"),
    false,
  );
  assert.equal(onboardingHasDisallowedChanges(" M AGENTS.md\n"), false);
  assert.equal(onboardingHasDisallowedChanges(" M index.js\n"), true);
  assert.equal(onboardingHasDisallowedChanges(" M package.json\n"), true);
  assert.equal(
    onboardingManifestHasDisallowedChanges({
      changes: [{ change: "added", path: ".agents/settings.yaml" }],
    }),
    false,
  );
  assert.equal(
    onboardingManifestHasDisallowedChanges({
      changes: [{ change: "modified", path: "src/index.js" }],
    }),
    true,
  );
});

test("workspace byte manifests cover ignored files but exclude evaluator noise", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-manifest-test-"));
  await mkdir(resolve(root, ".git/objects"), { recursive: true });
  await mkdir(resolve(root, "node_modules/pkg"), { recursive: true });
  await mkdir(resolve(root, ".external-eval/validation"), { recursive: true });
  await mkdir(resolve(root, "src"), { recursive: true });
  await mkdir(resolve(root, "cache"), { recursive: true });
  await writeFile(resolve(root, ".git/objects/noise"), "git");
  await writeFile(resolve(root, "node_modules/pkg/index.js"), "dependency");
  await writeFile(
    resolve(root, ".external-eval/validation/preload.cjs"),
    "evaluator",
  );
  await writeFile(resolve(root, "src/index.js"), "export default 1;\n");
  await writeFile(resolve(root, "cache/ignored.bin"), Buffer.from([0, 1, 2]));

  const before = await collectWorkspaceManifest(root);
  assert.deepEqual(
    before.files.map((item) => item.path),
    ["cache/ignored.bin", "src/index.js"],
  );
  assert.equal(before.total_bytes, 21);
  assert.match(before.manifest_sha256, /^[0-9a-f]{64}$/);

  await writeFile(resolve(root, "src/index.js"), "export default 2;\n");
  await writeFile(
    resolve(root, "cache/untracked.txt"),
    "restored-final-state\n",
  );
  const after = await collectWorkspaceManifest(root);
  const diff = diffWorkspaceManifests(before, after);
  assert.deepEqual(
    diff.changes.map(({ change, path }) => ({ change, path })),
    [
      { change: "added", path: "cache/untracked.txt" },
      { change: "modified", path: "src/index.js" },
    ],
  );
  assert.match(diff.binding_sha256, /^[0-9a-f]{64}$/);

  await writeFile(resolve(root, "src/index.js"), "export default 1;\n");
  await rm(resolve(root, "cache/untracked.txt"));
  const restored = await collectWorkspaceManifest(root);
  assert.deepEqual(diffWorkspaceManifests(before, restored).changes, []);
});

test("shell policy detects forbidden network-capable commands", () => {
  assert.equal(
    hasForbiddenNetworkCommand({
      tools: [{ access: "execute", command: "git fetch origin main" }],
    }),
    true,
  );
  for (const command of [
    `node -e "fetch('https://example.com')"`,
    `python -c "import socket; socket.create_connection(('example.com', 443))"`,
    "git -c http.proxy= fetch origin",
    "npm exec eslint .",
  ]) {
    assert.equal(
      hasForbiddenNetworkCommand({
        tools: [{ access: "execute", command }],
      }),
      true,
      command,
    );
  }
  assert.equal(
    hasForbiddenNetworkCommand({
      tools: [{ access: "execute", command: "npm test" }],
    }),
    false,
  );
  assert.equal(
    hasForbiddenNetworkCommand({
      tools: [{ access: "execute", command: "npm ci --ignore-scripts" }],
    }),
    true,
  );
});

test("shell policy permits only an exact frozen npx command", () => {
  const frozen = "npx ava --timeout=2m test/external-detached-map.test.js";
  const parsed = (command) => ({
    tools: [{ access: "execute", command }],
  });
  assert.equal(hasForbiddenNetworkCommand(parsed(frozen), [frozen]), false);
  assert.equal(
    hasForbiddenNetworkCommand(parsed(`${frozen} --update-snapshots`), [
      frozen,
    ]),
    true,
  );
  assert.equal(
    hasForbiddenNetworkCommand(parsed("npx ava test/other.test.js"), [frozen]),
    true,
  );
  assert.equal(
    hasForbiddenNetworkCommand(parsed("npx eclint check lib test"), []),
    true,
  );
});

test("shell policy detects obvious workspace escapes and hidden inputs", () => {
  assert.equal(
    hasForbiddenPathCommand(
      { tools: [{ access: "execute", command: "type ..\\sealed\\map.json" }] },
      resolve("workspace"),
    ),
    true,
  );
  assert.equal(
    hasForbiddenPathCommand(
      { tools: [{ access: "execute", command: "node test.js" }] },
      resolve("workspace"),
    ),
    false,
  );
  for (const command of [
    "cat hidden/test.js",
    "type sealed\\arm-mapping.json",
    "cat 'OrAcLe/input.json'",
    "ls subjects/v1",
  ]) {
    assert.equal(
      hasForbiddenPathCommand(
        { tools: [{ access: "execute", command }] },
        resolve("workspace"),
      ),
      true,
      command,
    );
  }
});

test("read-only reviewer config permits scalar bash deny", () => {
  assert.doesNotThrow(() =>
    validateResolvedConfig(
      {
        provider: { reviewer: {} },
        plugin: [],
        mcp: {},
        skills: { paths: [] },
        shell: "review-shell.cmd",
        instructions: [],
        permission: {
          read: "deny",
          glob: "deny",
          grep: "deny",
          bash: "deny",
          edit: "deny",
          write: "deny",
          apply_patch: "deny",
          webfetch: "deny",
          websearch: "deny",
          task: "deny",
        },
      },
      {
        providerId: "reviewer",
        skillDir: null,
        readOnly: true,
        shellPath: "review-shell.cmd",
      },
    ),
  );
});

test("execution config is deny-first and only permits frozen task commands", () => {
  const task = {
    validation: {
      focused: ["npx ava test/regression.test.js"],
      full: ["npm test"],
    },
  };
  const onboarding = phaseAllowedCommands(task, "onboarding");
  const repair = phaseAllowedCommands(task, "repair");
  assert.equal(onboarding.includes("npm test"), false);
  assert.equal(repair.includes("npm test"), true);
  assert.equal(repair.includes("npx ava test/regression.test.js"), true);
  assert.throws(() => phaseAllowedCommands(null, "repair"), /frozen task/);
  assert.doesNotThrow(() =>
    validateResolvedConfig(
      {
        provider: { execution: {} },
        plugin: [],
        mcp: {},
        skills: { paths: [resolve("subject")] },
        shell: "execution-shell.cmd",
        instructions: [],
        permission: {
          read: "deny",
          glob: "deny",
          grep: "deny",
          edit: "deny",
          write: "deny",
          apply_patch: "deny",
          task: "deny",
          webfetch: "deny",
          websearch: "deny",
          bash: Object.fromEntries([
            ["*", "deny"],
            ...repair.map((command) => [command, "allow"]),
          ]),
        },
      },
      {
        providerId: "execution",
        skillDir: resolve("subject"),
        readOnly: false,
        allowedCommands: repair,
        shellPath: "execution-shell.cmd",
      },
    ),
  );
});

test("Windows agent-shell shims bind bwrap, the pinned toolchain, and cwd", () => {
  for (const tool of [
    "node",
    "npm",
    "npx",
    "sh",
    "bash",
    "python",
    "python3",
  ]) {
    const source = toolchainShimSource(tool);
    assert.match(
      source,
      /wsl\.exe --distribution Ubuntu --cd ".+" --exec \/usr\/bin\/bwrap --unshare-user --unshare-pid --unshare-net/,
    );
    assert.match(source, /--setenv WSL_INTEROP \/dev\/null/);
    assert.match(source, /--symlink usr\/bin \/bin/);
    assert.match(source, /--symlink usr\/sbin \/sbin/);
    assert.match(source, /--symlink usr\/lib \/lib/);
    assert.match(source, /--symlink usr\/lib64 \/lib64/);
    assert.match(source, /--tmpfs \/usr\/local/);
    assert.match(source, /--setenv PATH \/toolchain\/bin:/);
    assert.doesNotMatch(source, /--setenv PATH ['"]/);
    assert.match(
      source,
      /--bind \/mnt\/d\/Chatgpt\/self-evolution \/workspace/,
    );
    assert.doesNotMatch(source, /--(?:ro-)?bind \/mnt\/c(?:\s|$)/);
    assert.match(
      source,
      /--ro-bind \/home\/d26fo\/\.local\/share\/self-evolution-toolchains\/node-v22\.13\.1 \/toolchain/,
    );
    assert.doesNotThrow(() => validateToolchainShimSource(source, tool));
  }
});

test("toolchain shim validation rejects only exact /mnt/c bind endpoints", () => {
  const source = toolchainShimSource("node");
  for (const descendantBind of [
    '--bind "/mnt/c/Users/Test Workspace/node" /workspace-copy',
    '--ro-bind /source "/mnt/c/Users/Test Workspace/node"',
  ]) {
    assert.doesNotThrow(() =>
      validateToolchainShimSource(`${source}\r\n${descendantBind}`, "node"),
    );
  }
  for (const rootBind of [
    '--bind   "/mnt/c"   /workspace-copy',
    "--ro-bind\t/source\t'/mnt/c'",
  ]) {
    assert.throws(
      () => validateToolchainShimSource(`${source}\r\n${rootBind}`, "node"),
      /exposes \/mnt\/c/,
    );
  }
});

test(
  "agent-shell Node, Python, and shell-wrapper canaries cannot reach the network",
  { skip: process.platform !== "win32", timeout: 30_000 },
  async () => {
    const result = await probeAgentShellNetworkIsolation();
    assert.equal(result.status, "passed");
    assert.deepEqual(
      result.results.map((item) => item.name),
      ["node", "python", "shell-wrapper", "interop"],
    );
    assert.ok(result.results.every((item) => item.exit_code === 0));
  },
);

test(
  "pinned WSL node and npm versions are callable from the Windows workspace",
  { skip: process.platform !== "win32" },
  async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execute = promisify(execFile);
    const environmentPath =
      "PATH=/home/d26fo/.local/share/self-evolution-toolchains/node-v22.13.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    const invoke = (tool, argument) =>
      execute(
        "wsl.exe",
        [
          "--distribution",
          "Ubuntu",
          "--cd",
          process.cwd(),
          "--exec",
          "env",
          environmentPath,
          tool,
          argument,
        ],
        { windowsHide: true },
      );
    const [node, npm] = await Promise.all([
      invoke("node", "--version"),
      invoke("npm", "--version"),
    ]);
    assert.equal(node.stdout.trim(), "v22.13.1");
    assert.equal(npm.stdout.trim(), "10.9.2");
  },
);
import {
  createBlindBundle,
  detectBlindLeaks,
  neutralizeBlindValue,
  parseVerdictText,
  validateReviewerExecution,
} from "../lib/blind.mjs";

function armScores(overrides = {}) {
  return {
    correctness: "pass",
    regression_safety: "pass",
    scope_discipline: 3,
    knowledge_retrieval_credibility: 3,
    capture_value: 3,
    test_evidence: 3,
    final_delivery: 3,
    ...overrides,
  };
}

test("review verdict accepts only the neutral strict A/B schema", () => {
  const verdict = parseVerdictText(
    JSON.stringify({
      schema_version: "1.0",
      task_id: "task",
      attempt: 1,
      arms: { A: "A", B: "B" },
      winner: "tie",
      scores: { A: armScores(), B: armScores() },
      rationale: "indistinguishable",
    }),
    { task_id: "task", attempt: 1 },
  );
  assert.equal(verdict.winner, "tie");
  assert.throws(
    () =>
      parseVerdictText(
        JSON.stringify({
          schema_version: "1.0",
          task_id: "task",
          attempt: 1,
          arms: { A: "arm-aaaaaaaaaaaa", B: "arm-bbbbbbbbbbbb" },
          winner: "A",
          scores: {},
          rationale: "leaked mapping",
        }),
        { task_id: "task", attempt: 1 },
      ),
    /neutral A\/B/,
  );
  assert.throws(
    () =>
      parseVerdictText(
        JSON.stringify({
          schema_version: "1.0",
          task_id: "task",
          attempt: 1,
          arms: { A: "A", B: "B" },
          winner: "A",
          scores: {
            A: armScores({ correctness: "yes" }),
            B: armScores(),
          },
          rationale: "invalid score",
        }),
        { task_id: "task", attempt: 1 },
      ),
    /pass, fail, or uncertain/,
  );
});

test("blind reviewer execution rejects every tool call", () => {
  const execution = { exitCode: 0, timedOut: false };
  const parsed = {
    errors: [],
    tool_calls: 0,
    response_usage: [{ input_tokens: 1, output_tokens: 1 }],
    final: "{}",
  };
  assert.doesNotThrow(() => validateReviewerExecution(execution, parsed));
  assert.throws(
    () => validateReviewerExecution(execution, { ...parsed, tool_calls: 1 }),
    /tool calls are forbidden/,
  );
});

test("OpenCode JSONL parser derives usage, tools, final text, and errors", () => {
  const content = [
    JSON.stringify({
      type: "step_finish",
      sessionID: "ses-1",
      part: {
        id: "p1",
        messageID: "m1",
        tokens: {
          input: 10,
          output: 2,
          reasoning: 1,
          cache: { read: 3, write: 4 },
        },
      },
    }),
    JSON.stringify({
      type: "tool_use",
      sessionID: "ses-1",
      part: {
        callID: "c1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "src/index.js" },
          output: "contents",
          time: { start: 1, end: 2 },
        },
      },
    }),
    JSON.stringify({
      type: "text",
      sessionID: "ses-1",
      part: { text: "done" },
    }),
  ].join("\n");
  const parsed = parseOpenCodeJsonl(content);
  assert.equal(parsed.session_id, "ses-1");
  assert.equal(parsed.usage.input_tokens, 10);
  assert.equal(parsed.usage.cache_read_input_tokens, 3);
  assert.equal(parsed.tool_calls, 1);
  assert.equal(parsed.tools[0].output_bytes, 8);
  assert.equal(parsed.final, "done");
  const trace = buildFilesystemTrace(parsed, resolve("workspace"));
  assert.equal(trace[0].path, "src/index.js");
  assert.equal(trace[0].outside_workspace, false);
});

test("OpenCode JSONL parser records malformed lines instead of ignoring them", () => {
  const parsed = parseOpenCodeJsonl(
    `${JSON.stringify({ type: "text", part: { text: "done" } })}\n{"broken"`,
  );
  assert.equal(parsed.final, "done");
  assert.equal(parsed.parse_errors.length, 1);
});

test("OpenCode export parser preserves per-response usage and catches provider errors", () => {
  const parsed = parseOpenCodeExport({
    info: { id: "ses-2" },
    messages: [
      {
        info: { role: "assistant", error: { name: "APIError" } },
        parts: [
          {
            type: "step-finish",
            id: "p2",
            messageID: "m2",
            tokens: {
              input: 7,
              output: 1,
              reasoning: 0,
              cache: { read: 5, write: 0 },
            },
          },
        ],
      },
    ],
  });
  assert.equal(parsed.response_usage.length, 1);
  assert.equal(parsed.response_usage[0].cache_read_input_tokens, 5);
  assert.equal(parsed.errors.length, 1);
});

test("workspace patch includes applyable untracked text and binary files", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-complete-patch-"));
  const applied = await mkdtemp(resolve(tmpdir(), "external-applied-patch-"));
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "external eval test"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.email", "eval@example.invalid"], {
    cwd: root,
  });
  await writeFile(resolve(root, "source.js"), "export default 1;\n");
  execFileSync("git", ["add", "source.js"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  await writeFile(resolve(root, "source.js"), "export default 2;\n");
  await mkdir(resolve(root, "test"), { recursive: true });
  await writeFile(
    resolve(root, "test/visible regression.test.js"),
    "test('visible regression', () => {});\n",
  );
  await mkdir(resolve(root, "fixtures"), { recursive: true });
  await writeFile(
    resolve(root, "fixtures/blob.bin"),
    Buffer.from([0x00, 0xff, 0x01, 0x02]),
  );

  const result = await collectWorkspacePatch(root);
  assert.deepEqual(result.changed_paths, [
    "fixtures/blob.bin",
    "source.js",
    "test/visible regression.test.js",
  ]);
  assert.match(result.patch_text, /visible regression/);
  assert.match(result.patch_text, /GIT binary patch/);
  assert.deepEqual(result.untracked_paths.sort(), [
    "fixtures/blob.bin",
    "test/visible regression.test.js",
  ]);
  assert.equal(
    createHash("sha256").update(result.patch).digest("hex"),
    result.patch_sha256,
  );

  execFileSync("git", ["clone", "-q", root, applied]);
  const patchPath = resolve(tmpdir(), `complete-${result.patch_sha256}.diff`);
  await writeFile(patchPath, result.patch);
  execFileSync("git", ["apply", "--binary", patchPath], { cwd: applied });
  assert.equal(
    (
      await readFile(
        resolve(applied, "test/visible regression.test.js"),
        "utf8",
      )
    ).replaceAll("\r\n", "\n"),
    "test('visible regression', () => {});\n",
  );
  assert.deepEqual(
    await readFile(resolve(applied, "fixtures/blob.bin")),
    Buffer.from([0x00, 0xff, 0x01, 0x02]),
  );
});

test("collector derives selected context and Capture from phase diffs", async () => {
  const parent = await mkdtemp(resolve(tmpdir(), "external-evidence-test-"));
  const root = resolve(parent, "workspace");
  const output = resolve(parent, "evidence");
  const { execFileSync } = await import("node:child_process");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "external eval test"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.email", "eval@example.invalid"], {
    cwd: root,
  });
  await writeFile(resolve(root, "source.js"), "export default 1;\n");
  execFileSync("git", ["add", "source.js"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  await mkdir(resolve(root, ".agents/knowledge/inbox"), { recursive: true });
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "knowledge.pre.json"), "[]\n");
  await writeWorkspaceManifest(resolve(output, "workspace.pre.json"), root);
  await writeFile(
    resolve(root, ".agents/knowledge/inbox/2026-08.md"),
    "captured\n",
  );
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify({ status: "completed", exit_code: 0 }),
  );
  await writeFile(
    resolve(output, "opencode.jsonl"),
    [
      JSON.stringify({
        type: "tool_use",
        part: {
          callID: "read-1",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "source.js" },
            output: "export default 1;",
          },
        },
      }),
      JSON.stringify({
        type: "step_finish",
        part: { tokens: { input: 2, output: 1 } },
      }),
      JSON.stringify({ type: "text", part: { text: "done" } }),
    ].join("\n"),
  );
  const evidence = await collectRunEvidence({
    campaign: { campaign_id: "campaign" },
    unit: {
      task_id: "task",
      attempt: 1,
      blind_label: "arm-aaaaaaaaaaaa",
    },
    phase: "repair",
    workspaceDir: root,
    outputDir: output,
  });
  assert.equal(evidence.selected_context[0].path, "source.js");
  assert.equal(evidence.selected_context[0].bytes, 17);
  assert.equal(evidence.selected_context[0].measurement, "tool-output");
  assert.equal(evidence.capture.length, 1);
  assert.equal(evidence.capture[0].change, "added");
  assert.equal(evidence.capture[0].content, "captured\n");
  assert.match(
    await readFile(resolve(output, "workspace.patch"), "utf8"),
    /\+captured/,
  );
  assert.deepEqual(evidence.workspace_patch.untracked_paths, [
    ".agents/knowledge/inbox/2026-08.md",
  ]);
  assert.equal(evidence.workspace_manifest.diff.change_count, 1);
  assert.equal(
    evidence.workspace_manifest.diff.changes[0].path,
    ".agents/knowledge/inbox/2026-08.md",
  );
  assert.equal(
    evidence.workspace_tree_sha256,
    evidence.workspace_manifest.post.manifest_sha256,
  );
  assert.equal(evidence.assurance.workspace_state, "pre-post-byte-manifest");
  assert.equal(evidence.assurance.filesystem_audit, "not-syscall-audit");
  assert.match(
    evidence.assurance.workspace_limitations.join(" "),
    /write-then-revert/,
  );
  assert.match(
    evidence.workspace_manifest.final_state_binding_sha256,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(resolve(output, "workspace.post.json")))
      .digest("hex"),
    evidence.workspace_manifest.post.artifact_sha256,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(resolve(output, "capture-manifest.json"), "utf8"),
    ),
    evidence.capture,
  );
});

test("blind neutralization removes nested subject fields, identifiers, and absolute paths", () => {
  const subjectSha = "a".repeat(64);
  const value = neutralizeBlindValue(
    {
      version: "v2",
      subject_sha256: "abc",
      path: "D:\\campaign\\subjects\\v2\\self-evolution",
      nested: {
        transcript: [
          `loaded ${subjectSha} from C:\\sealed\\subject\\SKILL.md`,
          "read /home/evaluator/oracle/SKILL.md",
          "metadata skill_tree_sha256 leaked by legacy/v1/skill",
        ],
      },
      result: "ok",
    },
    [
      ["D:\\campaign", "<CAMPAIGN>"],
      [subjectSha, "<SUBJECT-IDENTIFIER>"],
    ],
  );
  assert.equal(value.version, undefined);
  assert.equal(value.subject_sha256, undefined);
  assert.equal(value.result, "ok");
  assert.equal(JSON.stringify(value).includes(subjectSha), false);
  assert.equal(detectBlindLeaks(value, [subjectSha]).length, 0);
  assert.ok(detectBlindLeaks({ path: "legacy/v1/skill" }).length > 0);
  assert.ok(
    detectBlindLeaks({ nested: { final: "read D:\\secret\\oracle.txt" } })
      .length > 0,
  );
  assert.ok(
    detectBlindLeaks({ nested: [{ test: "/home/evaluator/oracle.js" }] })
      .length > 0,
  );
  assert.ok(
    detectBlindLeaks({ nested: { capture: subjectSha } }, [subjectSha]).length >
      0,
  );
  assert.equal(
    detectBlindLeaks({ arms: { A: "https://example.invalid/a", B: "clean" } })
      .length,
    0,
  );
});

test("blind bundle deeply redacts leaks and assigns stable neutral Capture ids", async () => {
  const campaign = await mkdtemp(resolve(tmpdir(), "external-blind-test-"));
  const output = resolve(campaign, "blind/task/1");
  const subjectSha = "f".repeat(64);
  const archiveSha = "e".repeat(64);
  const sourceCommitSha = "d".repeat(40);
  const injectedWindowsPath = "C:\\coordinator\\sealed\\mapping.json";
  const injectedPosixPath = "/home/evaluator/oracle/patch.diff";
  await mkdir(resolve(campaign, "tasks/task"), { recursive: true });
  await writeFile(
    resolve(campaign, "tasks/task/task.json"),
    JSON.stringify({
      prompt: {
        onboarding: "Onboard.",
        repair: `Fix the defect. Ignore ${injectedWindowsPath}.`,
      },
    }),
  );
  for (const label of ["arm-aaaaaaaaaaaa", "arm-bbbbbbbbbbbb"]) {
    const root = resolve(campaign, "runs/task/1", label);
    await mkdir(resolve(root, "repair"), { recursive: true });
    await writeFile(
      resolve(root, "repair/result.json"),
      JSON.stringify({
        status: "completed",
        final: `fixed ${subjectSha} ${injectedPosixPath}`,
      }),
    );
    await writeFile(resolve(root, "repair/prompt.txt"), "Fix the defect.");
    await writeFile(
      resolve(root, "repair/evidence.json"),
      JSON.stringify({
        final: `fixed archive_ref=${archiveSha}`,
        selected_context: [
          {
            path: "source.js",
            bytes: 5,
            sha256: "a",
            nested: { output: injectedWindowsPath },
          },
        ],
        capture: [
          {
            id: "host-supplied-id",
            path: ".agents/knowledge/inbox/x.md",
            content: `note ${sourceCommitSha}`,
          },
        ],
        knowledge_diff: [
          {
            path: "AGENTS.md",
            content: `routing legacy/v1/skill at ${injectedPosixPath}`,
          },
        ],
      }),
    );
    await mkdir(resolve(root, "verification"), { recursive: true });
    await writeFile(
      resolve(root, "verification/patch.diff"),
      "diff --git a/x b/x\n",
    );
    await writeFile(
      resolve(root, "verification/verification.json"),
      JSON.stringify({
        hidden_tests: "pass",
        full_suite: "pass",
        focused: {
          commands: [{ stdout: `focused ${subjectSha}`, stderr: "" }],
        },
        full: {
          commands: [{ stdout: "full ok", stderr: injectedWindowsPath }],
        },
      }),
    );
  }
  const pair = [
    {
      task_id: "task",
      attempt: 1,
      blind_label: "arm-aaaaaaaaaaaa",
      version: "v1",
    },
    {
      task_id: "task",
      attempt: 1,
      blind_label: "arm-bbbbbbbbbbbb",
      version: "v2",
    },
  ];
  const result = await createBlindBundle({
    campaignDir: campaign,
    pair,
    outputDir: output,
    subjectRedactions: {
      v1: {
        sha256: subjectSha,
        archive_sha256: archiveSha,
        source_commit_sha: sourceCommitSha,
      },
    },
  });
  const bundle = JSON.parse(
    await (await import("node:fs/promises")).readFile(result.path, "utf8"),
  );
  assert.deepEqual(Object.keys(bundle.arms), ["A", "B"]);
  assert.equal(JSON.stringify(bundle).includes("arm-aaaaaaaaaaaa"), false);
  assert.equal(detectBlindLeaks(bundle).length, 0);
  assert.equal(
    detectBlindLeaks(bundle, [subjectSha, archiveSha, sourceCommitSha]).length,
    0,
  );
  assert.equal(bundle.task.prompt.repair.includes(injectedWindowsPath), false);
  assert.match(bundle.arms.A.verified_patch, /diff --git/);
  assert.equal(
    bundle.arms.A.repair.evidence.capture[0].id,
    bundle.arms.B.repair.evidence.capture[0].id,
  );
  assert.equal(
    bundle.arms.A.repair.evidence.capture[0].id,
    "capture-repair-001",
  );
  assert.equal(
    bundle.arms.B.repair.evidence.capture[0].id,
    "capture-repair-001",
  );
  assert.equal(JSON.stringify(bundle).includes("host-supplied-id"), false);

  const firstBundle = await readFile(result.path, "utf8");
  const repeated = await createBlindBundle({
    campaignDir: campaign,
    pair,
    outputDir: output,
    subjectRedactions: {
      v1: {
        sha256: subjectSha,
        archive_sha256: archiveSha,
        source_commit_sha: sourceCommitSha,
      },
    },
  });
  assert.equal(await readFile(repeated.path, "utf8"), firstBundle);
});
