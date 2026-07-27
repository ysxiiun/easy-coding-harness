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
export type ApprovalMode = "approve" | "guard" | "confirm" | "auto";
export type ConfiguredWorkflowMode = "adaptive" | "fast" | "standard" | "strict";
export type WorkflowMode = Exclude<ConfiguredWorkflowMode, "adaptive">;
export type WorkflowModeSource = "project" | "session" | "adaptive" | "user" | "migration";

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
  approval_mode?: ApprovalMode;
  workflow_mode?: ConfiguredWorkflowMode;
  /** Pre-0.9 session compatibility; migrated on first write. */
  confirm_mode?: ApprovalMode | "lite";
  workflow_mode_legacy_confirm_override?: boolean;
  workflow_mode_legacy_alias_override?: boolean;
  harness_disabled?: boolean;
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
  workflow_mode_proposal?: {
    configured_mode: ConfiguredWorkflowMode;
    selected_mode: WorkflowMode;
    minimum_mode: WorkflowMode;
    source: WorkflowModeSource;
    reasons: string[];
    proposed_at: string;
    proposed_by: string;
  };
  workflow_mode?: WorkflowMode;
  workflow_mode_confirmed_at?: string;
  workflow_mode_confirmed_by?: string;
  workflow_mode_escalations?: Array<{
    from: WorkflowMode;
    to: WorkflowMode;
    reason: string;
    raised_at: string;
    raised_by: string;
  }>;
  workflow_mode_legacy?: boolean;
  workflow_mode_legacy_direct_edge?: boolean;
  workflow_mode_legacy_review_bypass_fingerprint?: string;
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
  acceptance_criteria?: string[];
  test_points?: string[];
  contracts?: string[];
  risks?: string[];
}

export type ExecutionRecord =
  | {
      type: "plan";
      strategy: "single" | "sequential" | "parallel";
      units: Unit[];
      parallel_groups?: { level: number; units: string[] }[];
    }
  | { type: "dispatch"; unit_id: string; timestamp: string; reason?: string }
  | {
      type: "result";
      unit_id: string;
      status: string;
      changed_files: string[];
      summary: string;
      deliverable?: string | null;
      checks?: { command: string; passed: boolean; failures?: string[] }[];
      issues: unknown[];
      needs_attention: unknown[];
    }
  | {
      type: "review";
      dimension: string;
      passed: boolean;
      implementation_fingerprint: string;
      reviewer: string;
      timestamp: string;
      findings: {
        file: string;
        line: number;
        issue: string;
        severity: "error" | "warning" | "info";
      }[];
    }
  | {
      type: "verify";
      check: string;
      check_type: "lint" | "typecheck" | "test" | "build";
      command?: string;
      passed: boolean;
      applicable?: boolean;
      not_applicable_reason?: string;
      implementation_fingerprint: string;
      config_fingerprint: string;
      timestamp: string;
      failures?: string[];
    }
  | { type: "handoff"; from: string; stage: Stage; summary: string; timestamp: string };
