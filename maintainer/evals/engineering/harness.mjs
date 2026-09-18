import { readFile, mkdir, cp, realpath, lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { launch } from "./process.mjs";
import { digest } from "./workspace.mjs";

export function isolatedEnv(home, cache, extra = {}) {
  const env = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "TEMP",
    "TMP",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: home,
    XDG_CONFIG_HOME: resolve(home, "config"),
    XDG_DATA_HOME: resolve(home, "data"),
    XDG_CACHE_HOME: cache,
    TMPDIR: cache,
    TMP: cache,
    TEMP: cache,
    ...extra,
  };
}
export async function probeBinary(binary, artifactRoot) {
  if (!isAbsolute(binary))
    throw new Error(
      "Harness requires an absolute native executable path; resolve command shims first",
    );
  const resolved = await realpath(binary);
  if (!(await lstat(resolved)).isFile() || /\.(cmd|bat|ps1)$/i.test(resolved))
    throw new Error("Select a native executable rather than a shell shim");
  const hash = digest(await readFile(resolved));
  await mkdir(artifactRoot, { recursive: true });
  const result = await launch({
    binary: resolved,
    args: ["--version"],
    cwd: artifactRoot,
    env: isolatedEnv(artifactRoot, artifactRoot),
    artifactRoot: resolve(artifactRoot, "version"),
    timeoutMs: 15000,
  });
  const help = await launch({
    binary: resolved,
    args: ["--help"],
    cwd: artifactRoot,
    env: isolatedEnv(artifactRoot, artifactRoot),
    artifactRoot: resolve(artifactRoot, "help"),
    timeoutMs: 15000,
  });
  return {
    path: resolved,
    sha256: hash,
    revision:
      result.exit_code === 0
        ? (
            await readFile(resolve(artifactRoot, "version/stdout.txt"), "utf8")
          ).trim()
        : "unavailable",
    version_exit: result.exit_code,
    help_exit: help.exit_code,
  };
}
export async function probeCommandHelp(config, artifactRoot) {
  const args =
    config.name === "codex"
      ? ["exec", "--help"]
      : config.name === "opencode"
        ? ["run", "--help"]
        : ["--help"];
  const result = await launch({
    binary: config.binary,
    args,
    cwd: artifactRoot,
    env: isolatedEnv(artifactRoot, artifactRoot),
    artifactRoot: resolve(artifactRoot, "command-help"),
    timeoutMs: 15000,
  });
  const help = await readFile(
    resolve(artifactRoot, "command-help/stdout.txt"),
    "utf8",
  );
  const required =
    config.name === "codex"
      ? ["--ephemeral", "--json", "--sandbox"]
      : config.name === "opencode"
        ? ["--pure", "--format", "--model"]
        : [
            "--no-session-persistence",
            "--setting-sources",
            "--strict-mcp-config",
          ];
  if (result.exit_code !== 0 || required.some((flag) => !help.includes(flag)))
    throw new Error("Installed harness does not expose required command flags");
  return result;
}
export function modelCommand({ name, binary, model, prompt, output }) {
  if (!model) throw new Error("Explicit model alias is required");
  if (name === "codex")
    return {
      binary,
      args: [
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "-m",
        model,
        "-o",
        output,
        "-",
      ],
      input: prompt,
    };
  if (name === "claude-code")
    return {
      binary,
      args: [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        "--permission-mode",
        "dontAsk",
        "--model",
        model,
      ],
      input: "",
    };
  if (name === "opencode")
    return {
      binary,
      args: ["run", "--pure", "--format", "json", "--model", model, prompt],
      input: "",
    };
  throw new Error(`Unsupported harness: ${name}`);
}
export function authorizeModelRun(config) {
  const budget = config?.budget;
  if (
    !config?.authorized ||
    !config?.model ||
    !config?.binary ||
    !Number.isSafeInteger(budget?.max_sessions) ||
    budget.max_sessions < 1 ||
    !Number.isSafeInteger(budget?.session_timeout_ms) ||
    budget.session_timeout_ms < 1 ||
    !Number.isSafeInteger(budget?.total_timeout_ms) ||
    budget.total_timeout_ms < budget.session_timeout_ms
  )
    throw new Error(
      "Model campaign requires explicit authorization, model and session/total limits",
    );
  // A separate worktree or host HOME is not an OS boundary. This runtime can
  // collect diagnostic runs, but cannot certify protected model verification
  // without an actually enforced execution boundary.
  if (
    config.profile !== "diagnostic" &&
    config.isolation?.status !== "verified"
  )
    throw new Error(
      "Formal model execution blocked: filesystem/network isolation not verified",
    );
  if (config.profile !== "diagnostic")
    throw new Error(
      "Formal sandbox adapter not available on this executor; supply a validated external execution receipt for release evidence",
    );
  return true;
}
export async function prepareSessionHome(config, home, cache) {
  await mkdir(home, { recursive: true });
  await mkdir(cache, { recursive: true });
  // Nonsecret configuration is explicitly supplied. Credentials remain
  // caller-supplied environment values and are never serialized into receipts.
  for (const f of config.config_files ?? []) {
    if (
      !isAbsolute(f.source) ||
      !["config.toml", "models.json", "opencode.json"].includes(f.name)
    )
      throw new Error("Config file must use the explicit harness allowlist");
    await cp(f.source, resolve(home, f.name), {
      force: false,
      errorOnExist: true,
    });
  }
  const extra = {};
  for (const key of config.credential_env ?? []) {
    if (!/^[A-Z][A-Z0-9_]*(?:KEY|TOKEN)$/.test(key) || !process.env[key])
      throw new Error("Required credential environment unavailable");
    extra[key] = process.env[key];
  }
  return isolatedEnv(home, cache, extra);
}

export function usageFromTrace(raw, harness) {
  const unavailable = { status: "not-measured", value: null };
  let input = 0,
    output = 0,
    cached = 0,
    found = false,
    cachedKnown = true,
    toolCalls = 0;
  for (const line of raw.split(/\r?\n/)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const usage =
      harness === "codex" && event.type === "turn.completed"
        ? event.usage
        : harness === "claude-code" && event.type === "result"
          ? event.usage
          : harness === "opencode" && event.type === "step_finish"
            ? event.part?.tokens
            : null;
    if (usage) {
      const i = usage.input_tokens ?? usage.input,
        o = usage.output_tokens ?? usage.output,
        c =
          usage.cached_input_tokens ??
          usage.cache_read_input_tokens ??
          usage.cache?.read;
      if (
        Number.isSafeInteger(i) &&
        Number.isSafeInteger(o) &&
        i >= 0 &&
        o >= 0
      ) {
        input += i;
        output += o;
        found = true;
        if (Number.isSafeInteger(c) && c >= 0) cached += c;
        else cachedKnown = false;
      }
    }
    if (
      event.type === "tool" ||
      event.type === "tool_use" ||
      (event.type === "item.completed" &&
        ["command_execution", "file_change", "mcp_tool_call"].includes(
          event.item?.type,
        ))
    )
      toolCalls++;
  }
  return {
    input_tokens: found ? { status: "measured", value: input } : unavailable,
    output_tokens: found ? { status: "measured", value: output } : unavailable,
    cached_input_tokens:
      found && cachedKnown
        ? { status: "measured", value: cached }
        : unavailable,
    tool_calls: { status: "measured", value: toolCalls },
  };
}
