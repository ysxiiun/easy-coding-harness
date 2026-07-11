export type Stage =
  | "INIT"
  | "ANALYSIS"
  | "IMPLEMENT"
  | "REVIEW"
  | "VERIFICATION"
  | "MEMORY"
  | "COMPLETE"
  | "CLOSED";

export type TaskStatus = "PENDING" | Stage;

export interface StageHistoryEntry {
  stage: Stage;
  agent: string;
  entered_at: string;
}

export interface PendingTransition {
  from: Stage;
  to: Stage;
  requested_at: string;
  requested_by: string;
  reason?: string;
}

export interface MemoryInstruction {
  short_count: number;
  short_term_max: number;
  short_term_keep: number;
  action: "no-op" | "distill";
  trim_count: number;
  candidate_files: string[];
  kept_files: string[];
  checkpoint_disposition: "candidate" | "kept" | "legacy";
}

export interface MemoryProgress {
  short_memory_written?: boolean;
  short_memory_file?: string;
  short_memory_sha256?: string;
  legacy_short_memory_assumed?: boolean;
  instruction?: MemoryInstruction;
  long_memory_action?: "no-op" | "distill";
  completed?: boolean;
  updated_at?: string;
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
  pending_transition?: PendingTransition;
  memory_progress?: MemoryProgress;
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
      strategy: "single" | "sequential" | "parallel"; // orchestration shape — all dispatch sub-agents
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
