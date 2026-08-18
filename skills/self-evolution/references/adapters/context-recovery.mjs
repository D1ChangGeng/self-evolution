import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function contextRecoveryReminder() {
  return [
    "[self-evolution] Context was compacted.",
    "Re-read AGENTS.md, then load only the guides relevant to the current task.",
    "Verify material claims against current code, tests, configuration, or runtime evidence.",
  ].join("\n");
}

function main() {
  try {
    process.stdout.write(`${contextRecoveryReminder()}\n`);
  } catch {
    // Optional reminders must never block the host tool.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
