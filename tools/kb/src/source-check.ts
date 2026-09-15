import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { promisify } from "node:util";
import { assertNoSymlinks, safeResolve, sha256File } from "./fs.js";
import type { Diagnostic, SourceBaseline } from "./types.js";

const exec = promisify(execFile);
const LIMIT = 32;
const limitation =
  "Change signals request local review; unchanged baselines do not prove prose correct, and code drift does not override adopted policy. checked_at is never updated by check.";

async function git(root: string, args: string[]): Promise<string> {
  const result = await exec("git", args, {
    cwd: root,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout;
}

export async function checkSources(
  root: string,
  sources: SourceBaseline[] | undefined,
  documentPath: string,
  verificationRefs: string[] = [],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const source of sources ?? []) {
    const report = (
      code: string,
      message: string,
      paths: string[] = [],
      reason?: string,
    ) => {
      const sorted = [...new Set(paths)].sort();
      diagnostics.push({
        code,
        severity: "warning",
        path: documentPath,
        message,
        details: {
          source: source.path,
          baseline: source.checked_at,
          changed_paths: sorted.slice(0, LIMIT),
          omitted_count: Math.max(0, sorted.length - LIMIT),
          verification_refs: verificationRefs.slice(0, LIMIT),
          verification_refs_omitted: Math.max(
            0,
            verificationRefs.length - LIMIT,
          ),
          review: `Read ${documentPath}, inspect affected sources and its existing verification section.`,
          limitation,
          ...(reason ? { reason } : {}),
        },
      });
    };
    const hasGlob = /[*?\[]/.test(source.path);
    let missing = false;
    try {
      const absolute = safeResolve(root, source.path);
      await assertNoSymlinks(
        root,
        hasGlob ? source.path.split(/[*?\[]/, 1)[0]! : absolute,
      );
      if (!hasGlob) {
        try {
          const info = await lstat(absolute);
          if (
            !info.isFile() &&
            !(info.isDirectory() && source.checked_at.startsWith("git:"))
          ) {
            report(
              "SOURCE_BASELINE_UNAVAILABLE",
              `Source is not a regular file: ${source.path}`,
              [],
              "unsupported-file-type",
            );
            continue;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          missing = true;
          report("SOURCE_MISSING", `Source is missing: ${source.path}`, [
            source.path,
          ]);
        }
      }
      if (source.checked_at.startsWith("sha256:")) {
        if (hasGlob)
          report(
            "SOURCE_BASELINE_UNAVAILABLE",
            `A SHA-256 baseline requires one regular file: ${source.path}`,
            [],
            "glob-sha256-unsupported",
          );
        else if (
          !missing &&
          (await sha256File(absolute)) !== source.checked_at.slice(7)
        )
          report("SOURCE_CHANGED", `Source content changed: ${source.path}`, [
            source.path,
          ]);
        continue;
      }
      if (!source.checked_at.startsWith("git:")) {
        report(
          "SOURCE_BASELINE_UNAVAILABLE",
          `Unsupported source baseline: ${source.checked_at}`,
          [],
          "unsupported-baseline",
        );
        continue;
      }
      const commit = source.checked_at.slice(4);
      await git(root, ["cat-file", "-e", `${commit}^{commit}`]);
      const suffix = ["--", `:(${hasGlob ? "glob" : "literal"})${source.path}`];
      const split = (s: string) => s.split("\0").filter(Boolean);
      const [current, changed, untracked, deleted] = (
        await Promise.all([
          git(root, [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            ...suffix,
          ]),
          git(root, [
            "diff",
            "--no-renames",
            "--name-only",
            "-z",
            commit,
            ...suffix,
          ]),
          git(root, [
            "ls-files",
            "-z",
            "--others",
            "--exclude-standard",
            ...suffix,
          ]),
          git(root, ["ls-files", "-z", "--deleted", ...suffix]),
        ])
      ).map(split);
      const paths = [...changed!, ...untracked!, ...deleted!];
      if (
        !missing &&
        current!.filter((p) => !deleted!.includes(p)).length === 0
      )
        report(
          "SOURCE_MISSING",
          `Git source pathspec matches no current file: ${source.path}`,
          paths,
        );
      else if (!missing && paths.length)
        report(
          "SOURCE_CHANGED",
          `Source changed since ${commit}: ${source.path}`,
          paths,
        );
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      report(
        "SOURCE_BASELINE_UNAVAILABLE",
        `Source baseline could not be inspected: ${source.path}`,
        [],
        typeof code === "string" ? code : "git-baseline-or-command-unavailable",
      );
    }
  }
  return diagnostics;
}
