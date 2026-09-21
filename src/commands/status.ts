import path from "node:path";
import chalk from "chalk";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import {
  isApprovalMode,
  isConfiguredWorkflowMode,
  readConfigYaml,
  readLocalBehavior,
  resolveBehaviorSettings,
  resolveLegacyBehavior,
} from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { listSessionFiles } from "../utils/session.js";
import {
  getTaskJsonPath,
  isActiveTask,
  listTasks,
  readTaskJson,
  summarizeTaskStatuses,
} from "../utils/task-json.js";
import { inspectTddReadiness } from "../utils/tdd-readiness.js";

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
  const migratedBehavior = resolveLegacyBehavior(config);
  const projectApprovalMode = isApprovalMode(config.behavior?.approval_mode)
    ? config.behavior.approval_mode
    : migratedBehavior.approvalMode;
  const projectWorkflowMode = isConfiguredWorkflowMode(config.behavior?.workflow_mode)
    ? config.behavior.workflow_mode
    : migratedBehavior.workflowMode;
  const projectUnitTestMode = migratedBehavior.unitTestMode;
  const projectUtCoverageThreshold = migratedBehavior.utCoverageThreshold;
  const localBehavior = await readLocalBehavior();
  const projectBehavior = {
    ...config.behavior,
    approval_mode: projectApprovalMode,
    unit_test_mode: projectUnitTestMode,
    ut_coverage_threshold: projectUtCoverageThreshold,
  };
  const effective = resolveBehaviorSettings(projectBehavior, localBehavior);
  const needsCoverage =
    effective.values.unit_test_mode !== "none" ||
    sessions.some(({ session }) => ["ut", "tdd"].includes(session.unit_test_mode ?? "none")) ||
    activeTasks.some(({ task }) => ["ut", "tdd"].includes(task.unit_test_mode ?? "none"));
  const readiness = needsCoverage
    ? await inspectTddReadiness(cwd)
    : { status: "not_checked", reasons: [] };
  console.log(`  approval_mode: ${projectApprovalMode}`);
  console.log(
    `  cooperate_mode: ${effective.values.cooperate_mode} (${effective.sources.cooperate_mode})`,
  );
  console.log(`  workflow_mode: ${projectWorkflowMode}`);
  console.log(`  unit_test_mode: ${projectUnitTestMode}`);
  console.log(`  ut_coverage_threshold: ${projectUtCoverageThreshold}`);
  console.log(`  unit_test_readiness: ${readiness.status}`);
  if (readiness.reasons.length > 0) {
    console.log(`  unit_test_readiness_reasons: ${readiness.reasons.join("; ")}`);
  }
  console.log("");
  console.log(chalk.bold("Sessions"));
  console.log(`  project_approval_mode: ${projectApprovalMode}`);
  console.log(`  project_workflow_mode: ${projectWorkflowMode}`);
  console.log(`  project_unit_test_mode: ${projectUnitTestMode}`);
  console.log(`  project_ut_coverage_threshold: ${projectUtCoverageThreshold}`);
  for (const [key, value] of Object.entries(localBehavior)) console.log(`  local_${key}: ${value}`);
  console.log(
    `  effective_approval_mode: ${effective.values.approval_mode} (${effective.sources.approval_mode})`,
  );
  console.log(`  configured_workflow_mode: ${projectWorkflowMode} (without a session override)`);
  console.log(
    `  effective_unit_test_mode: ${effective.values.unit_test_mode} (${effective.sources.unit_test_mode})`,
  );
  console.log(
    `  effective_ut_coverage_threshold: ${effective.values.ut_coverage_threshold} (${effective.sources.ut_coverage_threshold})`,
  );
  if (sessions.length === 0) {
    console.log("  no session files");
  }
  for (const { key, session } of sessions) {
    const legacySessionMode = session.confirm_mode;
    const hasLegacySessionMode = ["approve", "guard", "confirm", "auto"].includes(
      String(legacySessionMode ?? ""),
    );
    const sessionApprovalMode =
      session.approval_mode ?? (legacySessionMode === "lite" ? "guard" : legacySessionMode);
    const sessionWorkflowMode =
      session.workflow_mode ??
      (legacySessionMode === "lite" ? "fast" : hasLegacySessionMode ? "adaptive" : undefined);
    const sessionUnitTestMode = session.unit_test_mode;
    const sessionUtCoverageThreshold = session.ut_coverage_threshold;
    const resolved = resolveBehaviorSettings(projectBehavior, localBehavior, {
      ...session,
      approval_mode: sessionApprovalMode,
    });
    console.log(`  - ${key}`);
    console.log(`    agent: ${session.agent ?? "legacy/unknown"}`);
    console.log(`    source: ${session.session_source ?? "legacy"}`);
    console.log(`    approval_mode: ${sessionApprovalMode ?? "inherit local/project"}`);
    console.log(`    workflow_mode: ${sessionWorkflowMode ?? "project default"}`);
    console.log(`    unit_test_mode: ${sessionUnitTestMode ?? "inherit local/project"}`);
    console.log(
      `    ut_coverage_threshold: ${sessionUtCoverageThreshold ?? "inherit local/project"}`,
    );
    console.log(`    effective_approval_mode: ${resolved.values.approval_mode}`);
    console.log(
      `    cooperate_mode: ${resolved.values.cooperate_mode} (${resolved.sources.cooperate_mode})`,
    );
    console.log(`    configured_workflow_mode: ${sessionWorkflowMode ?? projectWorkflowMode}`);
    console.log(`    effective_unit_test_mode: ${resolved.values.unit_test_mode}`);
    console.log(`    effective_ut_coverage_threshold: ${resolved.values.ut_coverage_threshold}`);
    console.log(
      `    harness: ${session.harness_disabled ? "disabled for this session" : "enabled"}`,
    );
    console.log(`    lite_mode: ${session.lite_mode === true ? "enabled" : "disabled"}`);
    if (session.lite_proposal) {
      console.log(`    lite_proposal: ${session.lite_proposal.digest}`);
    }
    if (!session.current_task) {
      console.log("    current_task: none");
      continue;
    }
    const taskPath = getTaskJsonPath(cwd, session.current_task);
    if (await pathExists(taskPath)) {
      const task = await readTaskJson(taskPath);
      console.log(`    current_task: ${session.current_task}`);
      console.log(`    current_stage: ${task.status}`);
      console.log(
        `    task_workflow_mode: ${task.workflow_mode ?? task.workflow_mode_proposal?.selected_mode ?? "not resolved"}`,
      );
      console.log(`    task_unit_test_mode: ${task.unit_test_mode ?? "not frozen"}`);
      console.log(`    task_ut_coverage_threshold: ${task.ut_coverage_threshold ?? "not frozen"}`);
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
