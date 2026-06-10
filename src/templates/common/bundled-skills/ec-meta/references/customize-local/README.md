# Customize Local

How to change the harness locally without losing it on `easy-coding upgrade`.

## The upgrade boundary (read this first)

`easy-coding upgrade` **overwrites** all harness-managed files for installed platforms:

- `ec-*` skill directories (every `SKILL.md` and bundled file)
- shared hook scripts
- generated hook configuration (settings.json / hooks.json)
- sub-agent definitions
- the **generated region** of `CLAUDE.md` / `AGENTS.md` (between the markers)

`easy-coding upgrade` **never touches**:

- `config.yaml` (only `harness_version` is bumped)
- `state.json`, `tasks/`, `memory/`, `spec/`
- `SOUL.md` / `RULES.md` / `ABSTRACT.md` / `TEST_STRATEGY.md` / `CHANGELOG.md`
- the user region of `CLAUDE.md` / `AGENTS.md` (outside the markers)

So: durable customization goes in a non-managed location. Editing a managed file directly is
fine for a quick local tweak, but it will be reverted on the next upgrade.

## Change the workflow behavior

For project-specific workflow nuance, prefer `.easy-coding/RULES.md` or the project custom
instructions (below the markers in CLAUDE.md/AGENTS.md) — both survive upgrades. Only edit
the local `ec-workflow/SKILL.md` for a deliberate, project-owned fork of the workflow, and
know it will be overwritten on upgrade unless you also fork the scaffold.

## Change coding rules

Edit `.easy-coding/RULES.md` (created by `ec-init`). It is project-owned, in git, and never
touched by upgrade. This is the right home for naming conventions, comment language, error
handling style, and per-module `.d/` overrides.

## Add a custom skill

Drop a new `{skills-dir}/my-skill/SKILL.md` into the platform skills directory. The agent
discovers it natively via `/` or `$`. Non-`ec-*` skills are not managed by the harness, so
upgrade leaves them alone. Keep the `ec-` prefix reserved for harness skills.

## Change hook behavior

The hook scripts are managed (overwritten on upgrade). For a project-specific toggle, the
scripts honor the `EC_HOOKS=0` environment variable to disable injection entirely. For
anything more, fork the scaffold rather than editing the installed copy in place.

## Project custom instructions

The safest place for standing instructions is the region **below the markers** in
`CLAUDE.md` / `AGENTS.md`. The harness generates only the region between the markers and
replaces only that on upgrade; everything below is yours.
