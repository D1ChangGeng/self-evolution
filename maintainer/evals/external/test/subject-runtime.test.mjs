import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { resolve } from "node:path";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  EXTERNAL_ISOLATION_CONTRACT,
  RUNTIME_INSTRUCTIONS_SOURCE,
  SUBJECT_RUNTIME_ROOT,
  WORKSPACE_EDIT_RUNTIME_COMMAND,
  WORKSPACE_RUNTIME_ROOT,
  hasForbiddenRuntimePathCommand,
  livePolicyViolation,
  policyViolations,
  probeFrozenSubjectRuntime,
  shellWrapperSource,
  toolchainShimSource,
  validateResolvedConfig,
  WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256,
  workspaceEditInvocation,
} from "../lib/opencode.mjs";

function parsedTool(command, paths = []) {
  return { tools: [{ access: "execute", command, paths }] };
}

function captureProcess(file, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 30_000);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => finish(rejectPromise, error));
    child.on("close", (exitCode, signal) =>
      finish(resolvePromise, {
        exitCode: exitCode ?? 1,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

function runWindowsBatch(path, args, options = {}) {
  return captureProcess(
    process.env.COMSPEC ?? resolve(process.env.WINDIR, "System32/cmd.exe"),
    ["/d", "/s", "/c", path, ...args],
    options,
  );
}

async function windowsCsharpCompiler() {
  const windowsRoot = process.env.WINDIR ?? process.env.SystemRoot;
  if (!windowsRoot) return null;
  for (const framework of ["Framework64", "Framework"]) {
    const candidate = resolve(
      windowsRoot,
      "Microsoft.NET",
      framework,
      "v4.0.30319",
      "csc.exe",
    );
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function gitBlobSha1(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function addedFilePatch(path, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const lines = bytes.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    `index ${"0".repeat(40)}..${gitBlobSha1(bytes)}`,
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

test("subject mount is nested and runtime instructions are arm-neutral", () => {
  const source = toolchainShimSource("node", undefined, {
    workspaceDir: "D:\\Chatgpt\\fixture",
    subjectDir: "D:\\Chatgpt\\copied-subject",
  });
  assert.match(source, /--dir \/subject/);
  assert.match(
    source,
    /--ro-bind \/mnt\/d\/Chatgpt\/copied-subject \/subject\/self-evolution/,
  );
  assert.doesNotMatch(
    source,
    /--ro-bind \/mnt\/d\/Chatgpt\/copied-subject \/subject\s/,
  );
  assert.match(RUNTIME_INSTRUCTIONS_SOURCE, /\/workspace/);
  assert.match(RUNTIME_INSTRUCTIONS_SOURCE, /\/subject\/self-evolution/);
  assert.doesNotMatch(RUNTIME_INSTRUCTIONS_SOURCE, /v1|v2|legacy|archive/i);
  assert.equal(
    EXTERNAL_ISOLATION_CONTRACT.network_namespace,
    "wsl-bwrap-unshare-user-net",
  );
  assert.match(WORKSPACE_EDIT_RUNTIME_SOURCE_SHA256, /^[0-9a-f]{64}$/);
});

test("runtime path policy allows workspace and nested subject roots only", () => {
  const workspace = resolve("runtime-workspace");
  for (const command of [
    "cat src/index.js",
    `cat ${WORKSPACE_RUNTIME_ROOT}/src/index.js`,
    `sh ${SUBJECT_RUNTIME_ROOT}/references/scripts/scan-project.sh --help`,
    `node ${SUBJECT_RUNTIME_ROOT}/references/bin/kb.mjs --help`,
  ]) {
    assert.equal(
      hasForbiddenRuntimePathCommand(parsedTool(command), workspace),
      false,
      command,
    );
    assert.equal(
      livePolicyViolation(
        JSON.stringify({
          type: "tool_use",
          part: { tool: "bash", state: { input: { command } } },
        }),
        workspace,
      ),
      null,
      command,
    );
  }
  for (const command of [
    "cat ../sealed/arm-mapping.json",
    "cat /etc/passwd",
    "cat /home/evaluator/oracle/x",
    "cat /subject/other/SKILL.md",
    "cat /subject/self-evolution/../sealed/x",
    "cat C:\\coordinator\\sealed\\x",
    "cat \\\\server\\share\\oracle\\x",
    "cat /workspace/../subjects/v1/x",
    "cat hidden/x",
    "type sealed\\arm-mapping.json",
    "cat 'OrAcLe/input.json'",
    "ls subjects/v1",
  ]) {
    assert.equal(
      hasForbiddenRuntimePathCommand(parsedTool(command), workspace),
      true,
      command,
    );
  }
});

test("execute container paths are not mistaken for host workspace escapes", () => {
  const policy = parsedTool(
    `node ${SUBJECT_RUNTIME_ROOT}/references/bin/kb.mjs --help`,
    [SUBJECT_RUNTIME_ROOT + "/references/bin/kb.mjs"],
  );
  const parsed = { policy };
  const violations = policyViolations(parsed, resolve("runtime-workspace"));
  assert.equal(violations.pathEscape, false);
  assert.equal(violations.trace[0].outside_workspace, false);
});

test("workspace-edit invocation accepts exactly one opaque base64url token", () => {
  const token = Buffer.from("patch\n").toString("base64url");
  assert.deepEqual(
    workspaceEditInvocation(`${WORKSPACE_EDIT_RUNTIME_COMMAND} ${token}`),
    { patch_base64url: token },
  );
  for (const command of [
    WORKSPACE_EDIT_RUNTIME_COMMAND,
    `${WORKSPACE_EDIT_RUNTIME_COMMAND} ${token} extra`,
    `${WORKSPACE_EDIT_RUNTIME_COMMAND} ${token} && whoami`,
    `${WORKSPACE_EDIT_RUNTIME_COMMAND} ${token}=`,
  ]) {
    assert.equal(workspaceEditInvocation(command), null, command);
    const line = JSON.stringify({
      type: "tool_use",
      part: { tool: "bash", state: { input: { command } } },
    });
    assert.equal(
      livePolicyViolation(line, resolve("runtime-workspace")),
      "path-escape",
      command,
    );
  }
});

test("shell wrapper wires gateway, read-only subject, git metadata and receipts", () => {
  const source = shellWrapperSource({
    workspaceDir: "D:\\Chatgpt\\fixture",
    subjectDir: "D:\\Chatgpt\\subject",
    receiptPath: "D:\\temp\\args.txt",
    workspaceEdit: {
      command: WORKSPACE_EDIT_RUNTIME_COMMAND,
      phase: "repair",
      receipt_dir: "D:\\temp\\receipts",
    },
    workspaceEditSource: resolve(
      "maintainer/evals/external/lib/workspace-edit.mjs",
    ),
    workspaceEditCoreSource: resolve("maintainer/evals/external/lib/core.mjs"),
    workspaceEditReceiptDir: "D:\\temp\\receipts",
  });
  assert.match(source, /\/subject\/self-evolution/);
  assert.match(source, /workspace-edit\.mjs/);
  assert.match(source, /core\.mjs/);
  assert.match(source, /--patch-base64url/);
  assert.match(source, /GIT_OPTIONAL_LOCKS 0/);
  assert.match(source, /if \/I "%~1"=="-c"/);
  assert.match(source, /if \/I "%%A"=="\/harness\/workspace-edit"/);
  assert.match(source, /--bind .*\/harness\/receipts/);
  assert.match(source, /EnableDelayedExpansion/);
  assert.match(source, /exit \/b !external_exit!/);
  const gatewayBranch = source.slice(
    source.indexOf(`if /I "%~1"=="${WORKSPACE_EDIT_RUNTIME_COMMAND}"`),
    source.indexOf("wsl.exe", source.lastIndexOf("exit /b !external_exit!")),
  );
  assert.doesNotMatch(gatewayBranch, /exit \/b %ERRORLEVEL%/);
});

test(
  "real Windows shell wrapper preserves gateway exit 37",
  { skip: process.platform !== "win32", timeout: 60_000 },
  async (context) => {
    const compiler = await windowsCsharpCompiler();
    if (!compiler) {
      context.skip("Windows C# compiler is unavailable");
      return;
    }
    const root = await mkdtemp(resolve(tmpdir(), "workspace-edit-exit-"));
    try {
      const workspace = resolve(root, "workspace");
      const receipts = resolve(root, "receipts");
      const wrapper = resolve(root, "shell-wrapper.cmd");
      const csharp = resolve(root, "wsl.cs");
      const wsl = resolve(root, "wsl.exe");
      await mkdir(workspace, { recursive: true });
      await mkdir(receipts, { recursive: true });
      await writeFile(
        csharp,
        [
          "public static class WslStub",
          "{",
          "    public static int Main(string[] args) { return 37; }",
          "}",
          "",
        ].join("\r\n"),
        "utf8",
      );
      const compiled = await captureProcess(
        compiler,
        ["/nologo", "/target:exe", `/out:${wsl}`, csharp],
        { cwd: root },
      );
      assert.equal(compiled.exitCode, 0, compiled.stderr || compiled.stdout);
      await writeFile(
        wrapper,
        shellWrapperSource({
          workspaceDir: workspace,
          workspaceEdit: {
            command: WORKSPACE_EDIT_RUNTIME_COMMAND,
            phase: "repair",
            receipt_dir: receipts,
          },
          workspaceEditSource: resolve(
            "maintainer/evals/external/lib/workspace-edit.mjs",
          ),
          workspaceEditCoreSource: resolve(
            "maintainer/evals/external/lib/core.mjs",
          ),
          workspaceEditReceiptDir: receipts,
        }),
        "utf8",
      );
      const token = Buffer.from("patch\n").toString("base64url");
      const env = {
        ...process.env,
        PATH: `${root};${process.env.PATH ?? ""}`,
      };
      for (const args of [
        [WORKSPACE_EDIT_RUNTIME_COMMAND, token],
        ["-c", `${WORKSPACE_EDIT_RUNTIME_COMMAND} ${token}`],
      ]) {
        const execution = await runWindowsBatch(wrapper, args, {
          cwd: workspace,
          env,
        });
        assert.equal(execution.timedOut, false, JSON.stringify(execution));
        assert.equal(execution.exitCode, 37, JSON.stringify(execution));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "real Windows shell wrapper applies a gateway patch and writes a receipt",
  { skip: process.platform !== "win32", timeout: 90_000 },
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "workspace-edit-wrapper-"));
    try {
      const workspace = resolve(root, "workspace");
      const receipts = resolve(root, "receipts");
      const wrapper = resolve(root, "shell-wrapper.cmd");
      const targetPath = ".agents/gateway-wrapper-e2e.txt";
      const target = resolve(workspace, targetPath);
      const content = Buffer.from("gateway wrapper e2e\n");
      await mkdir(workspace, { recursive: true });
      await mkdir(receipts, { recursive: true });
      const initialized = await captureProcess("git", ["init", "--quiet"], {
        cwd: workspace,
      });
      assert.equal(
        initialized.exitCode,
        0,
        initialized.stderr || initialized.stdout,
      );
      await writeFile(
        wrapper,
        shellWrapperSource({
          workspaceDir: workspace,
          workspaceEdit: {
            command: WORKSPACE_EDIT_RUNTIME_COMMAND,
            phase: "repair",
            receipt_dir: receipts,
          },
          workspaceEditSource: resolve(
            "maintainer/evals/external/lib/workspace-edit.mjs",
          ),
          workspaceEditCoreSource: resolve(
            "maintainer/evals/external/lib/core.mjs",
          ),
          workspaceEditReceiptDir: receipts,
        }),
        "utf8",
      );
      const patch = addedFilePatch(targetPath, content);
      const token = Buffer.from(patch).toString("base64url");
      const execution = await runWindowsBatch(
        wrapper,
        [WORKSPACE_EDIT_RUNTIME_COMMAND, token],
        { cwd: workspace, timeoutMs: 60_000 },
      );
      assert.equal(execution.timedOut, false, JSON.stringify(execution));
      assert.equal(execution.exitCode, 0, JSON.stringify(execution));
      assert.deepEqual(await readFile(target), content);

      const receiptFiles = (await readdir(receipts)).filter((name) =>
        /^[0-9a-f]{64}\.json$/.test(name),
      );
      assert.equal(receiptFiles.length, 1, JSON.stringify(receiptFiles));
      const receipt = JSON.parse(
        await readFile(resolve(receipts, receiptFiles[0]), "utf8"),
      );
      assert.equal(receipt.status, "applied");
      assert.equal(receipt.phase, "repair");
      assert.equal(
        receipt.patch_sha256,
        createHash("sha256").update(patch).digest("hex"),
      );
      assert.deepEqual(receipt.targets, [
        {
          after_sha256: createHash("sha256").update(content).digest("hex"),
          before_sha256: null,
          change: "added",
          path: targetPath,
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("shell wrapper binds .git read-only only when it exists", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "subject-runtime-git-"));
  try {
    const absent = shellWrapperSource({ workspaceDir: root });
    assert.doesNotMatch(absent, /\/workspace\/\.git/);
    await mkdir(resolve(root, ".git"));
    const present = shellWrapperSource({ workspaceDir: root });
    assert.match(present, /--ro-bind .*\/\.git \/workspace\/\.git/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell wrapper rejects gitfile metadata explicitly", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "subject-runtime-gitfile-"));
  try {
    await writeFile(resolve(root, ".git"), "gitdir: ../elsewhere\n", "utf8");
    assert.throws(
      () => shellWrapperSource({ workspaceDir: root }),
      /gitfiles are unsupported/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolved config accepts runtime instructions followed by project AGENTS", () => {
  const runtime = resolve("runtime-instructions.md");
  const agents = resolve("AGENTS.md");
  const allowed = ["npm test"];
  assert.doesNotThrow(() =>
    validateResolvedConfig(
      {
        provider: { execution: {} },
        plugin: [],
        mcp: {},
        skills: { paths: [resolve("subject/self-evolution")] },
        shell: resolve("shell.cmd"),
        instructions: [runtime, agents],
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
            ...allowed.map((x) => [x, "allow"]),
          ]),
        },
      },
      {
        providerId: "execution",
        skillDir: resolve("subject/self-evolution"),
        shellPath: resolve("shell.cmd"),
        instructionsPaths: [runtime, agents],
        allowedCommands: allowed,
      },
    ),
  );
});

test(
  "real Windows/WSL v1 and v2 entrypoints are readable and subjects are read-only",
  { skip: process.platform !== "win32", timeout: 60_000 },
  async () => {
    const [v1, v2] = await Promise.all([
      probeFrozenSubjectRuntime({
        workspaceDir: process.cwd(),
        subjectDir: resolve("legacy/v1/skill"),
        version: "v1",
      }),
      probeFrozenSubjectRuntime({
        workspaceDir: process.cwd(),
        subjectDir: resolve("skills/self-evolution"),
        version: "v2",
      }),
    ]);
    for (const result of [v1, v2]) {
      assert.equal(result.status, "passed", JSON.stringify(result));
      assert.equal(result.entrypoint_exit_code, 0);
      assert.equal(result.entrypoint_output_matched, true);
      assert.equal(result.subject_write_blocked, true);
      assert.match(result.subject_sha256, /^[0-9a-f]{64}$/);
    }
    assert.match(
      createHash("sha256").update(RUNTIME_INSTRUCTIONS_SOURCE).digest("hex"),
      /^[0-9a-f]{64}$/,
    );
  },
);
