import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const readmePath = resolve(repositoryRoot, "README.md");
const migrationGuidePath = resolve(repositoryRoot, "docs/MIGRATION.md");
const skillPath = resolve(repositoryRoot, "skills/self-evolution/SKILL.md");
const cliSourcePath = resolve(repositoryRoot, "tools/kb/src/cli.ts");
const bundledMigrationPath = resolve(
  repositoryRoot,
  "skills/self-evolution/references/migration.md",
);

describe("migration documentation ownership", () => {
  it("routes v1 migration through the authoritative guide and retains CLI commands", async () => {
    const [readme, migrationGuide, skill, cliSource] = await Promise.all([
      readFile(readmePath, "utf8"),
      readFile(migrationGuidePath, "utf8"),
      readFile(skillPath, "utf8"),
      readFile(cliSourcePath, "utf8"),
    ]);
    const skillBody = skill.replace(/^---[\s\S]*?---\s*/, "");

    expect(readme).toContain(
      "Use the [Migration Guide](docs/MIGRATION.md) whenever v1 artifacts are detected",
    );
    expect(skillBody).toContain("repository Migration Guide");
    expect(skillBody).toContain("docs/MIGRATION.md");
    expect(skillBody).not.toContain("## Migration Boundary");
    expect(skillBody).not.toContain("references/migration.md");

    for (const heading of [
      "## 1. Prepare",
      "## 2. Review",
      "## 3. Apply",
      "## 4. Verify",
      "## 5. Roll Back",
    ]) {
      expect(migrationGuide).toContain(heading);
    }

    expect(migrationGuide).toContain("input hashes");
    expect(migrationGuide).toContain("`resolved: true`");
    expect(migrationGuide).toContain("SHA-256");
    expect(migrationGuide).toContain("same-volume");
    expect(migrationGuide).toContain("controlled path");
    expect(migrationGuide).toContain("single active retrieval and write");

    expect(cliSource).toContain("migrate prepare");
    expect(cliSource).toContain("migrate apply <run-id>");
    expect(cliSource).toContain("migrate rollback <run-id>");

    await expect(stat(migrationGuidePath)).resolves.toBeTruthy();
    await expect(stat(bundledMigrationPath)).rejects.toThrow();
  });
});
