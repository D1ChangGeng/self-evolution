#!/usr/bin/env node

import { runCli } from "./lib/campaign.mjs";

try {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
