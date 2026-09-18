import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { launch } from "./process.mjs";
import { isolatedEnv } from "./harness.mjs";
import { digest, materialize, initGit, git } from "./workspace.mjs";

export async function concurrentProbe({ root, isolated, cli }) {
  const project = resolve(root, "project");
  await mkdir(project, { recursive: true });
  const seed =
    "---\nkind: guide\nstatus: active\nscope: [src/sum.mjs]\nuse_when: [changing sums]\n---\n# Sum\nExisting rule.\n";
  const target = ".agents/knowledge/guides/shared.md";
  await materialize(project, [
    { path: target, content: seed },
    {
      path: "src/sum.mjs",
      content: "export const sum=values=>values.reduce((a,b)=>a+b,0);\n",
    },
    { path: "unrelated.txt", content: "preserve user work\n" },
  ]);
  await initGit(project);
  await writeFile(resolve(project, "one.md"), seed + "Writer one.\n");
  await writeFile(resolve(project, "two.md"), seed + "Writer two.\n");
  let second = project;
  if (isolated) {
    // Actual Git worktree: separate branch identity and physical document root.
    second = resolve(root, "worktree");
    await git(project, [
      "worktree",
      "add",
      "-b",
      "independent",
      second,
      "HEAD",
    ]);
    await writeFile(resolve(second, "two.md"), seed + "Writer two.\n");
  }
  const run = async (workspace, proposal, index) =>
    launch({
      binary: process.execPath,
      args: [
        cli,
        "write",
        target,
        proposal,
        digest(seed),
        "--project-root",
        workspace,
        "--format",
        "json",
      ],
      cwd: workspace,
      env: isolatedEnv(root, root),
      artifactRoot: resolve(root, `writer-${index}`),
      timeoutMs: 10000,
    });
  const receipts = await Promise.all([
    run(project, "one.md", 1),
    run(second, "two.md", 2),
  ]);
  const codes = receipts.map((r) => r.exit_code).sort();
  const expected = isolated ? [0, 0] : [0, 3];
  if (JSON.stringify(codes) !== JSON.stringify(expected))
    throw new Error(
      "Concurrent write did not preserve controlled-write contract",
    );
  const current = await readFile(resolve(project, target), "utf8");
  if (![seed + "Writer one.\n", seed + "Writer two.\n"].includes(current))
    throw new Error("Partial/corrupt concurrent target");
  if (!isolated) {
    const loser = receipts.findIndex((r) => r.exit_code === 3) + 1;
    if (
      !(
        await readFile(resolve(root, `writer-${loser}/stderr.txt`), "utf8")
      ).includes("CONCURRENT_WRITE")
    )
      throw new Error("Missing explicit conflict diagnostic");
  }
  if (
    (await readFile(resolve(project, "unrelated.txt"), "utf8")) !==
    "preserve user work\n"
  )
    throw new Error("Unrelated work lost");
  return {
    status: "pass",
    probe: isolated ? "worktree-isolation" : "cas-conflict",
    receipts,
    branches: isolated
      ? [
          await git(project, ["branch", "--show-current"]),
          await git(second, ["branch", "--show-current"]),
        ]
      : [await git(project, ["branch", "--show-current"])],
  };
}
