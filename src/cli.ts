import chalk from "chalk";
import { Command } from "commander";
import { addAgent } from "./commands/add-agent.js";
import { clear } from "./commands/clear.js";
import { config } from "./commands/config.js";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
import { update } from "./commands/update.js";
import { upgrade } from "./commands/upgrade.js";
import { PACKAGE_NAME, VERSION } from "./constants/version.js";
import { checkForUpgrade } from "./utils/compare-versions.js";

type CommandAction<T> = (opts: T) => Promise<void>;

function withErrorHandling<T>(fn: CommandAction<T>) {
  return async (opts: T) => {
    try {
      await fn(opts);
    } catch (error) {
      console.error(chalk.red("Error:"), error instanceof Error ? error.message : error);
      if (process.env.EC_DEBUG && error instanceof Error) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  };
}

await checkForUpgrade(process.cwd());

const program = new Command();

program.name("easy-coding").description(PACKAGE_NAME).version(VERSION, "-v, --version");

program
  .command("init")
  .description("Initialize easy-coding harness in current project")
  .option("--agent <list>", "Comma-separated platforms: claude-code,codex,qoder")
  .option(
    "--submodules <list>",
    "Comma-separated checked-out submodule paths or names to initialize",
  )
  .option("--no-submodules", "Initialize only the current directory when .gitmodules exists")
  .option("-y, --yes", "Skip prompts, use defaults")
  .action(withErrorHandling(init));

program
  .command("add-agent")
  .description("Add agent platform support to an existing project")
  .option("--agent <list>", "Comma-separated platforms to add")
  .option("--submodules <list>", "Comma-separated initialized submodule paths or names to update")
  .option("--no-submodules", "Add the agent only to the current directory")
  .action(withErrorHandling(addAgent));

program
  .command("upgrade")
  .description("Upgrade harness files to current CLI version")
  .option("--dry-run", "Preview changes without applying")
  .option("-y, --yes", "Skip confirmation")
  .action(withErrorHandling(upgrade));

program
  .command("update")
  .description("Refresh the global CLI to the latest published version")
  .option("--tag <tag>", "npm dist-tag or version to install", "latest")
  .option("--dry-run", "Preview the install command without running it")
  .option("-y, --yes", "Skip confirmation")
  .action(withErrorHandling(update));

program
  .command("config")
  .description("Interactively configure project-level harness behavior")
  .action(withErrorHandling(config));

program
  .command("status")
  .description("Show installed agents, version, and tasks")
  .action(withErrorHandling(status));

program
  .command("clear")
  .description("Remove installed harness files (skills, hooks, config); keep tasks, spec, memory")
  .option("--submodules <list>", "Comma-separated initialized submodule paths or names to clear")
  .option("--no-submodules", "Clear only the current directory")
  .option("--dry-run", "Preview what would be removed without deleting")
  .option("-y, --yes", "Skip confirmation")
  .action(withErrorHandling(clear));

program.parse();
