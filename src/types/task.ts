export type Stage =
  | "INIT"
  | "ANALYSIS"
  | "WAITING_CONFIRM"
  | "IMPLEMENT"
  | "REVIEW"
  | "VERIFICATION"
  | "MEMORY_SHORT"
  | "MEMORY_LONG"
  | "COMPLETE"
  | "CLOSED";

export type TaskStatus = "PENDING" | Stage;

export interface StageHistoryEntry {
  stage: Stage;
  agent: string;
  entered_at: string;
}

export interface SessionFile {
  current_task: string | null;
  created_at: string;
  last_seen_task?: string | null;
  last_seen_stage?: string;
}

export interface TaskJson {
  type: string;
  title?: string;
  status: TaskStatus;
  created_at: string;
  created_by: string;
  last_agent: string;
  stage_history: StageHistoryEntry[];
  confirmed_by_user?: boolean;
  test_strategy_confirmed?: boolean;
  repo_paths?: Record<string, string>;
  context?: Record<string, unknown>;
  spawned_from?: string | null;
  pending_init_since?: string;
  spawned_tasks?: string[];
  closed_reason?: string | null;
  repos?: string[];
  init_log?: unknown[];
}

export interface Unit {
  id: string;
  title: string;
  type: string;
  files: string[];
  depends_on: string[];
  rules_sections?: string[];
  abstract_modules?: string[];
}

export type ExecutionRecord =
  | {
      type: "plan";
      strategy: "single" | "sequential" | "parallel";
      units: Unit[];
      parallel_groups: { level: number; units: string[] }[];
    }
  | { type: "dispatch"; unit_id: string; timestamp: string; reason?: string }
  | {
      type: "result";
      unit_id: string;
      status: string;
      changed_files: string[];
      summary: string;
      issues: unknown[];
    }
  | {
      type: "review";
      dimension: string;
      findings: { file: string; line: number; issue: string; severity: string }[];
    }
  | { type: "verify"; check: string; passed: boolean; failures?: string[] }
  | { type: "handoff"; from: string; stage: Stage; summary: string; timestamp: string };
