import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { adapterStatus, installAdapter, removeAdapter } from "./adapter.js";
import { checkCommand } from "./check.js";
import { indexCommand } from "./index-command.js";
import { initCommand } from "./init.js";
import {
  applyMigration,
  prepareMigration,
  rollbackMigration,
} from "./migrate.js";
import type { CommandResult, OutputFormat } from "./types.js";
import { KbError } from "./types.js";

type ParsedArgs = {
  positional: string[];
  projectRoot: string;
  format: OutputFormat;
  features: string[];
};

const help = `Usage: kb <command> [options]

Commands:
  init
  index
  check
  migrate prepare
  migrate apply <run-id>
  migrate rollback <run-id>
  adapter install <tool> [--features context-recovery,post-task-reminder]
  adapter status [tool]
  adapter remove <tool>

Global options:
  --project-root <path>  Project root (default: current directory)
  --format text|json     Output format (default: text)
`;

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let projectRoot = process.cwd();
  let format: OutputFormat = "text";
  let features: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--project-root") {
      const next = argv[++index];
      if (!next)
        throw new KbError("--project-root requires a path.", 2, "USAGE");
      projectRoot = resolve(next);
    } else if (value === "--format") {
      const next = argv[++index];
      if (next !== "text" && next !== "json")
        throw new KbError("--format must be text or json.", 2, "USAGE");
      format = next;
    } else if (value === "--features") {
      const next = argv[++index];
      if (!next)
        throw new KbError(
          "--features requires a comma-separated value.",
          2,
          "USAGE",
        );
      features = next
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (value === "--help" || value === "-h") positional.push("help");
    else if (value.startsWith("--"))
      throw new KbError(`Unknown option: ${value}`, 2, "USAGE");
    else positional.push(value);
  }
  return { positional, projectRoot, format, features };
}

function textResult(result: CommandResult): string {
  const lines = [
    `${result.ok ? "OK" : "FAILED"} ${result.command}${result.changed === undefined ? "" : result.changed ? " (changed)" : " (unchanged)"}`,
  ];
  for (const diagnostic of result.diagnostics ?? [])
    lines.push(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${diagnostic.path ? ` ${diagnostic.path}` : ""}: ${diagnostic.message}`,
    );
  if (result.data !== undefined)
    lines.push(JSON.stringify(result.data, null, 2));
  return `${lines.join("\n")}\n`;
}

async function dispatch(args: ParsedArgs): Promise<CommandResult> {
  const [command, subcommand, value, ...extra] = args.positional;
  if (!command || command === "help")
    return { command: "help", ok: true, data: help.trimEnd() };
  if (command === "init" && !subcommand) return initCommand(args.projectRoot);
  if (command === "index" && !subcommand) return indexCommand(args.projectRoot);
  if (command === "check" && !subcommand) return checkCommand(args.projectRoot);
  if (command === "migrate" && subcommand === "prepare" && !value)
    return prepareMigration(args.projectRoot);
  if (
    command === "migrate" &&
    subcommand === "apply" &&
    value &&
    extra.length === 0
  )
    return applyMigration(args.projectRoot, value);
  if (
    command === "migrate" &&
    subcommand === "rollback" &&
    value &&
    extra.length === 0
  )
    return rollbackMigration(args.projectRoot, value);
  if (
    command === "adapter" &&
    subcommand === "install" &&
    value &&
    extra.length === 0
  )
    return installAdapter(args.projectRoot, value, args.features);
  if (command === "adapter" && subcommand === "status" && extra.length === 0)
    return adapterStatus(args.projectRoot, value);
  if (
    command === "adapter" &&
    subcommand === "remove" &&
    value &&
    extra.length === 0
  )
    return removeAdapter(args.projectRoot, value);
  throw new KbError(`Invalid command.\n${help}`, 2, "USAGE");
}

export async function run(argv: string[]): Promise<number> {
  let format: OutputFormat =
    argv.includes("--format") && argv[argv.indexOf("--format") + 1] === "json"
      ? "json"
      : "text";
  try {
    const args = parseArgs(argv);
    format = args.format;
    const result = await dispatch(args);
    if (result.command === "help" && format === "text")
      process.stdout.write(`${result.data}\n`);
    else
      process.stdout.write(
        format === "json"
          ? `${JSON.stringify(result, null, 2)}\n`
          : textResult(result),
      );
    return result.exitCode ?? (result.ok ? 0 : 1);
  } catch (error) {
    const kbError =
      error instanceof KbError
        ? error
        : new KbError((error as Error).message, 3, "UNEXPECTED_ERROR");
    const result = {
      command: "error",
      ok: false,
      diagnostics: [
        { code: kbError.code, severity: "error", message: kbError.message },
      ],
    } satisfies CommandResult;
    process.stderr.write(
      format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : textResult(result),
    );
    return kbError.exitCode;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await run(process.argv.slice(2));
}
