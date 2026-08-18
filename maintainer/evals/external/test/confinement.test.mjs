import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, resolve } from "node:path";
import test from "node:test";

import {
  applyCoordinatorAclLease,
  classifyRestrictedWslProbe,
  codexExecutable,
  codexLaunch,
  prewarmRestrictedWsl,
  verifyRestrictedWslAvailability,
  windowsConfinementCanaryCommand,
} from "../lib/confinement.mjs";
import { writeJson } from "../lib/core.mjs";

const TARGET_NAMES = ["contracts", "prepared", "sealed", "subjects"];
const DPAPI_HEADER = Buffer.from(
  "01000000d08c9ddf0115d1118c7a00c04fc297eb",
  "hex",
);

function sandboxUsers(password = null) {
  return JSON.stringify({
    version: 5,
    offline: { username: "offline", password: "OFFLINE_SENTINEL" },
    online: {
      username: "CodexSandboxOnline",
      password:
        password ??
        Buffer.concat([DPAPI_HEADER, Buffer.from("fixture")]).toString(
          "base64",
        ),
    },
  });
}

async function fixture() {
  const campaignRoot = await mkdtemp(resolve(tmpdir(), "external-acl-lease-"));
  for (const name of TARGET_NAMES) {
    await mkdir(resolve(campaignRoot, name), { recursive: true });
  }
  return {
    campaignRoot,
    receiptDir: resolve(campaignRoot, "receipts"),
  };
}

async function executableFile(path, content = "fixture\n") {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, content);
  await chmod(path, 0o755);
  return path;
}

test("Codex discovery skips stale and non-launchable Windows PATH entries", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-codex-discovery-"));
  const stale = resolve(root, "stale");
  const shim = resolve(root, "npm-shim");
  const native = resolve(root, "native");
  await mkdir(stale, { recursive: true });
  await executableFile(resolve(shim, "codex"), "#!/bin/sh\n");
  await executableFile(resolve(shim, "codex.cmd"));
  const expected = await executableFile(resolve(native, "codex.exe"));

  assert.equal(
    codexExecutable({
      platform: "win32",
      arch: "x64",
      env: { PATH: [stale, shim, native].join(";") },
    }),
    expected,
  );
  assert.deepEqual(
    codexLaunch({
      platform: "win32",
      arch: "x64",
      env: { PATH: [stale, shim, native].join(";") },
    }),
    { file: expected, shell: false, kind: "native-executable" },
  );
});

test("Codex discovery resolves the current npm vendor bin layout", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-codex-vendor-"));
  const expected = await executableFile(
    resolve(
      root,
      "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    ),
  );

  assert.equal(
    codexExecutable({
      platform: "win32",
      arch: "x64",
      env: { PATH: root },
    }),
    expected,
  );
});

test("Codex discovery accepts native overrides and rejects command shims", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-codex-override-"));
  const commandShim = await executableFile(resolve(root, "codex.cmd"));
  const native = await executableFile(resolve(root, "codex.exe"));
  const missing = resolve(root, "missing.exe");

  assert.deepEqual(
    codexLaunch({
      platform: "win32",
      env: { CODEX_EXECUTABLE: native, PATH: "" },
    }),
    { file: native, shell: false, kind: "native-executable" },
  );
  assert.throws(
    () =>
      codexExecutable({
        platform: "win32",
        env: { CODEX_EXECUTABLE: commandShim, PATH: "" },
      }),
    /does not name a launchable Windows \.exe/,
  );
  assert.throws(
    () =>
      codexExecutable({
        platform: "win32",
        env: { CODEX_EXECUTABLE: missing, PATH: "" },
      }),
    /does not name a launchable Windows/,
  );
});

test("Codex vendor discovery rejects the wrong architecture triple", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-codex-arch-"));
  await executableFile(
    resolve(
      root,
      "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/aarch64-pc-windows-msvc/bin/codex.exe",
    ),
  );

  assert.throws(
    () =>
      codexExecutable({
        platform: "win32",
        arch: "x64",
        env: { PATH: root },
      }),
    /cannot resolve a launchable Codex executable/,
  );
});

test("Codex discovery keeps native PATH semantics outside Windows", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-codex-posix-"));
  const expected = await executableFile(resolve(root, "codex"));

  assert.equal(
    codexExecutable({
      platform: "linux",
      env: { PATH: [resolve(root, "missing"), root].join(delimiter) },
    }),
    expected,
  );
});

test("restricted WSL probe classifies missing distributions separately", () => {
  assert.equal(
    classifyRestrictedWslProbe({
      exitCode: 1,
      stdout: "",
      stderr:
        "W\0s\0l\0/\0S\0e\0r\0v\0i\0c\0e\0/\0W\0S\0L\0_\0E\0_\0D\0I\0S\0T\0R\0O\0_\0N\0O\0T\0_\0F\0O\0U\0N\0D\0",
    }),
    "distro-not-found",
  );
  assert.equal(
    classifyRestrictedWslProbe({
      exitCode: 1,
      stdout: "适用于 Linux 的 Windows 子系统没有已安装的分发。",
      stderr: "",
    }),
    "no-distributions",
  );
  assert.equal(
    classifyRestrictedWslProbe({ exitCode: 37, stderr: "generic failure" }),
    "unavailable",
  );
  assert.equal(
    classifyRestrictedWslProbe({ exitCode: 1, timedOut: true }),
    "timed-out",
  );
  assert.equal(classifyRestrictedWslProbe({ exitCode: 0 }), "available");
});

test("restricted WSL prewarm is Windows-only", async () => {
  let read = false;
  let launched = false;
  assert.deepEqual(
    await prewarmRestrictedWsl({
      distro: "Ubuntu",
      runtime: {
        platform: "linux",
        async readFile() {
          read = true;
        },
        async runPowerShell() {
          launched = true;
        },
      },
    }),
    { status: "not-applicable", distro: "Ubuntu" },
  );
  assert.equal(read, false);
  assert.equal(launched, false);
});

test("restricted WSL prewarm binds the online profile without exposing credentials", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "external-wsl-prewarm-"));
  const sourceHome = resolve(root, "codex-home");
  const markerPath = resolve(sourceHome, ".sandbox/setup_marker.json");
  const usersPath = resolve(sourceHome, ".sandbox-secrets/sandbox_users.json");
  const cipher = Buffer.concat([
    DPAPI_HEADER,
    Buffer.from("DPAPI_CIPHERTEXT_SENTINEL"),
  ]).toString("base64");
  await mkdir(resolve(markerPath, ".."), { recursive: true });
  await mkdir(resolve(usersPath, ".."), { recursive: true });
  await writeFile(
    markerPath,
    JSON.stringify({ version: 5, online_username: "CodexSandboxOnline" }),
  );
  await writeFile(usersPath, sandboxUsers(cipher));
  let launch;
  const emptyHash =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const result = await prewarmRestrictedWsl({
    distro: "Ubuntu",
    runtime: {
      platform: "win32",
      sourceHome,
      wslPath: "C:/Windows/System32/wsl.exe",
      env: {
        PATH: "C:\\Windows\\System32",
        SYSTEMROOT: "C:\\Windows",
        OPENCODE_AUTH_CONTENT: "AUTH_SECRET_SENTINEL",
        TEST_API_KEY: "API_SECRET_SENTINEL",
      },
      async runPowerShell(script, options) {
        launch = { script, options };
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schema_version: "1.0",
            status: "passed",
            timed_out: false,
            exit_code: 0,
            username: "CodexSandboxOnline",
            stdout_sha256: emptyHash,
            stderr_sha256: emptyHash,
          }),
          stderr: "",
        };
      },
    },
  });

  assert.deepEqual(result, {
    status: "passed",
    distro: "Ubuntu",
    identity: "CodexSandboxOnline",
    profile: "loaded-user-profile",
    probe: "wsl-bin-true",
    stdout_sha256: emptyHash,
    stderr_sha256: emptyHash,
  });
  assert.match(launch.script, /LoadUserProfile = \$true/);
  assert.match(launch.script, /--distribution/);
  assert.match(launch.script, /--exec \/bin\/true/);
  assert.match(launch.script, /System\.Security, Version=4\.0\.0\.0/);
  assert.doesNotMatch(launch.script, /ToHexString|::HashData/);
  assert.match(launch.script, /\$users\.online/);
  assert.doesNotMatch(launch.script, /OFFLINE_SENTINEL/);
  assert.doesNotMatch(
    launch.script,
    /AUTH_SECRET_SENTINEL|API_SECRET_SENTINEL/,
  );
  assert.doesNotMatch(launch.script, /DPAPI_CIPHERTEXT_SENTINEL/);
  assert.doesNotMatch(
    launch.script,
    /Set-Content|Out-File|WriteAllText|Export-Clixml/,
  );
  assert.deepEqual(launch.options.env, {
    PATH: "C:\\Windows\\System32",
    SYSTEMROOT: "C:\\Windows",
  });
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL/);
  assert.equal(
    await readFile(usersPath, "utf8").then((value) => value.includes(cipher)),
    true,
  );
});

test("restricted WSL prewarm fails closed without echoing process output", async () => {
  const marker = JSON.stringify({
    version: 5,
    online_username: "CodexSandboxOnline",
  });
  let error;
  try {
    await prewarmRestrictedWsl({
      distro: "Ubuntu",
      runtime: {
        platform: "win32",
        sourceHome: "C:/codex-home",
        wslPath: "C:/Windows/System32/wsl.exe",
        async readFile(path) {
          return String(path).endsWith("setup_marker.json")
            ? marker
            : sandboxUsers();
        },
        async runPowerShell() {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              schema_version: "1.0",
              status: "failed",
              timed_out: false,
              exit_code: 37,
              username: "CodexSandboxOnline",
              stdout_sha256: "a".repeat(64),
              stderr_sha256: "b".repeat(64),
            }),
            stderr: "PLAINTEXT_SENTINEL",
          };
        },
      },
    });
  } catch (value) {
    error = value;
  }
  assert.match(String(error), /wsl\.exe exited 37/);
  assert.doesNotMatch(String(error?.stack), /PLAINTEXT_SENTINEL/);
});

test("restricted WSL prewarm hides PowerShell host output on launch failure", async () => {
  const marker = JSON.stringify({
    version: 5,
    online_username: "CodexSandboxOnline",
  });
  let error;
  try {
    await prewarmRestrictedWsl({
      distro: "Ubuntu",
      runtime: {
        platform: "win32",
        sourceHome: "C:/codex-home",
        wslPath: "C:/Windows/System32/wsl.exe",
        async readFile(path) {
          return String(path).endsWith("setup_marker.json")
            ? marker
            : sandboxUsers();
        },
        async runPowerShell() {
          return {
            exitCode: 1,
            stdout: "DPAPI_CIPHERTEXT_SENTINEL",
            stderr: "PLAINTEXT_SENTINEL",
          };
        },
      },
    });
  } catch (value) {
    error = value;
  }
  assert.match(String(error), /PowerShell exited 1/);
  assert.doesNotMatch(
    String(error?.stack),
    /PLAINTEXT_SENTINEL|DPAPI_CIPHERTEXT_SENTINEL/,
  );
});

test("restricted WSL prewarm sanitizes malformed PowerShell evidence", async () => {
  let error;
  try {
    await prewarmRestrictedWsl({
      distro: "Ubuntu",
      runtime: {
        platform: "win32",
        sourceHome: "C:/codex-home",
        wslPath: "C:/Windows/System32/wsl.exe",
        async readFile(path) {
          return String(path).endsWith("setup_marker.json")
            ? JSON.stringify({
                version: 5,
                online_username: "CodexSandboxOnline",
              })
            : sandboxUsers();
        },
        async runPowerShell() {
          return {
            exitCode: 0,
            stdout: "{POWERSHELL_EVIDENCE_PLAINTEXT_SENTINEL",
            stderr: "POWERSHELL_STDERR_PLAINTEXT_SENTINEL",
          };
        },
      },
    });
  } catch (value) {
    error = value;
  }
  assert.match(String(error), /returned invalid evidence/);
  assert.doesNotMatch(
    String(error?.stack),
    /POWERSHELL_EVIDENCE_PLAINTEXT_SENTINEL|POWERSHELL_STDERR_PLAINTEXT_SENTINEL/,
  );
});

test("restricted WSL prewarm sanitizes malformed credential source JSON", async () => {
  const cases = [
    {
      malformed: "{MARKER_PLAINTEXT_SENTINEL",
      expected: /setup marker is invalid/,
      marker: true,
    },
    {
      malformed: "{CREDENTIAL_PLAINTEXT_SENTINEL",
      expected: /credential file is invalid/,
      marker: false,
    },
  ];
  for (const fixture of cases) {
    let launched = false;
    let error;
    try {
      await prewarmRestrictedWsl({
        distro: "Ubuntu",
        runtime: {
          platform: "win32",
          sourceHome: "C:/codex-home",
          wslPath: "C:/Windows/System32/wsl.exe",
          async readFile(path) {
            if (String(path).endsWith("setup_marker.json")) {
              return fixture.marker
                ? fixture.malformed
                : JSON.stringify({
                    version: 5,
                    online_username: "CodexSandboxOnline",
                  });
            }
            return fixture.marker ? sandboxUsers() : fixture.malformed;
          },
          async runPowerShell() {
            launched = true;
          },
        },
      });
    } catch (value) {
      error = value;
    }
    assert.match(String(error), fixture.expected);
    assert.doesNotMatch(
      String(error?.stack),
      /MARKER_PLAINTEXT_SENTINEL|CREDENTIAL_PLAINTEXT_SENTINEL/,
    );
    assert.equal(launched, false);
  }
});

test("restricted WSL prewarm rejects a mismatched online identity before launch", async () => {
  let launched = false;
  await assert.rejects(
    prewarmRestrictedWsl({
      distro: "Ubuntu",
      runtime: {
        platform: "win32",
        sourceHome: "C:/codex-home",
        async readFile() {
          return JSON.stringify({
            version: 5,
            online_username: "replacement-account",
          });
        },
        async runPowerShell() {
          launched = true;
        },
      },
    }),
    /online identity mismatch/,
  );
  assert.equal(launched, false);
});

test("restricted WSL prewarm validates the encrypted online credential before launch", async () => {
  const marker = JSON.stringify({
    version: 5,
    online_username: "CodexSandboxOnline",
  });
  for (const users of [
    JSON.stringify({ version: 4, online: {} }),
    JSON.stringify({ version: 5, online: null }),
    JSON.stringify({
      version: 5,
      online: { username: "replacement-account", password: "value" },
    }),
    sandboxUsers(Buffer.from("not-dpapi").toString("base64")),
  ]) {
    let launched = false;
    await assert.rejects(
      prewarmRestrictedWsl({
        distro: "Ubuntu",
        runtime: {
          platform: "win32",
          sourceHome: "C:/codex-home",
          async readFile(path) {
            return String(path).endsWith("setup_marker.json") ? marker : users;
          },
          async runPowerShell() {
            launched = true;
          },
        },
      }),
      /credential version|credential is invalid/,
    );
    assert.equal(launched, false);
  }
});

test("restricted WSL prewarm rejects unsafe distro names", async () => {
  await assert.rejects(
    prewarmRestrictedWsl({ distro: "Ubuntu'; Write-Output injected" }),
    /distro is invalid/,
  );
});

test("restricted WSL preflight uses the actual Codex sandbox launch and cleans up", async () => {
  let runtimeRoot;
  let launch;
  const result = await verifyRestrictedWslAvailability({
    distro: "Ubuntu",
    scratchRoot: tmpdir(),
    runtime: {
      platform: "win32",
      env: {
        PATH: "C:\\Windows\\System32",
        SYSTEMROOT: "C:\\Windows",
        TEMP: "C:\\Users\\coordinator\\AppData\\Local\\Temp",
        TMP: "C:\\Users\\coordinator\\AppData\\Local\\Temp",
        OPENCODE_AUTH_CONTENT: "must-not-cross",
        TEST_API_KEY: "must-not-cross",
      },
      async prepareDedicatedCodexHome(options) {
        runtimeRoot = options.runtimeRoot;
        return { root: resolve(options.runtimeRoot, "codex-home") };
      },
      async runCodexSandboxed(options) {
        launch = options;
        return {
          exitCode: 0,
          timedOut: false,
          stdout: "uid=1000(sandbox)\n",
          stderr: "",
        };
      },
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.profile, "external-opencode");
  assert.equal(launch.file, "wsl.exe");
  assert.deepEqual(launch.env, {
    PATH: "C:\\Windows\\System32",
    SYSTEMROOT: "C:\\Windows",
  });
  assert.deepEqual(launch.args, [
    "--distribution",
    "Ubuntu",
    "--exec",
    "/usr/bin/id",
  ]);
  await assert.rejects(access(runtimeRoot));
});

test("restricted WSL preflight reports distro registration before gateway setup", async () => {
  await assert.rejects(
    verifyRestrictedWslAvailability({
      distro: "Ubuntu",
      scratchRoot: tmpdir(),
      runtime: {
        platform: "win32",
        async prepareDedicatedCodexHome(options) {
          return { root: resolve(options.runtimeRoot, "codex-home") };
        },
        async runCodexSandboxed() {
          return {
            exitCode: 1,
            timedOut: false,
            stdout: "不存在具有所提供名称的分发。",
            stderr: "Error code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND",
          };
        },
      },
    }),
    /restricted-profile WSL preflight failed \(distro-not-found\).*WSL_E_DISTRO_NOT_FOUND/,
  );
});

test("Windows confinement canary uses PowerShell 5.1 compatible UTF-8 writing", () => {
  const command = windowsConfinementCanaryCommand({
    workspaceDir: "C:/workspace",
    forbiddenFile: "C:/sealed/secret.txt",
    junctionFile: "C:/workspace/junction/secret.txt",
    expectedSecret: "secret",
  });

  assert.doesNotMatch(command, /utf8NoBOM/);
  assert.match(
    command,
    /\[System\.IO\.File\]::WriteAllText\([^\n]+New-Object System\.Text\.UTF8Encoding\(\$false\)\)/,
  );
});

test("ACL application rolls back a target when post-deny verification fails", async () => {
  const { campaignRoot, receiptDir } = await fixture();
  const calls = [];
  const before = new Map();
  let firstTarget;
  let firstTargetReadCount = 0;

  const currentSddl = async (path) => {
    const name = basename(path);
    const value = before.get(name) ?? `before:${name}`;
    before.set(name, value);
    if (name === "contracts") {
      firstTargetReadCount += 1;
      if (firstTargetReadCount === 2) {
        firstTarget = path;
        throw new Error("post-deny ACL read failed");
      }
    }
    return value;
  };
  const captureProcess = async (_file, args) => {
    calls.push(args);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const restoreSddl = async (path, sddl) => {
    calls.push([path, "restore-sddl", sddl]);
  };

  await assert.rejects(
    applyCoordinatorAclLease({
      campaignRoot,
      receiptDir,
      runtime: {
        platform: "win32",
        captureProcess,
        currentSddl,
        restoreSddl,
      },
    }),
    /post-deny ACL read failed/,
  );

  assert.ok(firstTarget);
  assert.deepEqual(calls, [
    [firstTarget, "/deny", "CodexSandboxUsers:(OI)(CI)(RX)"],
    [firstTarget, "restore-sddl", "before:contracts"],
  ]);
});

test("ACL application fails closed when exact SDDL rollback fails", async () => {
  const { campaignRoot, receiptDir } = await fixture();
  let firstTarget;
  let firstTargetReadCount = 0;
  const currentSddl = async (path) => {
    if (basename(path) === "contracts") {
      firstTargetReadCount += 1;
      if (firstTargetReadCount === 2) {
        firstTarget = path;
        throw new Error("post-deny ACL read failed");
      }
    }
    return `before:${basename(path)}`;
  };
  const captureProcess = async (_file, args) => {
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const restoreSddl = async () => {
    throw new Error("exact restore failed");
  };

  await assert.rejects(
    applyCoordinatorAclLease({
      campaignRoot,
      receiptDir,
      runtime: {
        platform: "win32",
        captureProcess,
        currentSddl,
        restoreSddl,
      },
    }),
    (error) =>
      error instanceof AggregateError &&
      /application failed and rollback failed/.test(error.message) &&
      /exact restore failed/.test(error.message),
  );
  assert.ok(firstTarget);
  await assert.rejects(readFile(resolve(receiptDir, "acl-applied.json")));
});

test("ACL application treats a failed deny command as potentially mutating", async () => {
  const { campaignRoot, receiptDir } = await fixture();
  const restored = [];
  const currentSddl = async (path) => `before:${basename(path)}`;
  const captureProcess = async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "deny timed out after partial inheritance",
  });
  const restoreSddl = async (path, sddl) => restored.push({ path, sddl });

  await assert.rejects(
    applyCoordinatorAclLease({
      campaignRoot,
      receiptDir,
      runtime: {
        platform: "win32",
        captureProcess,
        currentSddl,
        restoreSddl,
      },
    }),
    /deny timed out after partial inheritance/,
  );

  assert.deepEqual(restored, [
    {
      path: resolve(campaignRoot, "contracts"),
      sddl: "before:contracts",
    },
  ]);
});

test("ACL application rolls back every target when the applied receipt cannot be written", async () => {
  const { campaignRoot, receiptDir } = await fixture();
  const readCounts = new Map();
  const restored = [];
  const events = [];
  const receiptError = new Error("acl-applied receipt write failed");
  const currentSddl = async (path) => {
    const name = basename(path);
    const count = (readCounts.get(name) ?? 0) + 1;
    readCounts.set(name, count);
    return count === 2 ? `after:${name}` : `before:${name}`;
  };
  const captureProcess = async (_file, args) => {
    events.push(`deny:${basename(args[0])}`);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const restoreSddl = async (path, sddl) => restored.push({ path, sddl });
  const writeReceipt = async (path, value) => {
    const name = basename(path);
    events.push(`write:${name}`);
    if (name === "acl-applied.json") throw receiptError;
    await writeJson(path, value);
  };

  await assert.rejects(
    applyCoordinatorAclLease({
      campaignRoot,
      receiptDir,
      runtime: {
        platform: "win32",
        captureProcess,
        currentSddl,
        restoreSddl,
        writeJson: writeReceipt,
      },
    }),
    (error) => error === receiptError,
  );

  assert.deepEqual(events, [
    "write:acl-lease.json",
    "deny:contracts",
    "deny:prepared",
    "deny:sealed",
    "deny:subjects",
    "write:acl-applied.json",
  ]);
  assert.deepEqual(
    restored,
    [...TARGET_NAMES].reverse().map((name) => ({
      path: resolve(campaignRoot, name),
      sddl: `before:${name}`,
    })),
  );
  await assert.rejects(readFile(resolve(receiptDir, "acl-applied.json")));
});

test("successful ACL lease restores the exact original access SDDL", async () => {
  const { campaignRoot, receiptDir } = await fixture();
  const readCounts = new Map();
  const restored = [];
  const currentSddl = async (path) => {
    const name = basename(path);
    const count = (readCounts.get(name) ?? 0) + 1;
    readCounts.set(name, count);
    if (count === 2) return `after:${name}`;
    return `before:${name}`;
  };
  const captureProcess = async () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  const restoreSddl = async (path, sddl) => restored.push({ path, sddl });

  const lease = await applyCoordinatorAclLease({
    campaignRoot,
    receiptDir,
    runtime: {
      platform: "win32",
      captureProcess,
      currentSddl,
      restoreSddl,
    },
  });
  const result = await lease.restore();

  assert.equal(result.status, "restored");
  assert.deepEqual(
    restored,
    [...TARGET_NAMES].reverse().map((name) => ({
      path: resolve(campaignRoot, name),
      sddl: `before:${name}`,
    })),
  );
  assert.equal(
    JSON.parse(await readFile(resolve(receiptDir, "acl-restored.json"))).status,
    "restored",
  );
});

test("ACL restore retries safely when the restored receipt write fails", async () => {
  const { campaignRoot, receiptDir } = await fixture();
  const readCounts = new Map();
  const restored = [];
  const receiptError = new Error("restored receipt write failed");
  let restoredReceiptWrites = 0;
  const currentSddl = async (path) => {
    const name = basename(path);
    const count = (readCounts.get(name) ?? 0) + 1;
    readCounts.set(name, count);
    return count === 2 ? `after:${name}` : `before:${name}`;
  };
  const captureProcess = async () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  const restoreSddl = async (path, sddl) => restored.push({ path, sddl });
  const writeReceipt = async (path, value) => {
    if (basename(path) === "acl-restored.json") {
      restoredReceiptWrites += 1;
      if (restoredReceiptWrites === 1) throw receiptError;
    }
    await writeJson(path, value);
  };
  const lease = await applyCoordinatorAclLease({
    campaignRoot,
    receiptDir,
    runtime: {
      platform: "win32",
      captureProcess,
      currentSddl,
      restoreSddl,
      writeJson: writeReceipt,
    },
  });

  await assert.rejects(lease.restore(), (error) => error === receiptError);
  const result = await lease.restore();

  assert.equal(result.status, "restored");
  assert.match(result.receipt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(restoredReceiptWrites, 2);
  assert.deepEqual(
    restored,
    [...TARGET_NAMES, ...TARGET_NAMES].reverse().map((name) => ({
      path: resolve(campaignRoot, name),
      sddl: `before:${name}`,
    })),
  );
});
