# Platform Files

What lives in each platform directory and how the three platforms differ.

## Directory map

| | Claude Code | Codex | Qoder |
|---|---|---|---|
| Skills dir | `.claude/skills/` | `.agents/skills/` | `.qoder/skills/` |
| Skill trigger | `/` | `$` | `/` |
| Hooks dir | `.claude/hooks/` | `.codex/hooks/` | `.qoder/hooks/` |
| Hook config | `.claude/settings.json` | `.codex/hooks.json` | `.qoder/settings.json` |
| Main constraint | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| Sub-agent defs | `.claude/agents/*.md` | `.codex/agents/*.toml` | `.qoder/agents/*.md` |
| CN variant | — | — | `.qodercn/` |

Each skill is installed as `{skills-dir}/ec-{name}/SKILL.md`. The 12 skills are
platform-agnostic — one template, resolved per platform at write time. The agent's native
discovery surfaces them under `/ec-` or `$ec-`.

## Skills and agents

- **Skills** (`SKILL.md`): frontmatter `name` + `description`, then markdown instructions.
  They carry the workflow logic. Platform differences — the skill trigger (`/` vs `$`), the
  session path, state API path, and the sub-agent spawn instruction — are filled in from a small
  placeholder map at install time, so one source template serves all three platforms.
- **Sub-agent definitions**: role baselines for the implementer / reviewer / verifier
  sub-agents. Claude/Qoder use markdown frontmatter; Codex uses TOML with
  `developer_instructions`. At runtime the main agent still builds a concrete task card per
  unit — these files are the standing role contract, not the per-unit card.

## Hooks and settings

Python runtime files are shared verbatim across platforms (only the JSON wrapper differs):

- `easy_coding_state.py` — the single runtime API for current-task pointers, task status,
  transitions, and task state reads.
- `easy_coding_status.py` — renders the Markdown status line and machine breadcrumbs from
  state API snapshots.
- `session-start.py` — ensures the per-session file exists; performs legacy `state.json`
  migration; injects resume / init-required / handoff breadcrumbs. Idempotent.
- `inject-workflow-state.py` — injects the `workflow-state` and `current-task` breadcrumbs so
  the status line can render.
- `inject-subagent-context.py` — injects the sub-agent guard before an Agent tool call.

Wrapper differences:

- **Claude Code**: full event set — `SessionStart`, `UserPromptSubmit`, `PreToolUse(Agent)`.
  `session-start.py` also runs on `UserPromptSubmit` before `inject-workflow-state.py`, so
  every prompt receives a fresh status context even if the native session event is not surfaced
  to the model turn.
- **Codex**: no `SessionStart` and no Agent tool. `session-start.py` and
  `inject-workflow-state.py` both hang off `UserPromptSubmit`; `inject-subagent-context.py`
  is skipped. Codex hooks also require user-level enablement (`[features] hooks = true`).
- **Qoder**: like Claude Code (has Agent tool + Stop) but uses `UserPromptSubmit` for state
  injection. The `.qoder/settings.json` wrapper nests an extra `hooks` array.

`session-start.py` is designed to be idempotent precisely because Claude/Codex/Qoder can fire it
on `UserPromptSubmit` rather than only a real session-start event — repeated calls are safe.
