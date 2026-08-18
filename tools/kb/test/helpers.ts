import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export async function tempProject(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), "self-evolution-kb-"));
}

export async function put(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export const guide = (overrides = "") => `---
kind: guide
status: active
scope:
  - "src/payments/**"
use_when:
  - "changing payments"
${overrides}---
# Payments

Read [source](../../../src/payments/index.ts).
`;

export const decision = `---
kind: decision
id: adr-001-cache
status: accepted
date: 2026-07-31
scope:
  - "src/cache/**"
supersedes: null
---
# Use Cache
`;
