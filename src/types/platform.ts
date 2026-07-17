export type AgentPlatform = "claude-code" | "codex" | "qoder";

export interface TemplateContext {
  sub_agent_dispatch: string;
  platform_spawn_instruction: string;
  skill_trigger: "/" | "$";
  workflow_state_path: string;
  main_constraint_file: "CLAUDE.md" | "AGENTS.md";
  python_cmd: string;
  platform_config_dir: string;
  platform_hook_session_start_command?: string;
  platform_hook_inject_workflow_state_command?: string;
  platform_hook_inject_subagent_context_command?: string;
  supermodule_boundary: string;
}

export interface PlatformMeta {
  label: string;
  skillsDir: string;
  hooksDir: string;
  hookConfigFile: string;
  agentsDir: string;
  agentFileExt: ".md" | ".toml";
  mainConstraint: "CLAUDE.md" | "AGENTS.md";
  skillTrigger: "/" | "$";
  hookEvents: string[];
  stateInjectEvent: string[];
  hasSubagentContext: boolean;
  cnVariant?: string;
  templateContext: TemplateContext;
}

const pythonCmd = process.platform === "win32" ? "python" : "python3";

export const PLATFORM_META: Record<AgentPlatform, PlatformMeta> = {
  "claude-code": {
    label: "Claude Code",
    skillsDir: ".claude/skills",
    hooksDir: ".claude/hooks",
    hookConfigFile: ".claude/settings.json",
    agentsDir: ".claude/agents",
    agentFileExt: ".md",
    mainConstraint: "CLAUDE.md",
    skillTrigger: "/",
    hookEvents: ["SessionStart", "PreToolUse", "UserPromptSubmit", "Stop"],
    stateInjectEvent: ["SessionStart", "UserPromptSubmit"],
    hasSubagentContext: true,
    templateContext: {
      sub_agent_dispatch: "Agent tool",
      platform_spawn_instruction:
        'Use the Agent tool with run_in_background when useful; use isolation: "worktree" for parallel file edits.',
      skill_trigger: "/",
      workflow_state_path: ".easy-coding/sessions/",
      main_constraint_file: "CLAUDE.md",
      python_cmd: pythonCmd,
      platform_config_dir: ".claude",
      supermodule_boundary: "",
    },
  },
  codex: {
    label: "Codex",
    skillsDir: ".agents/skills",
    hooksDir: ".codex/hooks",
    hookConfigFile: ".codex/hooks.json",
    agentsDir: ".codex/agents",
    agentFileExt: ".toml",
    mainConstraint: "AGENTS.md",
    skillTrigger: "$",
    hookEvents: ["SessionStart", "UserPromptSubmit"],
    stateInjectEvent: ["SessionStart", "UserPromptSubmit"],
    hasSubagentContext: false,
    templateContext: {
      sub_agent_dispatch: "Codex sub-agent dispatch",
      platform_spawn_instruction:
        "Use Codex sub-agent delegation where available; pass the full task card in the prompt.",
      skill_trigger: "$",
      workflow_state_path: ".easy-coding/sessions/",
      main_constraint_file: "AGENTS.md",
      python_cmd: pythonCmd,
      platform_config_dir: ".codex",
      supermodule_boundary: "",
    },
  },
  qoder: {
    label: "Qoder",
    skillsDir: ".qoder/skills",
    hooksDir: ".qoder/hooks",
    hookConfigFile: ".qoder/settings.json",
    agentsDir: ".qoder/agents",
    agentFileExt: ".md",
    mainConstraint: "AGENTS.md",
    skillTrigger: "/",
    hookEvents: ["UserPromptSubmit", "PreToolUse", "Stop"],
    stateInjectEvent: ["UserPromptSubmit"],
    hasSubagentContext: true,
    cnVariant: ".qodercn",
    templateContext: {
      sub_agent_dispatch: "Agent tool",
      platform_spawn_instruction:
        "Use the Agent tool with worktree isolation for parallel file edits.",
      skill_trigger: "/",
      workflow_state_path: ".easy-coding/sessions/",
      main_constraint_file: "AGENTS.md",
      python_cmd: pythonCmd,
      platform_config_dir: ".qoder",
      supermodule_boundary: "",
    },
  },
};

export const AGENT_PLATFORMS = Object.keys(PLATFORM_META) as AgentPlatform[];

export function isAgentPlatform(value: string): value is AgentPlatform {
  return Object.hasOwn(PLATFORM_META, value);
}
