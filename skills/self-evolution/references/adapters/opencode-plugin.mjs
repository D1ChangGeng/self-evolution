import { readFileSync } from "node:fs";

const defaultFeatures = {
  context_recovery: false,
  post_task_reminder: false,
};

function readFeatures() {
  try {
    const parsed = JSON.parse(
      readFileSync(new URL("./features.json", import.meta.url), "utf8"),
    );

    return {
      context_recovery:
        typeof parsed?.context_recovery === "boolean"
          ? parsed.context_recovery
          : defaultFeatures.context_recovery,
      post_task_reminder:
        typeof parsed?.post_task_reminder === "boolean"
          ? parsed.post_task_reminder
          : defaultFeatures.post_task_reminder,
    };
  } catch {
    return defaultFeatures;
  }
}

export default async () => ({
  event: async (input) => {
    try {
      const features = readFeatures();
      if (
        features.post_task_reminder &&
        input?.event?.type === "session.idle"
      ) {
        const { postTaskReminder } = await import("./post-task-reminder.mjs");
        process.stderr.write(`${postTaskReminder()}\n`);
      }
    } catch {
      // Adapter failures must not affect the OpenCode session.
    }
  },

  "experimental.session.compacting": async (_input, output) => {
    try {
      const features = readFeatures();
      if (features.context_recovery && output?.context) {
        const { contextRecoveryReminder } = await import(
          "./context-recovery.mjs"
        );
        output.context = `${contextRecoveryReminder()}\n\n${output.context}`;
      }
    } catch {
      // Adapter failures must not affect context compaction.
    }
  },
});
