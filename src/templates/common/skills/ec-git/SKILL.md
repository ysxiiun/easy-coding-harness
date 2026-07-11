---
name: ec-git
description: Git discipline skill for Easy Coding projects. Use when the task involves git pull/merge/rebase/commit/push/PR. Enforces the .easy-coding commit policy, warns on committing in-progress tasks, handles .easy-coding conflicts with user-confirmed semantic merge, and covers cross-repo commit sets. Does not touch the workflow state machine.
---

# ec-git — git discipline

Activate for any git operation inside an Easy Coding project: pull, merge, rebase, commit,
push, PR. You manage git hygiene only — you never change session files, task status fields,
or trigger stage transitions.

Communicate with the user in the user's language.

## Commit policy for .easy-coding/

| Path | In commit set? | Why |
|---|---|---|
| `sessions/` | **never** | personal runtime state, differs per developer |
| `config.yaml` | yes | shared team config |
| `tasks/*/task.json` `dev-spec.md` `execution.jsonl` and code-task `test-strategy.md` | yes | per-task folders, no merge conflicts; team-readable decision record |
| `SOUL.md` `RULES.md` `ABSTRACT.md` `TEST_STRATEGY.md` `CHANGELOG.md` | yes | shared project knowledge |
| `memory/` | yes | shared knowledge sinks |
| `spec/` | yes | spec store |
| `spec/dev/` | only if user explicitly asks | dev-spec candidates for the *current* requirement, default out of commit |

`.easy-coding/` changes are part of the commit set by default (treated like code changes),
with `.easy-coding/sessions/` always excluded. The CLI already added it to `.gitignore`.

## Rules

1. **In-progress warning.** If the commit touches a task folder whose status is not COMPLETE,
   warn: "Task «X» is not finished — commit the intermediate state?" and wait.
2. **Conflict handling for `.easy-coding/`** (mostly `memory/`): first explain the conflict
   details to the user, get confirmation, then do an inductive semantic merge — never blindly
   pick ours/theirs. This requirement applies only to conflicts inside `.easy-coding/`.
3. **Cross-repo commit sets.** When a task spans repos (per the dev-spec / current task
   `repo_paths`), the commit/push covers every involved repo. Read `repo_paths` from the
   current task state to locate each checkout, check changes, and commit/push them as one
   coherent change set — do not leave a sub-repo behind.
4. **Supermodule two-step commits.** If the current repo has `.gitmodules`, or the current
   task touches a git submodule path, treat each submodule as an independent git boundary:
   commit and push child repos first, then commit and push the parent gitlink update. If a
   child repo is on a detached HEAD, stop and ask the user to choose or create a branch before
   committing there.
5. **No false success.** Never claim a commit or push succeeded without reading the command
   output. A failed push reported as success is a serious error.

## Boundaries

- Do not touch session files, task status fields, or run stage transitions — git only.
- Do not commit `.easy-coding/sessions/`.
- Do not commit `spec/dev/` unless the user explicitly asks.
- In a supermodule task launched from the parent root, parent `.easy-coding/` belongs to the
  parent git. Child `.easy-coding/memory/` changes created by memory archive belong to the
  owning child git and must be committed before the parent gitlink update.
