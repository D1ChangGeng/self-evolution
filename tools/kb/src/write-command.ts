import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertNoSymlinks,
  atomicWrite,
  pathExists,
  recoverInterruptedWrite,
  safeResolve,
  sha256File,
  withKnowledgeLock,
} from "./fs.js";
import { parseMarkdown } from "./markdown.js";
import { validateDecision, validateGuide } from "./schema.js";
import { KbError, type CommandResult } from "./types.js";

// Expected digests are mandatory, including `absent` for creation. Input is a
// separate proposal file so conflicts retain both proposal and current content.
export async function writeCommand(
  root: string,
  target: string,
  input: string,
  expected: string,
): Promise<CommandResult> {
  if (
    !/^\.agents\/knowledge\/(guides|decisions|observations|archive)\/.+\.md$/.test(
      target,
    ) ||
    target.includes("\\") ||
    target.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new KbError(
      "write targets a Markdown knowledge document under an existing v2 category.",
      2,
      "USAGE",
    );
  if (expected !== "absent" && !/^[a-f0-9]{64}$/.test(expected))
    throw new KbError(
      "Expected digest must be sha256 hex or absent.",
      2,
      "USAGE",
    );
  const destination = safeResolve(root, target);
  const proposal = safeResolve(root, input);
  if (destination === proposal)
    throw new KbError("Proposal must be separate from target.", 2, "USAGE");
  await assertNoSymlinks(root, proposal);
  const bytes = await readFile(proposal);
  if (target.includes("/guides/") || target.includes("/decisions/")) {
    const parsed = parseMarkdown(bytes.toString("utf8"), target);
    const validation = target.includes("/decisions/")
      ? validateDecision(parsed.data, target)
      : validateGuide(parsed.data, target);
    const diagnostics = [...parsed.diagnostics, ...validation.diagnostics];
    if (diagnostics.length)
      return { command: "write", ok: false, exitCode: 2, diagnostics };
  }
  return withKnowledgeLock(root, async () => {
    await assertNoSymlinks(root, destination);
    const recovered = await recoverInterruptedWrite(destination);
    const actual = (await pathExists(destination))
      ? await sha256File(destination)
      : "absent";
    if (actual !== expected)
      throw new KbError(
        `Target changed; retain ${input}, reread ${target}, merge and retry with its current digest.`,
        3,
        "CONCURRENT_WRITE",
      );
    const changed = await atomicWrite(destination, bytes);
    return {
      command: "write",
      ok: true,
      changed,
      data: {
        recovered_temporary_files: recovered,
        path: target,
        sha256: await sha256File(destination),
        index: "Rebuild when routing metadata or membership changed.",
      },
    };
  });
}
