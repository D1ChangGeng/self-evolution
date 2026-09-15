import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest } from "./workspace.mjs";

export async function launch({
  binary,
  args = [],
  cwd,
  env = {},
  input = "",
  timeoutMs = 20000,
  interruptAfterMs,
  artifactRoot,
  outputLimit = 4 * 1024 * 1024,
}) {
  await mkdir(artifactRoot, { recursive: true });
  const outPath = resolve(artifactRoot, "stdout.txt"),
    errPath = resolve(artifactRoot, "stderr.txt");
  const out = createWriteStream(outPath, { flags: "wx" }),
    err = createWriteStream(errPath, { flags: "wx" });
  const started = performance.now(),
    utc = new Date().toISOString();
  let reason = null,
    count = 0,
    child,
    timer,
    interruption,
    forceTimer;
  const result = await new Promise((resolveResult) => {
    let done = false;
    const terminate = (why) => {
      if (done || reason) return;
      reason = why;
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("error", () => child.kill("SIGKILL"));
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
        forceTimer = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, 200);
      }
    };
    try {
      child = spawn(binary, args, {
        cwd,
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolveResult({
        exit_code: null,
        signal: null,
        error: error.code ?? error.message,
      });
      return;
    }
    for (const [stream, file] of [
      [child.stdout, out],
      [child.stderr, err],
    ])
      stream.on("data", (data) => {
        count += data.length;
        if (count <= outputLimit) file.write(data);
        else terminate("output-limit");
      });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", (error) => {
      reason = "launch-failed";
      err.write(String(error.code ?? error.message));
    });
    child.on("close", (code, signal) => {
      done = true;
      resolveResult({ exit_code: code, signal });
    });
    timer = setTimeout(() => terminate("timeout"), timeoutMs);
    if (interruptAfterMs !== undefined)
      interruption = setTimeout(
        () => terminate("forced-interruption"),
        interruptAfterMs,
      );
  });
  clearTimeout(timer);
  clearTimeout(interruption);
  clearTimeout(forceTimer);
  await Promise.all([
    new Promise((r) => out.end(r)),
    new Promise((r) => err.end(r)),
  ]);
  return {
    ...result,
    pid: child?.pid ?? null,
    started_at: utc,
    duration_ms: Math.round(performance.now() - started),
    stop_reason:
      reason ?? (result.exit_code === 0 ? "normal" : "process-failed"),
    command: { binary, args },
    stdout_sha256: digest(await readFile(outPath)),
    stderr_sha256: digest(await readFile(errPath)),
  };
}
