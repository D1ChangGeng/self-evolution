import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adapterStatus,
  installAdapter,
  removeAdapter,
  removeLegacyAdapter,
} from "../src/adapter.js";
import { checkCommand } from "../src/check.js";
import { initCommand } from "../src/init.js";
import { put, tempProject } from "./helpers.js";
import { parseSimpleYaml } from "./yaml.js";

describe("optional adapters", () => {
  it("merges and removes only owned Claude hooks", async () => {
    const root = await tempProject();
    await initCommand(root);
    await put(
      root,
      ".claude/settings.json",
      JSON.stringify({
        hooks: {
          Stop: [
            { matcher: "", hooks: [{ type: "command", command: "user-hook" }] },
          ],
        },
        custom: true,
      }),
    );
    await installAdapter(root, "claude-code", ["context-recovery"]);
    const status = await adapterStatus(root, "claude-code");
    expect(status.ok).toBe(true);
    const settings = parseSimpleYaml(
      await readFile(resolve(root, ".agents/settings.yaml"), "utf8"),
    ) as any;
    expect(settings.adapters.active["claude-code"]).toEqual({
      context_recovery: true,
      post_task_reminder: false,
    });
    expect(settings.capture).toBeUndefined();
    await removeAdapter(root, "claude-code");
    const config = JSON.parse(
      await readFile(resolve(root, ".claude/settings.json"), "utf8"),
    );
    expect(config.custom).toBe(true);
    expect(config.hooks.Stop[0].hooks[0].command).toBe("user-hook");
  });

  it("writes OpenCode feature gates and plugin registration", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "opencode", ["post-task-reminder"]);
    const features = JSON.parse(
      await readFile(
        resolve(root, ".agents/generated/adapters/opencode/features.json"),
        "utf8",
      ),
    );
    expect(features).toEqual({
      context_recovery: false,
      post_task_reminder: true,
    });
    expect((await adapterStatus(root, "opencode")).ok).toBe(true);
    expect(
      (await installAdapter(root, "opencode", ["post-task-reminder"])).changed,
    ).toBe(false);
    await writeFile(
      resolve(root, ".agents/generated/adapters/opencode/features.json"),
      "not-json",
      "utf8",
    );
    expect((await adapterStatus(root, "opencode")).ok).toBe(false);
  });

  it("rejects an OpenCode registration for a different project plugin", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "opencode", ["post-task-reminder"]);
    const configPath = resolve(root, ".opencode/opencode.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.plugin = [
      "file:///different-project/.agents/generated/adapters/opencode/opencode-plugin.mjs",
    ];
    await writeFile(configPath, JSON.stringify(config), "utf8");
    expect((await adapterStatus(root, "opencode")).ok).toBe(false);
    expect((await checkCommand(root)).ok).toBe(false);
  });

  it("keeps different tools' feature payloads isolated", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "claude-code", ["context-recovery"]);
    await installAdapter(root, "cursor", ["post-task-reminder"]);
    await expect(
      readFile(
        resolve(
          root,
          ".agents/generated/adapters/claude-code/context-recovery.mjs",
        ),
        "utf8",
      ),
    ).resolves.toContain("contextRecoveryReminder");
    await expect(
      readFile(
        resolve(
          root,
          ".agents/generated/adapters/cursor/post-task-reminder.mjs",
        ),
        "utf8",
      ),
    ).resolves.toContain("postTaskReminder");
  });

  it("rejects owned hooks for disabled features and hooks with the wrong command", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "cursor", ["post-task-reminder"]);
    const configPath = resolve(root, ".cursor/hooks.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.hooks.SessionStart = [
      {
        matcher: "compact",
        hooks: [
          {
            type: "command",
            command:
              "node .agents/generated/adapters/cursor/context-recovery.mjs",
            timeout: 5000,
            _self_evolution_owner: "self-evolution-v2",
          },
        ],
      },
    ];
    await writeFile(configPath, JSON.stringify(config), "utf8");
    expect((await adapterStatus(root, "cursor")).ok).toBe(false);
    expect((await checkCommand(root)).ok).toBe(false);

    delete config.hooks.SessionStart;
    config.hooks.Stop[0].hooks[0].command = "node WRONG-USER-COMMAND.mjs";
    await writeFile(configPath, JSON.stringify(config), "utf8");
    expect((await adapterStatus(root, "cursor")).ok).toBe(false);
    expect((await checkCommand(root)).ok).toBe(false);
  });

  it("removes disabled payloads when features are downgraded", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "claude-code", [
      "context-recovery",
      "post-task-reminder",
    ]);
    await installAdapter(root, "claude-code", ["context-recovery"]);
    await expect(
      readFile(
        resolve(
          root,
          ".agents/generated/adapters/claude-code/context-recovery.mjs",
        ),
        "utf8",
      ),
    ).resolves.toContain("contextRecoveryReminder");
    await expect(
      readFile(
        resolve(
          root,
          ".agents/generated/adapters/claude-code/post-task-reminder.mjs",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
    expect((await adapterStatus(root, "claude-code")).ok).toBe(true);
  });

  it("removes disabled OpenCode payloads without breaking the plugin", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "opencode", [
      "context-recovery",
      "post-task-reminder",
    ]);
    await installAdapter(root, "opencode", ["context-recovery"]);
    const generated = resolve(root, ".agents/generated/adapters/opencode");
    await expect(
      readFile(resolve(generated, "context-recovery.mjs"), "utf8"),
    ).resolves.toContain("contextRecoveryReminder");
    await expect(
      readFile(resolve(generated, "post-task-reminder.mjs"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(resolve(generated, "opencode-plugin.mjs"), "utf8"),
    ).resolves.toContain("await import");
    expect((await adapterStatus(root, "opencode")).ok).toBe(true);
  });

  it("disables reminders in an already loaded OpenCode plugin after downgrade", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "opencode", [
      "context-recovery",
      "post-task-reminder",
    ]);
    const adapterRoot = resolve(root, ".agents/generated/adapters/opencode");
    const plugin = (
      await import(
        `${pathToFileURL(resolve(adapterRoot, "opencode-plugin.mjs")).href}?test=${Date.now()}`
      )
    ).default;
    const hooks = await plugin();
    const original = process.stderr.write;
    let output = "";
    process.stderr.write = ((value: string | Uint8Array) => {
      output += String(value);
      return true;
    }) as typeof process.stderr.write;
    try {
      await hooks.event({ event: { type: "session.idle" } });
      expect(output).toContain("durable project knowledge");
      const compacted = { context: "existing" };
      await hooks["experimental.session.compacting"]({}, compacted);
      expect(compacted.context).not.toBe("existing");

      await installAdapter(root, "opencode", ["context-recovery"]);
      output = "";
      await hooks.event({ event: { type: "session.idle" } });
      expect(output).toBe("");
      const downgraded = { context: "existing" };
      await hooks["experimental.session.compacting"]({}, downgraded);
      expect(downgraded.context).not.toBe("existing");

      await installAdapter(root, "opencode", ["post-task-reminder"]);
      output = "";
      const recoveryDisabled = { context: "existing" };
      await hooks["experimental.session.compacting"]({}, recoveryDisabled);
      expect(recoveryDisabled.context).toBe("existing");
      await hooks.event({ event: { type: "session.idle" } });
      expect(output).toContain("durable project knowledge");
    } finally {
      process.stderr.write = original;
    }
  });

  it("reports repeated removal as unchanged", async () => {
    const root = await tempProject();
    await initCommand(root);
    await installAdapter(root, "augment-code", ["post-task-reminder"]);
    expect((await removeAdapter(root, "augment-code")).changed).toBe(true);
    expect((await removeAdapter(root, "augment-code")).changed).toBe(false);
  });

  it("keeps OpenCode reminders disabled when feature state is missing or malformed", async () => {
    const root = await tempProject();
    const adapterRoot = resolve(root, "adapters");
    await mkdir(adapterRoot, { recursive: true });
    for (const name of [
      "context-recovery.mjs",
      "post-task-reminder.mjs",
      "opencode-plugin.mjs",
    ]) {
      await copyFile(
        resolve("skills/self-evolution/references/adapters", name),
        resolve(adapterRoot, name),
      );
    }
    const plugin = (
      await import(
        `${pathToFileURL(resolve(adapterRoot, "opencode-plugin.mjs")).href}?test=${Date.now()}`
      )
    ).default;
    const hooks = await plugin();
    const original = process.stderr.write;
    let output = "";
    process.stderr.write = ((value: string | Uint8Array) => {
      output += String(value);
      return true;
    }) as typeof process.stderr.write;
    try {
      await hooks.event({ event: { type: "session.idle" } });
      expect(output).toBe("");
      await writeFile(
        resolve(adapterRoot, "features.json"),
        "not-json",
        "utf8",
      );
      await hooks.event({ event: { type: "session.idle" } });
      expect(output).toBe("");
      const compacted = { context: "existing" };
      await hooks["experimental.session.compacting"]({}, compacted);
      expect(compacted.context).toBe("existing");
    } finally {
      process.stderr.write = original;
      await rm(adapterRoot, { recursive: true, force: true });
    }
  });

  it("removes only the three known v1 hook scripts", async () => {
    const root = await tempProject();
    await put(
      root,
      ".claude/settings.json",
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [{ type: "command", command: "sh .agents/hooks/stop.sh" }],
            },
            {
              hooks: [
                { type: "command", command: "node .agents/hooks/custom.js" },
              ],
            },
          ],
        },
      }),
    );
    await removeLegacyAdapter(root, "claude-code");
    const config = JSON.parse(
      await readFile(resolve(root, ".claude/settings.json"), "utf8"),
    );
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.Stop[0].hooks[0].command).toBe(
      "node .agents/hooks/custom.js",
    );
  });

  it.each(["claude-code", "cursor", "augment-code"])(
    "preserves user hooks nested beside a legacy %s hook",
    async (tool) => {
      const root = await tempProject();
      const configPath = {
        "claude-code": ".claude/settings.json",
        cursor: ".cursor/hooks.json",
        "augment-code": ".augment/settings.json",
      }[tool]!;
      await put(
        root,
        configPath,
        JSON.stringify({
          hooks: {
            Stop: [
              {
                matcher: "keep-matcher",
                hooks: [
                  { type: "command", command: "sh .agents/hooks/stop.sh" },
                  { type: "command", command: "node user-hook.mjs" },
                ],
              },
            ],
          },
        }),
      );

      await removeLegacyAdapter(root, tool);
      const config = JSON.parse(
        await readFile(resolve(root, configPath), "utf8"),
      );
      expect(config.hooks.Stop).toEqual([
        {
          matcher: "keep-matcher",
          hooks: [{ type: "command", command: "node user-hook.mjs" }],
        },
      ]);
    },
  );
});
