import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/markdown.js";
import { validateDecision, validateGuide } from "../src/schema.js";

describe("public smoke schema samples", () => {
  it("validates the actual task corpus without importing model clients", async () => {
    const exec = promisify(execFile);
    const script =
      "import ast,json,pathlib; t=ast.parse(pathlib.Path('maintainer/evals/public/run_engineering.py').read_text(encoding='utf8')); print(json.dumps(ast.literal_eval(next(n.value for n in t.body if isinstance(n,ast.Assign) and any(isinstance(v,ast.Name) and v.id=='TASKS' for v in n.targets)))))";
    const result = await exec(
      process.platform === "win32" ? "python" : "python3",
      ["-c", script],
      { cwd: resolve(import.meta.dirname, "../../.."), windowsHide: true },
    );
    const tasks = JSON.parse(result.stdout) as {
      files: Record<string, string>;
    }[];
    let validated = 0;
    for (const task of tasks)
      for (const [path, content] of Object.entries(task.files)) {
        if (!path.startsWith(".agents/knowledge/")) continue;
        const parsed = parseMarkdown(content, path);
        expect(parsed.diagnostics, path).toEqual([]);
        const validatedData = path.includes("/decisions/")
          ? validateDecision(parsed.data, path)
          : validateGuide(parsed.data, path);
        expect(validatedData.diagnostics, path).toEqual([]);
        validated++;
      }
    expect(validated).toBe(3);
  });
  it("labels a deliberately invalid legacy Decision as an expected failure", () => {
    const parsed = parseMarkdown(
      "---\nkind: decision\nstatus: accepted\ndecided_at: 2026-09-01\n---\n# Legacy invalid sample\n",
      "intentional-invalid.md",
    );
    expect(
      validateDecision(parsed.data, "intentional-invalid.md").diagnostics.map(
        (d) => d.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "FRONTMATTER_FIELD_UNKNOWN",
        "DECISION_ID_INVALID",
        "DECISION_DATE_INVALID",
        "SUPERSEDES_INVALID",
      ]),
    );
  });
});
