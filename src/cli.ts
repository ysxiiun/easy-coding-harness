import chalk from "chalk";
import { Command } from "commander";
import { addAgent } from "./commands/add-agent.js";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
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
  .option("-y, --yes", "Skip prompts, use defaults")
  .action(withErrorHandling(init));

program
  .command("add-agent")
  .description("Add agent platform support to an existing project")
  .option("--agent <list>", "Comma-separated platforms to add")
  .action(withErrorHandling(addAgent));

program
  .command("upgrade")
  .description("Upgrade harness files to current CLI version")
  .option("--dry-run", "Preview changes without applying")
  .option("-y, --yes", "Skip confirmation")
  .action(withErrorHandling(upgrade));

program
  .command("status")
  .description("Show installed agents, version, and tasks")
  .action(withErrorHandling(status));

program.parse();
