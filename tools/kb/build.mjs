import { build } from "esbuild";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const outfile = resolve(root, "skills/self-evolution/references/bin/kb.mjs");
const check = process.argv.includes("--check");
const target = check ? `${outfile}.check` : outfile;

await mkdir(dirname(target), { recursive: true });
await build({
  entryPoints: [resolve(import.meta.dirname, "src/cli.ts")],
  outfile: target,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  legalComments: "none",
  sourcemap: false,
  minify: false,
  charset: "ascii",
});

if (check) {
  const [expected, actual] = await Promise.all([
    readFile(outfile),
    readFile(target),
  ]);
  await rm(target, { force: true });
  if (!expected.equals(actual)) {
    process.stderr.write("Bundled CLI is stale. Run npm run build.\n");
    process.exitCode = 1;
  }
}
