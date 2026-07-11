# Easy Coding Harness — Development Guide

## Project Overview

CLI scaffold that installs the Easy Coding harness into agent-native directories. Users run `easy-coding init` to deploy skills, hooks, sub-agents, and main constraint files for Claude Code, Codex, and Qoder.

The CLI is a pure file deployer — it does no project analysis. Project understanding is delegated to the `ec-init` skill at runtime.

## Architecture

```
src/
├── cli.ts                  # Entry point, commander setup
├── commands/               # CLI commands: init, add-agent, upgrade, status
├── configurators/          # Per-platform installers (claude, codex, qoder, shared)
├── constants/              # Paths, version (read from package.json)
├── templates/              # Source templates — built to templates/ by copy-templates.mjs
│   ├── common/skills/      # 11 stage skills + 1 bundled skill (ec-meta)
│   ├── main-constraint/    # CLAUDE.md.tpl / AGENTS.md.tpl
│   ├── claude/             # settings.json, agents/
│   ├── codex/              # hooks.json, config.toml, agents/
│   ├── qoder/              # settings.json, agents/
│   ├── shared-hooks/       # Python hooks shared across platforms
│   └── runtime/            # .easy-coding/ scaffold (memory templates)
├── types/                  # platform.ts, task.ts (Stage, Unit, ExecutionRecord)
├── ui/                     # banner.ts (CLI startup display)
└── utils/                  # File writer, config, gitignore, marked-region, etc.
```

### Key Concepts

- **Templates** live in `src/templates/`, built to `templates/` via `npm run copy-templates`. The build is a plain recursive copy.
- **Skill files** are `SKILL.md` — pure prompt templates consumed as-is by agents. They use `{{placeholder}}` syntax resolved at install time per platform.
- **Configurators** (`src/configurators/`) handle platform-specific file placement, hook registration, and main constraint generation.
- **Marked regions** (`src/utils/marked-region.ts`) enable safe partial updates of user-editable files (e.g., main constraint files) during `upgrade`.

### State Machine (runtime, not CLI)

The 6-stage workflow plus terminal states runs inside the agent, not in the CLI:

```
INIT → ANALYSIS → IMPLEMENT → REVIEW → VERIFICATION → MEMORY → COMPLETE
          ↑            ↑          │             │
          └── replan ───┘          └── repair ───┘
every edge requires explicit user confirmation by default; prefer native choice UI
```

Every legal edge is a user-confirmation gate by default; VERIFICATION also requires fresh
evidence. The CLI deploys the runtime and migrates legacy workflow metadata during upgrade.

## Development Conventions

### Build & Test

```bash
npm run build       # tsup compile + copy templates
npm test            # vitest
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
```

### Code Style

- TypeScript strict mode. Biome for formatting and linting.
- No default exports. Named exports only.
- Version is read from `package.json` at runtime (`src/constants/version.ts`) — never hardcode.

### Skill Templates (src/templates/common/skills/)

- Each skill is a single `SKILL.md` file with YAML frontmatter (`name`, `description`).
- Skill instructions are written in English; the agent responds in the user's language.
- Platform-specific placeholders: `{{skill_trigger}}`, `{{sub_agent_dispatch}}`, `{{platform_spawn_instruction}}`, `{{workflow_state_path}}`.
- Downstream skills reference dev-spec content semantically ("the change-scope table"), not by heading text — so section heading language can vary.

### Documentation Maintenance

- **CHANGELOG.md** is the single source of truth for version history. After every version change, add a new version section at the top of CHANGELOG.md with bullet points describing what changed.
- **README.md** must only summarize the versioning policy and link to CHANGELOG.md; do not put full release notes back into README.md.
- **package.json `files` must include CHANGELOG.md** so the npm package contains the file README.md links to.
- **Version bump workflow**: update `package.json` / `package-lock.json` version → add CHANGELOG.md entry → ensure README.md install commands and changelog link stay current → implement changes → build & test.
- Keep README.md's "12 个 skill" table and "三平台支持" table current when adding/removing skills or platforms.

### Adding a New Skill

1. Create `src/templates/common/skills/{skill-name}/SKILL.md` with frontmatter.
2. Register the skill trigger in platform configurators if needed.
3. Update README.md skill table.
4. Run `npm run build` to sync to `templates/`.

### Adding a New Platform

1. Create `src/configurators/{platform}.ts` implementing the configurator interface.
2. Add platform templates under `src/templates/{platform}/`.
3. Register in `src/configurators/index.ts` and `src/commands/platforms.ts`.
4. Add main constraint template in `src/templates/main-constraint/`.
5. Update README.md platform table.
