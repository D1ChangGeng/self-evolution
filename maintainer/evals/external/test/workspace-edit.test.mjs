import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { assertWorkspaceEditReceipt } from "../lib/collector.mjs";
import { stableJson } from "../lib/core.mjs";
import {
  applyWorkspaceEdit,
  assertWorkspaceEditPath,
  decodeWorkspaceEditPatchBase64url,
  MAX_WORKSPACE_EDIT_PATCH_BYTES,
  parseWorkspaceEditArguments,
  parseWorkspaceEditPatch,
} from "../lib/workspace-edit.mjs";

const gatewayPath = resolve("maintainer/evals/external/lib/workspace-edit.mjs");

test("base64url patch cap fits the formal cmd.exe wrapper budget", () => {
  const encodedLength = Math.ceil((MAX_WORKSPACE_EDIT_PATCH_BYTES * 4) / 3);
  assert.equal(encodedLength, 4096);
  assert.ok(encodedLength < 8191);
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

async function repository(files) {
  const root = await mkdtemp(resolve(tmpdir(), "workspace-edit-repo-"));
  for (const [path, value] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  git(root, ["init", "-q"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "core.eol", "lf"]);
  git(root, ["config", "user.name", "workspace edit test"]);
  git(root, ["config", "user.email", "eval@example.invalid"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

function modifiedPatch(path, before, after) {
  const oldHash = digest(Buffer.from(before));
  const newHash = digest(Buffer.from(after));
  const beforeLines = before.endsWith("\n")
    ? before.slice(0, -1).split("\n")
    : before.split("\n");
  const afterLines = after.endsWith("\n")
    ? after.slice(0, -1).split("\n")
    : after.split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    `index ${oldHash}..${newHash} 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function addedPatch(path, contents) {
  const lines = contents.endsWith("\n")
    ? contents.slice(0, -1).split("\n")
    : contents.split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    `index ${"0".repeat(64)}..${digest(Buffer.from(contents))}`,
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function removedPatch(path, contents) {
  const lines = contents.endsWith("\n")
    ? contents.slice(0, -1).split("\n")
    : contents.split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    `index ${digest(Buffer.from(contents))}..${"0".repeat(64)}`,
    `--- a/${path}`,
    "+++ /dev/null",
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines.map((line) => `-${line}`),
    "",
  ].join("\n");
}

async function withFixture(files, callback) {
  const workspace = await repository(files);
  const receiptDir = await mkdtemp(
    resolve(tmpdir(), "workspace-edit-receipts-"),
  );
  try {
    return await callback({ receiptDir, workspace });
  } finally {
    await rm(workspace, { force: true, recursive: true });
    await rm(receiptDir, { force: true, recursive: true });
  }
}

test("repair applies strict unified diffs and writes a canonical receipt", async () => {
  await withFixture(
    {
      "src/index.js": "export const value = 1;\n",
      "src/old.js": "export default 'old';\n",
    },
    async ({ receiptDir, workspace }) => {
      const sourcePatch = modifiedPatch(
        "src/index.js",
        "export const value = 1;\n",
        "export const value = 2;\n",
      );
      const testPatch = addedPatch(
        "test/regression.test.js",
        "assert.equal(value, 2);\n",
      );
      const removePatch = removedPatch("src/old.js", "export default 'old';\n");
      const patch = `${testPatch}${removePatch}${sourcePatch}`;
      const receipt = await applyWorkspaceEdit({
        patch,
        phase: "repair",
        receiptDir,
        workspace,
      });

      assert.deepEqual(Object.keys(receipt).sort(), [
        "operation",
        "patch_sha256",
        "phase",
        "receipt_id",
        "schema_version",
        "status",
        "targets",
      ]);
      assert.equal(receipt.schema_version, "1.0");
      assert.equal(receipt.status, "applied");
      assert.equal(receipt.operation, "apply-unified-diff");
      assert.equal(receipt.phase, "repair");
      assert.match(receipt.patch_sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(
        receipt.targets.map(({ change, path }) => ({ change, path })),
        [
          { change: "modified", path: "src/index.js" },
          { change: "removed", path: "src/old.js" },
          { change: "added", path: "test/regression.test.js" },
        ],
      );
      for (const target of receipt.targets) {
        assert.deepEqual(Object.keys(target).sort(), [
          "after_sha256",
          "before_sha256",
          "change",
          "path",
        ]);
      }
      const identity = {
        operation: receipt.operation,
        patch_sha256: receipt.patch_sha256,
        phase: receipt.phase,
        targets: receipt.targets,
      };
      assert.equal(receipt.receipt_id, digest(stableJson(identity)));
      assert.deepEqual(assertWorkspaceEditReceipt(receipt), receipt);
      assert.equal(
        await readFile(resolve(workspace, "src/index.js"), "utf8"),
        "export const value = 2;\n",
      );
      await assert.rejects(readFile(resolve(workspace, "src/old.js")), {
        code: "ENOENT",
      });
      assert.equal(
        await readFile(resolve(workspace, "test/regression.test.js"), "utf8"),
        "assert.equal(value, 2);\n",
      );
      const files = await readdir(receiptDir);
      assert.deepEqual(files, [`${receipt.receipt_id}.json`]);
      assert.equal(
        await readFile(resolve(receiptDir, files[0]), "utf8"),
        stableJson(receipt),
      );
    },
  );
});

test("onboarding permits AGENTS.md and .agents/** but rejects source edits", async () => {
  await withFixture(
    { "AGENTS.md": "# Before\n", "src/index.js": "one\n" },
    async ({ receiptDir, workspace }) => {
      const receipt = await applyWorkspaceEdit({
        patch: `${modifiedPatch("AGENTS.md", "# Before\n", "# After\n")}${addedPatch(
          ".agents/knowledge/domains/runtime.md",
          "# Runtime\n",
        )}`,
        phase: "onboarding",
        receiptDir,
        workspace,
      });
      assert.equal(receipt.targets.length, 2);
      await assert.rejects(
        applyWorkspaceEdit({
          patch: modifiedPatch("src/index.js", "one\n", "two\n"),
          phase: "onboarding",
          receiptDir,
          workspace,
        }),
        (error) => error.code === "PHASE_PATH_VIOLATION",
      );
      assert.equal(
        await readFile(resolve(workspace, "src/index.js"), "utf8"),
        "one\n",
      );
    },
  );
});

test("path policy rejects traversal, evaluator files, manifests, locks, and generated output", () => {
  const paths = [
    "/tmp/file.js",
    "C:/tmp/file.js",
    "../file.js",
    "src/../file.js",
    "src\\file.js",
    ".git/config",
    "node_modules/pkg/index.js",
    ".external-eval/result.json",
    "hidden/regression.test.js",
    "oracle/fix.patch",
    "sealed/task.json",
    "subjects/v2/SKILL.md",
    "package.json",
    "package-lock.json",
    "sub/project.pnpm-lock.yaml.lock",
    "dist/index.js",
    "src/generated/client.js",
    "src/file.js:stream",
    "src/CON",
    "src/trailing. ",
  ];
  for (const path of paths) {
    assert.throws(
      () => assertWorkspaceEditPath(path, "repair"),
      undefined,
      path,
    );
  }
  assert.equal(
    assertWorkspaceEditPath("src/index.js", "repair"),
    "src/index.js",
  );
  assert.equal(
    assertWorkspaceEditPath("test/visible.test.js", "repair"),
    "test/visible.test.js",
  );
});

test("parser rejects non-unified, binary, rename, mode-only, duplicate and malformed patches", () => {
  const valid = modifiedPatch("src/index.js", "one\n", "two\n");
  const cases = [
    "*** Begin Patch\n*** Update File: src/index.js\n",
    valid.replace(
      "diff --git a/src/index.js b/src/index.js",
      "diff --git a/src/index.js b/src/other.js",
    ),
    valid.replace(
      "--- a/src/index.js",
      "rename from src/index.js\n--- a/src/index.js",
    ),
    valid.replace("--- a/src/index.js", "GIT binary patch\n--- a/src/index.js"),
    valid.replace("@@ -1,1 +1,1 @@", "@@ -1,2 +1,1 @@"),
    valid.replace("-one\n+two", "one\n+two"),
    valid.replace(
      "diff --git a/src/index.js b/src/index.js",
      "diff --git a/src/index.js b/src/index.js\r",
    ),
    `${valid}${valid}`,
    `${valid}${modifiedPatch("SRC/INDEX.JS", "one\n", "two\n")}`,
    valid.slice(0, -1),
    valid.replaceAll("\n", "\r"),
  ];
  for (const patch of cases) {
    assert.throws(
      () => parseWorkspaceEditPatch(patch, "repair"),
      undefined,
      patch.slice(0, 60),
    );
  }
  assert.throws(
    () =>
      parseWorkspaceEditPatch(
        Buffer.alloc(MAX_WORKSPACE_EDIT_PATCH_BYTES + 1),
        "repair",
      ),
    (error) => error.code === "PATCH_TOO_LARGE",
  );
});

test("gateway rejects symlink traversal before git apply", async (t) => {
  await withFixture(
    { "outside/index.js": "one\n" },
    async ({ receiptDir, workspace }) => {
      const external = await mkdtemp(
        resolve(tmpdir(), "workspace-edit-outside-"),
      );
      await writeFile(resolve(external, "index.js"), "one\n");
      const linkPath = resolve(workspace, "linked");
      try {
        await symlink(
          external,
          linkPath,
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch (error) {
        if (error.code === "EPERM") {
          t.skip("symlink creation is unavailable");
          return;
        }
        throw error;
      }
      try {
        await assert.rejects(
          applyWorkspaceEdit({
            patch: modifiedPatch("linked/index.js", "one\n", "two\n"),
            phase: "repair",
            receiptDir,
            workspace,
          }),
          (error) => error.code === "UNSAFE_FILESYSTEM",
        );
        assert.equal(
          await readFile(resolve(external, "index.js"), "utf8"),
          "one\n",
        );
      } finally {
        await rm(external, { force: true, recursive: true });
      }
    },
  );
});

test("failed checks leave workspace and receipt directory unchanged", async () => {
  await withFixture(
    { "src/index.js": "actual\n" },
    async ({ receiptDir, workspace }) => {
      await assert.rejects(
        applyWorkspaceEdit({
          patch: modifiedPatch("src/index.js", "expected\n", "changed\n"),
          phase: "repair",
          receiptDir,
          workspace,
        }),
        (error) => error.code === "PATCH_NOT_APPLICABLE",
      );
      assert.equal(
        await readFile(resolve(workspace, "src/index.js"), "utf8"),
        "actual\n",
      );
      assert.deepEqual(await readdir(receiptDir), []);
    },
  );
});

test("CRLF patch transport is normalized while target bytes follow git attributes", async () => {
  await withFixture(
    { ".gitattributes": "* text=auto eol=lf\n", "src/index.js": "one\n" },
    async ({ receiptDir, workspace }) => {
      const patch = modifiedPatch("src/index.js", "one\n", "two\n").replaceAll(
        "\n",
        "\r\n",
      );
      const receipt = await applyWorkspaceEdit({
        patch: Buffer.from(patch),
        phase: "repair",
        receiptDir,
        workspace,
      });
      assert.equal(
        receipt.patch_sha256,
        digest(Buffer.from(patch.replaceAll("\r\n", "\n"))),
      );
      assert.equal(
        await readFile(resolve(workspace, "src/index.js"), "utf8"),
        "two\n",
      );
    },
  );
});

test("mixed-ending diffs preserve CRLF bytes in target content", async () => {
  await withFixture(
    { "src/index.js": Buffer.from("one\r\n") },
    async ({ receiptDir, workspace }) => {
      const patch = modifiedPatch("src/index.js", "one\r\n", "two\r\n");
      const receipt = await applyWorkspaceEdit({
        patch,
        phase: "repair",
        receiptDir,
        workspace,
      });
      assert.deepEqual(
        await readFile(resolve(workspace, "src/index.js")),
        Buffer.from("two\r\n"),
      );
      assert.equal(
        receipt.targets[0].after_sha256,
        digest(Buffer.from("two\r\n")),
      );
    },
  );
});

test("CLI enforces exact argv and accepts canonical base64url or test-only stdin", async () => {
  await withFixture(
    { "src/index.js": "one\n" },
    async ({ receiptDir, workspace }) => {
      assert.throws(() =>
        parseWorkspaceEditArguments([
          "--phase",
          "repair",
          "--workspace",
          workspace,
          "--receipt-dir",
          receiptDir,
        ]),
      );
      const result = spawnSync(
        process.execPath,
        [
          gatewayPath,
          "--workspace",
          workspace,
          "--phase",
          "repair",
          "--receipt-dir",
          receiptDir,
        ],
        {
          encoding: "utf8",
          input: modifiedPatch("src/index.js", "one\n", "two\n"),
          windowsHide: true,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.status, "applied");
      assert.equal(
        await readFile(resolve(workspace, "src/index.js"), "utf8"),
        "two\n",
      );
    },
  );
});

test("formal CLI consumes a single canonical base64url patch token", async () => {
  await withFixture(
    { "src/index.js": "one\n" },
    async ({ receiptDir, workspace }) => {
      const patch = modifiedPatch("src/index.js", "one\n", "two\n");
      const token = Buffer.from(patch).toString("base64url");
      assert.deepEqual(
        decodeWorkspaceEditPatchBase64url(token),
        Buffer.from(patch),
      );
      const result = spawnSync(
        process.execPath,
        [
          gatewayPath,
          "--workspace",
          workspace,
          "--phase",
          "repair",
          "--receipt-dir",
          receiptDir,
          "--patch-base64url",
          token,
        ],
        {
          encoding: "utf8",
          input: "this stdin must be ignored",
          windowsHide: true,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).status, "applied");
      assert.equal(
        await readFile(resolve(workspace, "src/index.js"), "utf8"),
        "two\n",
      );
    },
  );
});

test("base64url transport rejects padding, separators, malformed lengths and extra argv", () => {
  for (const value of ["", "Zg==", "Zg+", "Zg/", "A", "Z g", "Zg\n"]) {
    assert.throws(
      () => decodeWorkspaceEditPatchBase64url(value),
      (error) => error.code === "INVALID_PATCH_BASE64URL",
      value,
    );
  }
  assert.throws(() =>
    parseWorkspaceEditArguments([
      "--workspace",
      resolve("workspace"),
      "--phase",
      "repair",
      "--receipt-dir",
      resolve("receipts"),
      "--patch-base64url",
      "Zg",
      "extra",
    ]),
  );
});

test("receipt directory must be separated from workspace", async () => {
  const workspace = await repository({ "src/index.js": "one\n" });
  try {
    await assert.rejects(
      applyWorkspaceEdit({
        patch: modifiedPatch("src/index.js", "one\n", "two\n"),
        phase: "repair",
        receiptDir: resolve(workspace, ".external-eval/receipts"),
        workspace,
      }),
      (error) => error.code === "UNSAFE_RECEIPT_DIR",
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
