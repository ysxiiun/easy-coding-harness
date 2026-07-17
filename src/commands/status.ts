import path from "node:path";
import chalk from "chalk";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import { isConfirmMode, readConfigYaml } from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { listSessionFiles } from "../utils/session.js";
import {
  getTaskJsonPath,
  isActiveTask,
  listTasks,
  readTaskJson,
  summarizeTaskStatuses,
} from "../utils/task-json.js";

export async function status(): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const configPath = path.join(cwd, EASY_CODING_DIR, CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    throw new Error("No easy-coding harness found in this project.");
  }

  const config = await readConfigYaml(configPath);
  const tasks = await listTasks(cwd);
  const taskCounts = summarizeTaskStatuses(tasks);
  const activeTasks = tasks.filter((item) => isActiveTask(item.task));
  const sessions = await listSessionFiles(cwd);
  const versionRelation = compareVersions(config.harness_version, VERSION);

  console.log(chalk.bold("Harness"));
  console.log(`  version: ${config.harness_version}`);
  console.log(`  cli: ${VERSION}`);
  if (versionRelation === -1 || (versionRelation === 0 && config.harness_version !== VERSION)) {
    console.log(chalk.yellow("  upgrade: available"));
  } else if (versionRelation === 1) {
    console.log(chalk.red("  upgrade: CLI is older than project harness"));
  } else {
    console.log("  upgrade: up to date");
  }
  console.log(`  agents: ${config.agents.join(", ") || "(none)"}`);
  console.log(`  project: ${config.project.name}`);
  const projectConfirmMode = isConfirmMode(config.behavior?.confirm_mode)
    ? config.behavior.confirm_mode
    : "guard";
  console.log(`  confirm_mode: ${projectConfirmMode}`);
  console.log("");
  console.log(chalk.bold("Sessions"));
  console.log(`  project_confirm_mode: ${projectConfirmMode}`);
  console.log(`  effective_confirm_mode: ${projectConfirmMode} (without a session override)`);
  if (sessions.length === 0) {
    console.log("  no session files");
  }
  for (const { key, session } of sessions) {
    const sessionConfirmMode = session.confirm_mode;
    console.log(`  - ${key}`);
    console.log(`    agent: ${session.agent ?? "legacy/unknown"}`);
    console.log(`    source: ${session.session_source ?? "legacy"}`);
    console.log(`    confirm_mode: ${sessionConfirmMode ?? "project default"}`);
    console.log(`    effective_confirm_mode: ${sessionConfirmMode ?? projectConfirmMode}`);
    console.log(
      `    harness: ${session.harness_disabled ? "disabled for this session" : "enabled"}`,
    );
    if (!session.current_task) {
      console.log("    current_task: none");
      continue;
    }
    const taskPath = getTaskJsonPath(cwd, session.current_task);
    if (await pathExists(taskPath)) {
      const task = await readTaskJson(taskPath);
      console.log(`    current_task: ${session.current_task}`);
      console.log(`    current_stage: ${task.status}`);
      console.log(`    last_agent: ${task.last_agent}`);
    } else {
      console.log(`    current_task: ${session.current_task} (task.json missing)`);
    }
  }
  console.log("");
  console.log(chalk.bold("Tasks"));
  console.log(`  total: ${tasks.length}`);
  for (const [taskStatus, count] of Object.entries(taskCounts)) {
    console.log(`  ${taskStatus}: ${count}`);
  }
  if (activeTasks.length > 0) {
    console.log("  active:");
    for (const item of activeTasks) {
      const label = item.task.title ? `${item.task.title} (${item.task.status})` : item.task.status;
      console.log(`    - ${item.id}: ${label}`);
    }
  }
}
