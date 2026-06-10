---
name: ec-meta
description: Understand and locally customize the Easy Coding harness installation. Use when the user runs {{skill_trigger}}ec-meta, asks how the harness works, wants to inspect installed platform files, or wants a local customization strategy. Reads references/ on demand. Never touches runtime task data.
---

# ec-meta — understand and customize the harness

Use this skill to explain the local harness architecture and guide safe local customization.
It is the harness explaining itself. Load the `references/` files on demand rather than
dumping them up front.

Communicate with the user in the user's language.

## Operating scope

You may inspect and explain: `.easy-coding/` (config and knowledge layout), the platform dirs
(`.claude/`, `.agents/`, `.codex/`, `.qoder/`), and the main constraint files (CLAUDE.md /
AGENTS.md). You guide customization of the locally installed copies — never the scaffold
source in the global npm install.

## Source-of-truth rules

- `ec-workflow`'s SKILL.md is the source of truth for the workflow.
- `.easy-coding/config.yaml` is the source of truth for project configuration.
- Customization edits the LOCAL installed copy only, never the scaffold source package.
- Never edit runtime data here: `state.json`, `tasks/`, `memory/`.
- Warn the user: harness-managed files (ec-* skills, shared hooks, generated hook config,
  generated main-constraint regions) are **overwritten by `easy-coding upgrade`**. Durable
  customization belongs in project custom instructions (outside the generated markers) or in
  `.easy-coding/RULES.md`.

## References (read on demand)

- `references/local-architecture/` — runtime layout, workflow, task system, memory system,
  project-knowledge layer.
- `references/platform-files/` — what each platform directory contains and how hooks/skills
  /agents map across Claude Code, Codex, and Qoder.
- `references/customize-local/` — how to change the workflow, rules, hooks, or add a skill
  without losing it on upgrade.

Read the specific reference matching the user's question; do not preload all of them.

## Common requests

- "How does the harness work?" → read `references/local-architecture/`, summarize the layered
  design (platform-native files vs `.easy-coding/` runtime data, the dead-drop coordination model).
- "What are all these directories?" → read `references/platform-files/`.
- "How do I change X without losing it on upgrade?" → read `references/customize-local/`,
  steer the change into a non-managed location.

## Boundaries

- Read and explain freely; modify only local installed configuration, and only what the user
  asks for.
- Never modify runtime task/memory/state data.
- Never edit the scaffold source package.
