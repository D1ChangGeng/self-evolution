import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCommand } from "../src/check.js";
import { indexCommand } from "../src/index-command.js";
import { initCommand } from "../src/init.js";
import { atomicWrite, safeResolve } from "../src/fs.js";
import { decision, guide, put, tempProject } from "./helpers.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { run } from "../src/cli.js";

describe("core CLI behavior", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes the minimum v2 structure idempotently", async () => {
    const root = await tempProject();
    const first = await initCommand(root);
    const second = await initCommand(root);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    await expect(stat(resolve(root, "AGENTS.md"))).resolves.toBeTruthy();
    await expect(
      stat(resolve(root, ".agents/settings.yaml")),
    ).resolves.toBeTruthy();
    await expect(
      stat(resolve(root, ".agents/knowledge/index.yaml")),
    ).resolves.toBeTruthy();
    await expect(
      stat(resolve(root, ".agents/knowledge/guides")),
    ).rejects.toThrow();
  });

  it("builds a stable, sorted current-only index", async () => {
    const root = await tempProject();
    await initCommand(root);
    await put(root, ".agents/knowledge/guides/z.md", guide());
    await put(root, ".agents/knowledge/decisions/a.md", decision);
    const first = await indexCommand(root);
    const content = await readFile(
      resolve(root, ".agents/knowledge/index.yaml"),
      "utf8",
    );
    const second = await indexCommand(root);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(content.indexOf("decisions/a.md")).toBeLessThan(
      content.indexOf("guides/z.md"),
    );
    expect(content).not.toContain("generated_at");
  });

  it("reports link, duplicate routing, and index drift findings", async () => {
    const root = await tempProject();
    await initCommand(root);
    await put(root, ".agents/knowledge/guides/a.md", guide());
    await put(root, ".agents/knowledge/guides/b.md", guide());
    const result = await checkCommand(root);
    expect(result.ok).toBe(false);
    expect(result.diagnostics?.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "BROKEN_LINK",
        "DUPLICATE_ROUTING",
        "INDEX_DRIFT",
      ]),
    );
  });

  it("rejects unknown frontmatter and settings fields", async () => {
    const root = await tempProject();
    await initCommand(root);
    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide("unknown_field: true\n"),
    );
    await put(
      root,
      ".agents/settings.yaml",
      `schema_version: "2.0"\nrouting: { generate_scope_rules: false }\nadapters: { active: {} }\nunknown: true\n`,
    );
    const result = await checkCommand(root);
    expect(result.diagnostics?.map((item) => item.code)).toEqual(
      expect.arrayContaining(["FRONTMATTER_FIELD_UNKNOWN", "SETTINGS_INVALID"]),
    );
  });

  it("rejects path traversal and avoids rewriting identical bytes", async () => {
    const root = await tempProject();
    expect(() => safeResolve(root, "../escape")).toThrow();
    const path = resolve(root, "same.txt");
    expect(await atomicWrite(path, "same\n")).toBe(true);
    expect(await atomicWrite(path, "same\n")).toBe(false);
  });

  it("checks a Git baseline for a glob without treating it as a literal missing path", async () => {
    const root = await tempProject();
    const exec = promisify(execFile);
    await exec("git", ["init", "-q"], { cwd: root });
    await exec("git", ["config", "user.email", "test@example.invalid"], {
      cwd: root,
    });
    await exec("git", ["config", "user.name", "Test"], { cwd: root });
    await put(root, "src/payments/index.ts", "export const amount = 1;\n");
    await exec("git", ["add", "."], { cwd: root });
    await exec("git", ["commit", "-qm", "baseline"], { cwd: root });
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
    await initCommand(root);
    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide(
        `sources:\n  - path: "src/payments/**"\n    checked_at: "git:${stdout.trim()}"\n`,
      ),
    );
    await indexCommand(root);
    const result = await checkCommand(root);
    expect(
      result.diagnostics?.some((item) => item.code === "SOURCE_MISSING"),
    ).toBe(false);
  });

  it("fails check for warning findings and uses exit 2 for invalid input", async () => {
    const root = await tempProject();
    await initCommand(root);
    await put(root, "src/payments/index.ts", "export const amount = 1;\n");
    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide(
        `sources:\n  - path: "missing.ts"\n    checked_at: "sha256:${"0".repeat(64)}"\n`,
      ),
    );
    await indexCommand(root);
    const warning = await checkCommand(root);
    expect(warning.ok).toBe(false);
    expect(warning.exitCode).toBe(1);
    expect(
      warning.diagnostics?.some((item) => item.code === "SOURCE_MISSING"),
    ).toBe(true);
    expect(
      await run(["check", "--project-root", root, "--format", "json"]),
    ).toBe(1);

    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide("unknown_field: true\n"),
    );
    const invalid = await checkCommand(root);
    expect(invalid.exitCode).toBe(2);
    expect(
      await run(["check", "--project-root", root, "--format", "json"]),
    ).toBe(2);
  });

  it("warns when a scope matches no project file and ignores internal generated files", async () => {
    const root = await tempProject();
    await initCommand(root);
    await put(root, "src/app.ts", "export {};\n");
    await put(root, "node_modules/ignored/package.ts", "export {};\n");
    await put(root, ".git/ignored.ts", "ignored\n");
    await put(root, ".agents/generated/rules/ignored.ts", "generated\n");
    await put(root, ".agents/.migrations/run/ignored.ts", "generated\n");
    await put(root, ".agents/legacy/v1/ignored.ts", "generated\n");
    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide().replace(
        '  - "src/payments/**"',
        '  - "src/**/*.ts"\n  - "src/app.ts"\n  - "missing.ts"\n  - "node_modules/**"\n  - ".git/**"\n  - ".agents/knowledge/**"\n  - ".agents/generated/**"\n  - ".agents/.migrations/**"\n  - ".agents/legacy/**"',
      ),
    );
    await indexCommand(root);
    const result = await checkCommand(root);
    const missingScopes =
      result.diagnostics
        ?.filter((item) => item.code === "SCOPE_MISSING")
        .map((item) => item.message) ?? [];
    expect(missingScopes).toHaveLength(7);
    expect(missingScopes.join("\n")).toContain("missing.ts");
    expect(missingScopes.join("\n")).toContain("node_modules/**");
    expect(missingScopes.join("\n")).toContain(".git/**");
    expect(missingScopes.join("\n")).toContain(".agents/knowledge/**");
    expect(missingScopes.join("\n")).toContain(".agents/generated/**");
    expect(missingScopes.join("\n")).toContain(".agents/.migrations/**");
    expect(missingScopes.join("\n")).toContain(".agents/legacy/**");
    expect(missingScopes.join("\n")).not.toContain("src/**/*.ts");
    expect(missingScopes.join("\n")).not.toContain("src/app.ts");
  });

  it("distinguishes a missing Git pathspec and detects matching untracked files", async () => {
    const root = await tempProject();
    const exec = promisify(execFile);
    await exec("git", ["init", "-q"], { cwd: root });
    await exec("git", ["config", "user.email", "test@example.invalid"], {
      cwd: root,
    });
    await exec("git", ["config", "user.name", "Test"], { cwd: root });
    await put(root, "src/payments/index.ts", "export const amount = 1;\n");
    await exec("git", ["add", "."], { cwd: root });
    await exec("git", ["commit", "-qm", "baseline"], { cwd: root });
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
    await initCommand(root);

    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide(
        `sources:\n  - path: "missing/**/*.ts"\n    checked_at: "git:${stdout.trim()}"\n`,
      ),
    );
    await indexCommand(root);
    const missing = await checkCommand(root);
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SOURCE_MISSING", severity: "warning" }),
    );

    await put(root, "src/payments/new.ts", "export const added = true;\n");
    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide(
        `sources:\n  - path: "src/payments/**/*.ts"\n    checked_at: "git:${stdout.trim()}"\n`,
      ),
    );
    await indexCommand(root);
    const changed = await checkCommand(root);
    expect(changed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SOURCE_CHANGED", severity: "warning" }),
    );
  });

  it("rejects a sha256 baseline for a glob", async () => {
    const root = await tempProject();
    await initCommand(root);
    await put(root, "src/payments/index.ts", "export const amount = 1;\n");
    await put(
      root,
      ".agents/knowledge/guides/a.md",
      guide(
        `sources:\n  - path: "src/payments/**/*.ts"\n    checked_at: "sha256:${"0".repeat(64)}"\n`,
      ),
    );
    await indexCommand(root);
    const result = await checkCommand(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SOURCE_BASELINE_UNAVAILABLE",
        severity: "warning",
      }),
    );
  });
});
