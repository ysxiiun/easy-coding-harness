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
  /** 当前 MEMORY 指令冻结的架构认知评估门禁与知识资产基线；旧冻结指令可能缺失。 */
  architecture_assessment?: ArchitectureAssessmentInstruction;
}

/** MEMORY 架构认知评估允许提交的动作。 */
export type ArchitectureAssessmentAction = "no-op" | "backfill" | "update";
/** 是否需要评估以及触发评估的原因。 */
export type ArchitectureAssessmentTrigger = "none" | "distillation" | "missing-abstract";

export interface ArchitectureAssetBaseline {
  /** 相对项目根目录的架构知识资产路径。 */
  path: string;
  /** 指令冻结时资产是否存在。 */
  exists: boolean;
  /** 指令冻结时资产是否包含非空白内容。 */
  non_empty: boolean;
  /** 指令冻结时 UTF-8 文本内容的 SHA-256；文件缺失时为 null。 */
  sha256: string | null;
}

export interface ArchitectureAssessmentInstruction {
  /** 当前 MEMORY 是否必须先完成架构评估。 */
  required: boolean;
  /** 触发评估的原因；none 表示本轮禁止架构维护。 */
  trigger: ArchitectureAssessmentTrigger;
  /** 当前基线与触发原因允许提交的评估动作。 */
  allowed_actions: ArchitectureAssessmentAction[];
  /** `.easy-coding/ABSTRACT.md` 的冻结基线。 */
  abstract: ArchitectureAssetBaseline;
  /** `.easy-coding/CHANGELOG.md` 的冻结基线。 */
  changelog: ArchitectureAssetBaseline;
}

export interface ArchitectureAssessment {
  /** Agent 基于冻结证据作出的最终架构维护动作。 */
  action: ArchitectureAssessmentAction;
  /** 本次评估的真实触发原因。 */
  trigger: Exclude<ArchitectureAssessmentTrigger, "none">;
  /** 选择该动作的可审计理由。 */
  reason: string;
  /** 来自冻结候选或首次任务检查点的短期记忆文件。 */
  evidence: string[];
  /** backfill/update 实际影响的 ABSTRACT 命名章节。 */
  affected_sections: string[];
  /** 评估完成后 ABSTRACT 的内容指纹；文件缺失时为 null。 */
  abstract_sha256: string | null;
  /** 评估完成后架构 CHANGELOG 的内容指纹；文件缺失时为 null。 */
  changelog_sha256: string | null;
  /** 架构评估写入任务状态的 UTC 时间。 */
  recorded_at: string;
  /** 提交架构评估的规范化 Agent 身份。 */
  recorded_by: string;
}

export interface MemoryProgress {
  short_memory_written?: boolean;
  short_memory_file?: string;
  short_memory_sha256?: string;
  legacy_short_memory_assumed?: boolean;
  instruction?: MemoryInstruction;
  long_memory_action?: "no-op" | "distill";
  /** 需要评估时由状态 API 校验并记录的架构维护审计结果。 */
  architecture_assessment?: ArchitectureAssessment;
  completed?: boolean;
  updated_at?: string;
}

export interface SessionFile {
  current_task: string | null;
  created_at: string;
  approval_mode?: ApprovalMode;
  workflow_mode?: ConfiguredWorkflowMode;
  tdd_enabled?: boolean;
  tdd_coverage_threshold?: number;
  /** Pre-0.9 session compatibility; migrated on first write. */
  confirm_mode?: ApprovalMode | "lite";
  workflow_mode_legacy_confirm_override?: boolean;
  workflow_mode_legacy_alias_override?: boolean;
  harness_disabled?: boolean;
  last_seen_task?: string | null;
  last_seen_stage?: string;
}

export interface SpecSource {
  schema: "easy-dev-spec/v1";
  spec_id: string;
  revision: number;
  path: string;
  /** Spec locator 的解析模式；项目内路径可移植，项目外路径绑定当前机器。 */
  path_mode: "project-relative" | "absolute";
  /** 不含机器执行区的静态设计 SHA-256。 */
  design_sha256: string;
  /** 包含共享执行区的完整文档 SHA-256。 */
  document_sha256: string;
  /** 当前任务最后确认的共享执行事件修订号。 */
  execution_revision: number;
  /** 共享 execution 引入前的旧整文摘要，仅用于一次性迁移。 */
  sha256?: string;
}

export interface SpecWritebackProgress {
  /** task.json 最后确认的共享执行修订号。 */
  last_execution_revision: number;
  /** 最近一次成功写回对应的共享事件 ID。 */
  last_event_id?: string;
  /** 最近一次成功写回使用的幂等键。 */
  last_idempotency_key?: string;
  /** 可恢复写回动作的稳定 JSON；成功或确定性失败后移除。 */
  pending_action?: string;
  /** 当前共享写回确认状态。 */
  status: "ok" | "pending" | "conflict" | "error";
  /** 写回进度最近一次变化的 UTC 时间。 */
  updated_at: string;
}

export interface SpecRepositoryBinding {
  repo_id: string;
  name: string;
  path: string;
  baseline_commit: string;
  baseline_status: "exact" | "scope-unchanged" | "scope-drifted" | "baseline-unavailable";
}

export interface SpecDependencyEvidence {
  source_task_id: string;
  task_id: string;
  dependency_type: "hard" | "contract" | "integration";
  required_evidence: string;
  status: "satisfied" | "pending";
  /** 原 Canonical Spec execution 中该依赖边的共享状态。 */
  shared_status?: "satisfied" | "pending";
  evidence?: string;
  satisfied_at?: string;
  satisfied_by?: string;
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
  tdd_enabled?: boolean;
  tdd_coverage_threshold?: number;
  tdd_confirmed_at?: string;
  tdd_confirmed_by?: string;
  tdd_baselines?: Record<string, string>;
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
  spec_source?: SpecSource;
  selected_spec_tasks?: string[];
  spec_repositories?: SpecRepositoryBinding[];
  spec_dependency_evidence?: SpecDependencyEvidence[];
  /** 当前任务的共享 Spec 写回、冲突与恢复进度。 */
  spec_writeback_progress?: SpecWritebackProgress;
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
  repo_id?: string;
  source_task_id?: string;
  source_step_ids?: string[];
  symbols?: string[];
  test_commands?: string[];
}

export type ExecutionRecord =
  | {
      type: "plan";
      strategy: "single" | "sequential" | "parallel";
      units: Unit[];
      parallel_groups?: { level: number; units: string[] }[];
    }
  | {
      type: "dispatch";
      unit_id: string;
      timestamp: string;
      reason?: string;
      repo_id?: string;
      source_task_id?: string;
      /** dispatch 已与共享 Spec 对账时保存的轻量确认信息。 */
      spec_writeback?: {
        /** 共享 writer 返回的事件 ID。 */
        event_id: string;
        /** 共享 writer 返回的执行修订号。 */
        execution_revision: number;
        /** 本地记录与共享事件共同使用的幂等键。 */
        idempotency_key: string;
      };
    }
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
      repo_id?: string;
      source_task_id?: string;
      /** result 已与共享 Spec 对账时保存的轻量确认信息。 */
      spec_writeback?: {
        /** 共享 writer 返回的事件 ID。 */
        event_id: string;
        /** 共享 writer 返回的执行修订号。 */
        execution_revision: number;
        /** 本地记录与共享事件共同使用的幂等键。 */
        idempotency_key: string;
      };
    }
  | {
      type: "review";
      dimension: string;
      passed: boolean;
      implementation_fingerprint: string;
      reviewer: string;
      timestamp: string;
      repo_id?: string;
      source_task_id?: string;
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
      check_type: "lint" | "typecheck" | "test" | "build" | "coverage";
      command?: string;
      passed: boolean;
      applicable?: boolean;
      not_applicable_reason?: string;
      implementation_fingerprint: string;
      config_fingerprint: string;
      timestamp: string;
      repo_id?: string;
      source_task_id?: string;
      failures?: string[];
      // `gitlab` 与 `ci` 仅用于读取历史证据；新验收只生产并消费 `local`。
      coverage_scope?: "local" | "gitlab";
      ci?: {
        provider: "gitlab";
        pipeline_url: string;
        job_name: string;
        status: "success";
      };
      coverage?: {
        baseline_sha: string;
        covered_lines: number;
        total_lines: number;
        percentage: number;
        threshold: number;
        report_paths: string[];
        report_sha256: string;
      };
    }
  | { type: "handoff"; from: string; stage: Stage; summary: string; timestamp: string }
  | {
      type: "spec-writeback";
      /** 已投影到共享 Spec 的薄动作描述。 */
      action: Record<string, unknown>;
      /** 共享 writer 返回的事件 ID。 */
      event_id: string;
      /** 动作完成后的共享执行修订号。 */
      execution_revision: number;
      /** 防止重复事件的稳定动作键。 */
      idempotency_key: string;
      /** 本地 acknowledgment 写入时间。 */
      timestamp: string;
    }
  | {
      type: "spec-design-sync";
      /** 本次静态设计修订显式声明的受影响任务。 */
      affected_task_ids: string[];
      /** 上游 spec_revised 事件 ID。 */
      event_id: string;
      /** 同步完成后的静态设计 SHA-256。 */
      design_sha256: string;
      /** 同步完成后的共享执行修订号。 */
      execution_revision: number;
      /** 设计同步动作的稳定幂等键。 */
      idempotency_key: string;
      /** 本地设计同步记录写入时间。 */
      timestamp: string;
    };
