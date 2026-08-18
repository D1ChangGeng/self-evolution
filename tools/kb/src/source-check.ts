import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathExists, safeResolve, sha256File } from "./fs.js";
import type { Diagnostic, SourceBaseline } from "./types.js";

const execFileAsync = promisify(execFile);

function gitPathspec(path: string, hasGlob: boolean): string {
  return hasGlob ? `:(top,glob)${path}` : `:(top,literal)${path}`;
}

async function gitPaths(
  projectRoot: string,
  args: string[],
): Promise<string[]> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    windowsHide: true,
  });
  return stdout.split(/\r?\n/).filter(Boolean);
}

export async function checkSources(
  projectRoot: string,
  sources: SourceBaseline[] | undefined,
  documentPath: string,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const source of sources ?? []) {
    let absolute: string;
    try {
      absolute = safeResolve(projectRoot, source.path);
    } catch {
      diagnostics.push({
        code: "SOURCE_MISSING",
        severity: "warning",
        message: `Source escapes project root: ${source.path}`,
        path: documentPath,
      });
      continue;
    }
    const hasGlob = /[*?\[]/.test(source.path);
    if (!hasGlob && !(await pathExists(absolute))) {
      diagnostics.push({
        code: "SOURCE_MISSING",
        severity: "warning",
        message: `Source is missing: ${source.path}`,
        path: documentPath,
      });
      continue;
    }
    if (source.checked_at.startsWith("sha256:")) {
      if (hasGlob) {
        diagnostics.push({
          code: "SOURCE_BASELINE_UNAVAILABLE",
          severity: "warning",
          message: `A sha256 baseline requires one concrete file: ${source.path}`,
          path: documentPath,
        });
        continue;
      }
      const expected = source.checked_at.slice("sha256:".length).toLowerCase();
      const actual = await sha256File(absolute);
      if (actual !== expected)
        diagnostics.push({
          code: "SOURCE_CHANGED",
          severity: "warning",
          message: `Source content changed: ${source.path}`,
          path: documentPath,
        });
      continue;
    }
    if (source.checked_at.startsWith("git:")) {
      const commit = source.checked_at.slice("git:".length);
      try {
        const relativePath = source.path.replaceAll("\\", "/");
        const pathspec = gitPathspec(relativePath, hasGlob);
        await execFileAsync("git", ["cat-file", "-e", `${commit}^{commit}`], {
          cwd: projectRoot,
          windowsHide: true,
        });
        const suffix = ["--", pathspec];
        const [currentFiles, changedFiles, untrackedFiles, deletedFiles] =
          await Promise.all([
            gitPaths(projectRoot, [
              "ls-files",
              "--cached",
              "--others",
              "--exclude-standard",
              ...suffix,
            ]),
            gitPaths(projectRoot, ["diff", "--name-only", commit, ...suffix]),
            gitPaths(projectRoot, [
              "ls-files",
              "--others",
              "--exclude-standard",
              ...suffix,
            ]),
            gitPaths(projectRoot, ["ls-files", "--deleted", ...suffix]),
          ]);
        const deleted = new Set(deletedFiles);
        const currentMatches = currentFiles.filter(
          (path) => !deleted.has(path),
        );
        if (currentMatches.length === 0) {
          diagnostics.push({
            code: "SOURCE_MISSING",
            severity: "warning",
            message: `Git source pathspec does not match any file: ${source.path}`,
            path: documentPath,
          });
        } else if (changedFiles.length > 0 || untrackedFiles.length > 0) {
          diagnostics.push({
            code: "SOURCE_CHANGED",
            severity: "warning",
            message: `Source changed since ${commit}: ${source.path}`,
            path: documentPath,
          });
        }
      } catch {
        diagnostics.push({
          code: "SOURCE_BASELINE_UNAVAILABLE",
          severity: "warning",
          message: `Git baseline is unavailable: ${source.checked_at}`,
          path: documentPath,
        });
      }
      continue;
    }
    diagnostics.push({
      code: "SOURCE_BASELINE_UNAVAILABLE",
      severity: "warning",
      message: `Unsupported source baseline: ${source.checked_at}`,
      path: documentPath,
    });
  }
  return diagnostics;
}
