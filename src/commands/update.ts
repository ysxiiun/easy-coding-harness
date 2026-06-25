import { execFileSync } from "node:child_process";
import { cancel, confirm, outro } from "@clack/prompts";
import chalk from "chalk";
import { PACKAGE_NAME } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";

export interface UpdateOptions {
  tag?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Refresh the globally installed CLI to a published version.
 */
export async function update(opts: UpdateOptions): Promise<void> {
  renderBanner();

  const tag = opts.tag ?? "latest";
  const spec = `${PACKAGE_NAME}@${tag}`;

  const plan = ["update runs one step:", `  refresh the global CLI:  npm install -g ${spec}`].join(
    "\n",
  );

  if (opts.dryRun) {
    console.log(plan);
    return;
  }

  if (!opts.yes) {
    const confirmed = await confirm({
      message: `Update the global CLI to ${spec}?`,
      initialValue: true,
    });
    if (typeof confirmed === "symbol" || !confirmed) {
      cancel("Update cancelled.");
      return;
    }
  }

  console.log(chalk.cyan(`→ npm install -g ${spec}`));
  execFileSync("npm", ["install", "-g", spec], { stdio: "inherit" });

  outro(chalk.green("Global CLI updated."));
}
