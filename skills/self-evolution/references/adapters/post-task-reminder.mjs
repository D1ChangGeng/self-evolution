import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function postTaskReminder() {
  return [
    "[self-evolution] Before finishing, decide whether this task produced durable project knowledge:",
    "1. What did this work reveal that will still change a future action?",
    "2. Is that knowledge already expressed better in code, tests, configuration, or existing docs?",
    "3. Is saving it worth the future retrieval and maintenance cost?",
    "Correct an existing guide directly when possible; otherwise capture only a sourced, scoped observation.",
  ].join("\n");
}

function main() {
  try {
    process.stdout.write(`${postTaskReminder()}\n`);
  } catch {
    // Optional reminders must never block the host tool.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
