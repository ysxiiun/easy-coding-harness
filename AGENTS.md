# Easy Coding Harness — Development Guide

## Project Overview

CLI scaffold that installs the Easy Coding harness into agent-native directories. Users run `easy-coding init` to deploy skills, hooks, sub-agents, and main constraint files for Claude Code, Codex, and Qoder.

The CLI is a pure file deployer — it does no project analysis.

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

- **Templates** live in `src/templates/`, built to `templates/` via `npm run copy-templates` (plain recursive copy).
- **Skill files** are `SKILL.md` — pure prompt templates consumed as-is by agents. They use `{{placeholder}}` syntax resolved at install time per platform.
- **Configurators** (`src/configurators/`) handle platform-specific file placement, hook registration, and main constraint generation.

### Runtime State Machine (agent-side, not CLI)

```
INIT → ANALYSIS → IMPLEMENT → REVIEW → VERIFICATION → MEMORY → COMPLETE
          ↑            ↑          │             │
          └── replan ───┘          └── repair ───┘
every edge requires explicit user confirmation by default; prefer native choice UI
```

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
- Version is read from `package.json` at runtime — never hardcode.

### Documentation Maintenance

- **CHANGELOG.md** is the single source of truth for version history. After every version change, add a new entry at the top of CHANGELOG.md.
- **README.md** must only summarize the versioning policy and link to CHANGELOG.md; do not put full release notes back into README.md.
- **package.json `files` must include CHANGELOG.md** so the npm package contains the file README.md links to.
- **Version bump workflow**: update `package.json` / `package-lock.json` version → add CHANGELOG.md entry → ensure README.md install commands and changelog link stay current → implement changes → build & test.
- Keep README.md skill table and platform table current when adding/removing skills or platforms.
