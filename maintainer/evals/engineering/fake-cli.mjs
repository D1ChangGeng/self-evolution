// Deliberate deterministic CLI used only in offline runner tests. Patch inputs
// are outside agent project and are never exposed to actual model adapters.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { safe, noLinks } from "./workspace.mjs";
if (process.argv[2] === "--version") {
  console.log("self-evolution-fake-cli/1");
  process.exit(0);
}
if (process.argv[2] === "--help") {
  console.log("--request <file>; offline deterministic patch driver");
  process.exit(0);
}
const request = JSON.parse(await readFile(process.argv[3], "utf8"));
if (request.fail) process.exit(17);
for (const item of request.patch) {
  const path = safe(process.cwd(), item.path);
  await noLinks(process.cwd(), item.path);
  if (item.content === null) await rm(path, { force: true });
  else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, item.content);
  }
  console.log(JSON.stringify({ type: "tool", name: "write", path: item.path }));
}
console.log(JSON.stringify({ type: "stage-ready", pid: process.pid }));
if (request.hang) setInterval(() => {}, 1000);
