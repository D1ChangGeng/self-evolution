import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMigration,
  prepareMigration,
  rollbackMigration,
} from "../src/migrate.js";
import { adapterStatus } from "../src/adapter.js";
import { put, tempProject } from "./helpers.js";
import { parseSimpleYaml, updateMigrationPlan } from "./yaml.js";

async function migrationFixture(
  root: string,
  lineEnding = "\n",
): Promise<void> {
  const content = (value: string) => value.replaceAll("\n", lineEnding);
  await put(root, "AGENTS.md", content("# Old agents\n"));
  await put(
    root,
    "src/payments/index.ts",
    content("export const amount = 1;\n"),
  );
  await put(
    root,
    ".agents/knowledge/domains/payment policy.md",
    content(`---
type: domain
confidence: observed
scope: ["src/payments/**"]
---
# Payments

Old knowledge.
`),
  );
}

async function approveMigration(
  root: string,
  runId: string,
  adapterChoice?: "convert" | "disable",
): Promise<void> {
  const planPath = resolve(root, `.agents/.migrations/${runId}/plan.yaml`);
  let plan = updateMigrationPlan(await readFile(planPath, "utf8"));
  if (adapterChoice)
    plan = plan.replace("selection: null", `selection: ${adapterChoice}`);
  await writeFile(planPath, plan, "utf8");
}

describe("v1 migration", () => {
  it("prepares deterministically and gates semantic apply", async () => {
    const root = await tempProject();
    await put(root, "AGENTS.md", "# Old agents\n");
    await put(
      root,
      ".agents/knowledge/domains/payments.md",
      `---\ntype: domain\nconfidence: observed\nscope: ["src/payments/**"]\n---\n# Payments\n\nOld knowledge.\n`,
    );
    const first = await prepareMigration(root);
    const second = await prepareMigration(root);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    const runId = (first.data as any).run_id as string;
    await expect(applyMigration(root, runId)).rejects.toMatchObject({
      code: "AGENTS_APPROVAL_REQUIRED",
    });
  });

  it("applies and restores the byte-identical v1 inputs", async () => {
    const root = await tempProject();
    const oldAgents = "# Old agents\n";
    const oldKnowledge = `---\ntype: domain\nconfidence: observed\nscope: ["src/payments/**"]\n---\n# Payments\n\nOld knowledge.\n`;
    await put(root, "AGENTS.md", oldAgents);
    await put(root, "src/payments/index.ts", "export const amount = 1;\n");
    await put(root, ".agents/knowledge/domains/payments.md", oldKnowledge);
    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    const planPath = resolve(root, `.agents/.migrations/${runId}/plan.yaml`);
    const plan = updateMigrationPlan(await readFile(planPath, "utf8"));
    await writeFile(planPath, plan, "utf8");
    const applied = await applyMigration(root, runId);
    expect(applied.ok).toBe(true);
    expect(
      await readFile(
        resolve(root, ".agents/knowledge/guides/payments.md"),
        "utf8",
      ),
    ).toContain("kind: guide");
    await rollbackMigration(root, runId);
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toBe(oldAgents);
    expect(
      await readFile(
        resolve(root, ".agents/knowledge/domains/payments.md"),
        "utf8",
      ),
    ).toBe(oldKnowledge);
  });

  it("accounts for v1 rules and Hooks before removing their active trees", async () => {
    const root = await tempProject();
    await migrationFixture(root);
    const rule = "Read the payments Guide before changing payments.\n";
    const hook = "#!/bin/sh\necho user-owned-hook\n";
    await put(root, ".agents/rules/payments.md", rule);
    await put(root, ".agents/hooks/custom.sh", hook);

    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    const runRoot = resolve(root, `.agents/.migrations/${runId}`);
    const planText = await readFile(resolve(runRoot, "plan.yaml"), "utf8");
    const trace = await readFile(resolve(runRoot, "traceability.yaml"), "utf8");

    expect(planText).toContain(".agents/rules/payments.md");
    expect(planText).toContain(".agents/hooks/custom.sh");
    expect(trace).toContain(".agents/rules/payments.md");
    expect(trace).toContain(".agents/hooks/custom.sh");
    expect(trace).toContain("semantic review required");

    await approveMigration(root, runId);
    await applyMigration(root, runId);
    await expect(
      readFile(
        resolve(root, ".agents/knowledge/archive/v1/rules/payments.md"),
        "utf8",
      ),
    ).resolves.toBe(rule);
    await expect(
      readFile(
        resolve(root, ".agents/knowledge/archive/v1/hooks/custom.sh"),
        "utf8",
      ),
    ).resolves.toBe(hook);
    await expect(
      readFile(resolve(root, ".agents/rules/payments.md")),
    ).rejects.toThrow();
    await expect(
      readFile(resolve(root, ".agents/hooks/custom.sh")),
    ).rejects.toThrow();

    await rollbackMigration(root, runId);
    await expect(
      readFile(resolve(root, ".agents/rules/payments.md"), "utf8"),
    ).resolves.toBe(rule);
    await expect(
      readFile(resolve(root, ".agents/hooks/custom.sh"), "utf8"),
    ).resolves.toBe(hook);
  });

  it("refuses apply when an accounted v1 rule changes after prepare", async () => {
    const root = await tempProject();
    await migrationFixture(root);
    await put(root, ".agents/rules/payments.md", "Original rule.\n");

    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    await approveMigration(root, runId);
    await put(root, ".agents/rules/payments.md", "Changed after review.\n");

    await expect(applyMigration(root, runId)).rejects.toMatchObject({
      code: "MIGRATION_INPUT_CHANGED",
    });
  });

  it("refuses rollback after controlled files changed post-apply", async () => {
    const root = await tempProject();
    await put(root, "AGENTS.md", "# Old agents\n");
    await put(root, "src/payments/index.ts", "export const amount = 1;\n");
    await put(
      root,
      ".agents/knowledge/domains/payments.md",
      `---\ntype: domain\nconfidence: observed\nscope: ["src/payments/**"]\n---\n# Payments\n\nOld knowledge.\n`,
    );
    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    const planPath = resolve(root, `.agents/.migrations/${runId}/plan.yaml`);
    await writeFile(
      planPath,
      updateMigrationPlan(await readFile(planPath, "utf8")),
      "utf8",
    );
    await applyMigration(root, runId);
    await put(root, ".claude/settings.json", JSON.stringify({ user: true }));
    await expect(rollbackMigration(root, runId)).rejects.toMatchObject({
      code: "ROLLBACK_STATE_CHANGED",
    });
    expect(
      JSON.parse(
        await readFile(resolve(root, ".claude/settings.json"), "utf8"),
      ),
    ).toEqual({ user: true });
  });

  it("can retry the same run after a restored apply failure", async () => {
    const root = await tempProject();
    await put(root, "AGENTS.md", "# Old agents\n");
    await put(root, "src/payments/index.ts", "export const amount = 1;\n");
    await put(
      root,
      ".agents/knowledge/domains/payments.md",
      `---\ntype: domain\nconfidence: observed\nscope: ["src/payments/**"]\n---\n# Payments\n\nOld knowledge.\n`,
    );
    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    const planPath = resolve(root, `.agents/.migrations/${runId}/plan.yaml`);
    await writeFile(
      planPath,
      updateMigrationPlan(await readFile(planPath, "utf8")),
      "utf8",
    );
    const candidate = resolve(
      root,
      `.agents/.migrations/${runId}/candidate/knowledge/guides/payments.md`,
    );
    const valid = await readFile(candidate, "utf8");
    await writeFile(candidate, "not valid frontmatter\n", "utf8");
    await expect(applyMigration(root, runId)).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
    });
    await writeFile(candidate, valid, "utf8");
    await expect(applyMigration(root, runId)).resolves.toMatchObject({
      ok: true,
      changed: true,
    });
  });

  it("handles CRLF v1 bytes and project paths containing spaces", async () => {
    const parent = await tempProject();
    const root = resolve(parent, "project with spaces [migration]");
    await mkdir(root, { recursive: true });
    await migrationFixture(root, "\r\n");
    const oldAgents = await readFile(resolve(root, "AGENTS.md"));
    const oldKnowledge = await readFile(
      resolve(root, ".agents/knowledge/domains/payment policy.md"),
    );

    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    await approveMigration(root, runId);
    await expect(applyMigration(root, runId)).resolves.toMatchObject({
      ok: true,
      changed: true,
    });
    await expect(
      readFile(
        resolve(root, ".agents/knowledge/guides/payment policy.md"),
        "utf8",
      ),
    ).resolves.toContain("kind: guide");

    await rollbackMigration(root, runId);
    expect(await readFile(resolve(root, "AGENTS.md"))).toEqual(oldAgents);
    expect(
      await readFile(
        resolve(root, ".agents/knowledge/domains/payment policy.md"),
      ),
    ).toEqual(oldKnowledge);
  });

  it("rejects malformed v1 Guide frontmatter during prepare", async () => {
    const root = await tempProject();
    await put(root, "AGENTS.md", "# Old agents\n");
    await put(
      root,
      ".agents/knowledge/domains/broken.md",
      "---\nscope: [unterminated\n---\n# Broken\n",
    );

    await expect(prepareMigration(root)).rejects.toMatchObject({
      code: "MIGRATION_V1_INVALID",
      exitCode: 2,
    });
  });

  it("rejects malformed v1 Decision frontmatter during prepare", async () => {
    const root = await tempProject();
    await put(root, "AGENTS.md", "# Old agents\n");
    await put(
      root,
      ".agents/knowledge/decisions/broken.md",
      "---\nscope: [unterminated\n---\n# Broken decision\n",
    );

    await expect(prepareMigration(root)).rejects.toMatchObject({
      code: "MIGRATION_V1_INVALID",
      exitCode: 2,
    });
  });

  it("converts an enabled v1 adapter while preserving unrelated config and rollback bytes", async () => {
    const root = await tempProject();
    await migrationFixture(root);
    const oldConfig = `${JSON.stringify(
      {
        custom: { keep: true },
        hooks: {
          Stop: [
            {
              hooks: [{ type: "command", command: "sh .agents/hooks/stop.sh" }],
            },
            { hooks: [{ type: "command", command: "node user-hook.mjs" }] },
          ],
        },
      },
      null,
      2,
    )}\n`;
    await put(root, ".claude/settings.json", oldConfig);
    await put(
      root,
      ".agents/knowledge/manifest.json",
      `${JSON.stringify({ hooks: { integration: "claude-code" } }, null, 2)}\n`,
    );

    const prepared = await prepareMigration(root);
    expect((prepared.data as any).adapter_choice_required).toBe(true);
    const runId = (prepared.data as any).run_id as string;
    await approveMigration(root, runId, "convert");
    await applyMigration(root, runId);

    const converted = JSON.parse(
      await readFile(resolve(root, ".claude/settings.json"), "utf8"),
    );
    expect(converted.custom).toEqual({ keep: true });
    expect(JSON.stringify(converted)).toContain("node user-hook.mjs");
    expect(JSON.stringify(converted)).not.toContain(".agents/hooks/stop.sh");
    expect((await adapterStatus(root, "claude-code")).ok).toBe(true);
    const settings = parseSimpleYaml(
      await readFile(resolve(root, ".agents/settings.yaml"), "utf8"),
    ) as any;
    expect(settings.adapters.active["claude-code"]).toEqual({
      context_recovery: true,
      post_task_reminder: true,
    });

    await rollbackMigration(root, runId);
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toBe(
      oldConfig,
    );
    await expect(
      readFile(
        resolve(root, ".claude/settings.json.self-evolution-v2.bak"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("disables a v1 adapter without enabling v2 behavior or removing user hooks", async () => {
    const root = await tempProject();
    await migrationFixture(root);
    await put(
      root,
      ".agents/knowledge/manifest.json",
      `${JSON.stringify({ hooks: { integration: "claude-code" } }, null, 2)}\n`,
    );
    await put(
      root,
      ".claude/settings.json",
      `${JSON.stringify(
        {
          custom: true,
          hooks: {
            Stop: [
              {
                hooks: [
                  { type: "command", command: "sh .agents/hooks/stop.sh" },
                ],
              },
              { hooks: [{ type: "command", command: "node user-hook.mjs" }] },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    await approveMigration(root, runId, "disable");
    await applyMigration(root, runId);

    const disabled = JSON.parse(
      await readFile(resolve(root, ".claude/settings.json"), "utf8"),
    );
    expect(disabled.custom).toBe(true);
    expect(JSON.stringify(disabled)).toContain("node user-hook.mjs");
    expect(JSON.stringify(disabled)).not.toContain(".agents/hooks/stop.sh");
    const settings = parseSimpleYaml(
      await readFile(resolve(root, ".agents/settings.yaml"), "utf8"),
    ) as any;
    expect(settings.adapters.active["claude-code"]).toBeUndefined();
    expect((await adapterStatus(root, "claude-code")).data).toEqual({
      "claude-code": { enabled: false },
    });
  });

  it.each([
    ["claude-code", "missing", ".claude/settings.json", undefined],
    ["cursor", "missing", ".cursor/hooks.json", undefined],
    ["augment-code", "missing", ".augment/settings.json", undefined],
    ["opencode", "missing", ".opencode/opencode.json", undefined],
    ["claude-code", "malformed", ".claude/settings.json", "{not valid json\n"],
  ])(
    "detects and disables a %s legacy registration when the manifest is %s",
    async (tool, _manifestState, configPath, manifestContent) => {
      const root = await tempProject();
      await migrationFixture(root);
      const hostConfig =
        tool === "opencode"
          ? {
              custom: { keep: true },
              plugin: [
                `file://${root.replaceAll("\\", "/")}/.agents/hooks/opencode-plugin.mjs`,
                "npm:user-owned-plugin",
              ],
            }
          : {
              custom: { keep: true },
              hooks: {
                Stop: [
                  {
                    hooks: [
                      {
                        type: "command",
                        command: "sh .agents/hooks/stop.sh",
                      },
                    ],
                  },
                  {
                    hooks: [
                      { type: "command", command: "node user-owned-hook.mjs" },
                    ],
                  },
                ],
              },
            };
      const oldConfig = `${JSON.stringify(hostConfig, null, 2)}\n`;
      await put(root, ".agents/hooks/stop.sh", "#!/bin/sh\n");
      await put(root, configPath, oldConfig);
      if (manifestContent !== undefined)
        await put(root, ".agents/knowledge/manifest.json", manifestContent);

      const prepared = await prepareMigration(root);
      expect((prepared.data as any).adapter_choice_required).toBe(true);
      const runId = (prepared.data as any).run_id as string;
      const planPath = resolve(root, `.agents/.migrations/${runId}/plan.yaml`);
      await writeFile(
        planPath,
        updateMigrationPlan(await readFile(planPath, "utf8")),
        "utf8",
      );
      await expect(applyMigration(root, runId)).rejects.toMatchObject({
        code: "ADAPTER_CHOICE_REQUIRED",
      });
      await approveMigration(root, runId, "disable");
      await applyMigration(root, runId);

      const disabled = JSON.parse(
        await readFile(resolve(root, configPath), "utf8"),
      );
      expect(disabled.custom).toEqual({ keep: true });
      expect(JSON.stringify(disabled)).toContain("user-owned");
      expect(JSON.stringify(disabled)).not.toContain(".agents/hooks/");
      await expect(
        readFile(resolve(root, ".agents/hooks/stop.sh")),
      ).rejects.toThrow();

      await rollbackMigration(root, runId);
      expect(await readFile(resolve(root, configPath), "utf8")).toBe(oldConfig);
      await expect(
        readFile(resolve(root, ".agents/hooks/stop.sh"), "utf8"),
      ).resolves.toBe("#!/bin/sh\n");
    },
  );

  it("restores v1 scripts when an invalid host config cannot be cleaned safely", async () => {
    const root = await tempProject();
    await migrationFixture(root);
    const malformedConfig =
      '{"hooks":{"Stop":[{"hooks":[{"command":"sh .agents/hooks/stop.sh"}]}]';
    await put(root, ".agents/hooks/stop.sh", "#!/bin/sh\n");
    await put(root, ".claude/settings.json", malformedConfig);

    const prepared = await prepareMigration(root);
    expect((prepared.data as any).adapter_choice_required).toBe(true);
    const runId = (prepared.data as any).run_id as string;
    await approveMigration(root, runId, "disable");
    await expect(applyMigration(root, runId)).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
    });

    await expect(
      readFile(resolve(root, ".agents/hooks/stop.sh"), "utf8"),
    ).resolves.toBe("#!/bin/sh\n");
    await expect(
      readFile(resolve(root, ".claude/settings.json"), "utf8"),
    ).resolves.toBe(malformedConfig);
  });

  it("recovers a journaled interruption and can reapply the same prepared run", async () => {
    const root = await tempProject();
    await migrationFixture(root);
    const prepared = await prepareMigration(root);
    const runId = (prepared.data as any).run_id as string;
    await approveMigration(root, runId);
    await applyMigration(root, runId);

    const planPath = resolve(root, `.agents/.migrations/${runId}/plan.yaml`);
    const plan = (await readFile(planPath, "utf8"))
      .replace("state: applied", "state: prepared")
      .replace(/backup_root: .+/, "backup_root: null")
      .replace(/applied_hashes:[\s\S]*/, "");
    await writeFile(planPath, plan, "utf8");
    await writeFile(
      resolve(root, `.agents/.migrations/${runId}/journal.json`),
      `${JSON.stringify({ state: "applying", backup_root: `.agents/legacy/v1-${runId}` }, null, 2)}\n`,
      "utf8",
    );

    await expect(applyMigration(root, runId)).rejects.toMatchObject({
      code: "MIGRATION_INTERRUPTED_RECOVERED",
    });
    await expect(
      readFile(
        resolve(root, ".agents/knowledge/domains/payment policy.md"),
        "utf8",
      ),
    ).resolves.toContain("type: domain");
    await expect(applyMigration(root, runId)).resolves.toMatchObject({
      ok: true,
      changed: true,
    });
  });
});
