const entry = process.argv[2];
if (!entry) {
  process.stderr.write("Usage: node verify-fixture.mjs <test-entry>\n");
  process.exit(2);
}

if (
  entry.endsWith(".ts") &&
  !process.execArgv.includes("--experimental-strip-types")
) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(
    process.execPath,
    ["--experimental-strip-types", import.meta.filename, entry],
    { cwd: process.cwd(), windowsHide: true },
  );
  process.exit(0);
}

await import(
  new URL(
    entry.replaceAll("\\", "/"),
    `file:///${process.cwd().replaceAll("\\", "/")}/`,
  )
);
