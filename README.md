# Claude Self-Evolve

Project-local memory pipeline for Claude Code.

中文说明见 [README.zh-CN.md](README.zh-CN.md).

Claude Self-Evolve captures useful lessons from Claude Code sessions inside one project, stores them as structured project-local records, and evolves them into reusable project rules that Claude can read from that project's `CLAUDE.md`.

It is not a reminder prompt, a global Claude Code setup, or a cross-project memory system. It is a hook-driven, file-based memory layer installed into each project separately.

## Status

This repository is Claude Code first and project-local by design. It does not install global Claude Code hooks or share memory across projects.

## Why

Project-specific lessons often disappear after a session:

- existing hooks that must not be overwritten
- commands that are safe or unsafe in a project
- local testing conventions
- recurring failure modes
- user preferences and review standards

Claude Self-Evolve turns those lessons into structured records and periodically evolves them into a small active rule set.

## How It Works

```text
User prompt
  -> Claude reads active runtime genes from CLAUDE.md
  -> Claude answers and emits an EVOLVE block
  -> Stop hook parses the EVOLVE block
  -> spark.jsonl stores the raw record
  -> evolve updates genes.runtime.md, genes.archive.md, and CLAUDE.md
```

## Quick Start

Requirements:

- Claude Code
- Bash
- Node.js

Recommended setup:

1. Install the companion skill globally in your agent skill library.
2. Use that skill to install or upgrade Claude Self-Evolve inside each target project.

The skill is global because it is an installer/upgrader. The memory runtime it installs is still project-local. See [skills/claude-self-evolve/SKILL.md](skills/claude-self-evolve/SKILL.md).

Install or update the global skill:

```bash
tmpdir="$(mktemp -d)"
git clone https://github.com/bobo-wmdigit/claude-self-evolve "$tmpdir/claude-self-evolve"
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/claude-self-evolve
cp -R "$tmpdir/claude-self-evolve/skills/claude-self-evolve" ~/.claude/skills/
```

If your agent uses a different global skills directory, copy `skills/claude-self-evolve` there instead.

Manual project install:

```bash
git clone https://github.com/bobo-wmdigit/claude-self-evolve.git
cd claude-self-evolve
./install.sh /path/to/your-claude-code-project
```

Run the installer once per project that should have its own memory. Do not install it into a global Claude Code configuration directory.

## Global Installer Skill

`skills/claude-self-evolve` is designed to be installed globally in the agent's skill library. Its job is to:

- install Claude Self-Evolve into the current project
- check GitHub for the latest release
- compare the latest release with `.evolve/self-evolve.json`
- upgrade the current project by re-running the latest `install.sh`
- preserve project hooks and `.evolve` data during upgrades

The global skill does not make memory global. It only gives the agent a reusable install and upgrade workflow.

After copying the skill into your global skill directory, ask your agent:

```text
Use the claude-self-evolve skill to install or upgrade Claude Self-Evolve in this project.
```

## Install Or Upgrade With The Global Skill

After installing the global skill, users can copy this prompt into Claude Code while inside the target project:

```text
Use the claude-self-evolve skill to install or upgrade Claude Self-Evolve in this project.

Please check the latest GitHub release, compare it with this project's installed version if present, run the installer against only this project, then run the health check.
```

Chinese copy-paste prompt: [docs/claude-code-copy-prompt.zh-CN.md](docs/claude-code-copy-prompt.zh-CN.md).

Run a health check:

```bash
CLAUDE_PROJECT_DIR=/path/to/your-claude-code-project \
  /path/to/your-claude-code-project/.claude/evolve-health.sh
```

Run manual evolve:

```bash
CLAUDE_PROJECT_DIR=/path/to/your-claude-code-project \
  /path/to/your-claude-code-project/.claude/evolve.sh
```

## EVOLVE Protocol

Claude should end each response with one standalone EVOLVE block.

Useful lesson:

```text
[EVOLVE]{"record":"yes","title":"Installers must merge existing hooks","type":"engineering-rule","scenario":"Target project already has .claude/settings.local.json","lesson":"Overwriting UserPromptSubmit breaks existing project automation","action":"Merge hook commands idempotently instead of replacing settings","confidence":"high"}[/EVOLVE]
```

Routine turn:

```text
[EVOLVE]{"record":"no","reason":"routine turn"}[/EVOLVE]
```

When the counter reaches the configured threshold, `record=no` is rejected and the Stop hook asks Claude to emit a useful record.

## Files Installed

```text
target-project/
├── .claude/
│   ├── evolve.mjs
│   ├── evolve-hook.sh
│   ├── evolve-capture.sh
│   ├── evolve.sh
│   ├── evolve-compact.sh
│   ├── evolve-health.sh
│   └── settings.local.json
├── .evolve/
│   ├── self-evolve.json
│   ├── state.json
│   ├── spark.jsonl
│   ├── archive/
│   ├── audit.jsonl
│   ├── genes.runtime.md
│   └── genes.archive.md
└── CLAUDE.md
```

## Safety Model

- Local first: no network calls are made by the runtime.
- Project scoped: memory lives under the target project's `.evolve/`.
- No global hooks: installation only changes the target project's `.claude/` files.
- Merge only: installation preserves existing Claude Code hooks.
- Data preserving: reinstalling updates scripts but does not overwrite existing `.evolve` data.
- Auditable: evolve lifecycle events are written to `.evolve/audit.jsonl`.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `EVOLVE_THRESHOLD` | `5` | Turns before a useful record is required |
| `EVOLVE_COUNTER_WINDOW` | `1800` | Seconds before the turn counter resets |
| `EVOLVE_COMPACT_THRESHOLD` | `10` | Spark records before automatic evolve |
| `EVOLVE_RUNTIME_LIMIT` | `12` | Maximum active runtime genes |
| `EVOLVE_SPARK_RETAIN` | `100` | Recent raw records to keep in active `spark.jsonl` after evolve |
| `EVOLVE_AUDIT_RETAIN` | `500` | Recent audit events to keep in active `audit.jsonl` |

## Repository Layout

```text
packages/claude-code/        Claude Code adapter and templates
skills/claude-self-evolve/   Global installer/upgrader skill
docs/                        Architecture and user documentation
examples/                    Minimal install examples
```

## Development

The installed runtime uses Node.js standard library only and does not require npm packages.

For repository changes, use the branch-and-PR workflow in [CONTRIBUTING.md](CONTRIBUTING.md).

## Uninstall

Remove hook references while preserving memory data:

```bash
./uninstall.sh /path/to/your-claude-code-project
```

The uninstall script intentionally keeps `.evolve/` and copied scripts in place so project memory can be inspected, backed up, or removed manually.

## Roadmap

- v0.1: Claude Code local hook integration
- v0.2: safer installer, uninstaller, and doctor command
- v0.3: CLAUDE.md runtime sync, companion skill, richer examples
- v0.4: release packaging and CI
- v0.5: adapter boundary for other agentic coding tools
