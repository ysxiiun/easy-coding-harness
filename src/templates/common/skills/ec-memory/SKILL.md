---
name: ec-memory
description: MEMORY-stage skill. Creates a workflow-mode-aware schema-v2 checkpoint from existing task evidence and performs conditional long-memory distillation.
---

# ec-memory — evidence-derived checkpoint

MEMORY remains mandatory for code tasks. It must not re-analyze the repository or repeat the
entire conversation. Generate from `task.json`, `dev-spec.md`, and `execution.jsonl`.

## Depth by workflow mode

- `fast`: mechanically produce a compact checkpoint: goal, scope, result, frozen mode,
  commands/results, and only clearly reusable decisions.
- `standard`: add reusable contract, compatibility, and troubleshooting facts when present.
- `strict`: preserve architecture, migration, risk, verification, and cross-module decisions
  needed for future high-risk work.

Every memory uses schema 2 and includes `workflow_mode` in frontmatter. Generate its UUIDv7 ID
through:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py memory-new-id --agent <agent-id>
```

Name it `{memory_id}_{YYYYMMDD}_{smart_name}.md` and set
`source_task: {current task id, exact}`. Write one immutable short memory under
`.easy-coding/memory/short/`, then register it with
`memory-short-complete`. Never invent test results or commit hashes.

Ask the state API for `memory-instruction`. Distill only when it returns `action:distill`;
otherwise record `no-op`. Long memory receives reusable facts only, not file dumps, transient
logs, routine command output, or speculation.

Complete processing with `memory-complete`. When the state API reports
`memory_progress.completed:true`, call `auto-transition --stage COMPLETE`.
