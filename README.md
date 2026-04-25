# Claude Self-Evolve

Project-local memory pipeline for Claude Code.

中文说明见 [README.zh-CN.md](README.zh-CN.md).

Claude Self-Evolve captures useful lessons from Claude Code sessions inside one project, stores them as structured project-local records, and compacts them into reusable project rules that are injected into future turns for that same project.

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

Claude Self-Evolve turns those lessons into structured records and periodically compacts them into a small active rule set.

## How It Works

```text
User prompt
  -> UserPromptSubmit hook injects active runtime genes
  -> Claude answers and emits an EVOLVE block
  -> Stop hook parses the EVOLVE block
  -> spark.jsonl stores the raw record
  -> compact updates genes.runtime.md and genes.archive.md
```

## Quick Start

Requirements:

- Claude Code
- Bash
- Node.js

Clone this repository and install it into a Claude Code project:

```bash
git clone https://github.com/bobo-wmdigit/claude-self-evolve.git
cd claude-self-evolve
./install.sh /path/to/your-claude-code-project
```

Run the installer once per project that should have its own memory. Do not install it into a global Claude Code configuration directory.

## Install With Claude Code

After this project is published on GitHub, users can copy this prompt into Claude Code while inside the target project:

```text
Install Claude Self-Evolve into this project.

Repository: https://github.com/bobo-wmdigit/claude-self-evolve

Please:
1. Clone the repository into a temporary directory.
2. Inspect install.sh before running it.
3. Run ./install.sh against the current project directory.
4. Run .claude/evolve-health.sh with CLAUDE_PROJECT_DIR set to this project.
5. Tell me what files were installed and whether the health check passed.

Do not overwrite existing Claude Code hooks. Preserve any existing .evolve data.
Install only into this project, not into global Claude Code settings.
```

Chinese copy-paste prompt: [docs/claude-code-copy-prompt.zh-CN.md](docs/claude-code-copy-prompt.zh-CN.md).

Run a health check:

```bash
CLAUDE_PROJECT_DIR=/path/to/your-claude-code-project \
  /path/to/your-claude-code-project/.claude/evolve-health.sh
```

Run manual compact:

```bash
CLAUDE_PROJECT_DIR=/path/to/your-claude-code-project \
  /path/to/your-claude-code-project/.claude/evolve-compact.sh
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
│   ├── evolve-compact.sh
│   ├── evolve-health.sh
│   └── settings.local.json
├── .evolve/
│   ├── state.json
│   ├── spark.jsonl
│   ├── audit.jsonl
│   ├── genes.runtime.md
│   ├── genes.archive.md
│   ├── GENES.md
│   └── SPARK.md
└── CLAUDE.md
```

## Safety Model

- Local first: no network calls are made by the runtime.
- Project scoped: memory lives under the target project's `.evolve/`.
- No global hooks: installation only changes the target project's `.claude/` files.
- Merge only: installation preserves existing Claude Code hooks.
- Data preserving: reinstalling updates scripts but does not overwrite existing `.evolve` data.
- Auditable: compact events are written to `.evolve/audit.jsonl`.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `EVOLVE_THRESHOLD` | `5` | Turns before a useful record is required |
| `EVOLVE_COUNTER_WINDOW` | `1800` | Seconds before the turn counter resets |
| `EVOLVE_COMPACT_THRESHOLD` | `10` | Spark records before automatic compact |
| `EVOLVE_RUNTIME_LIMIT` | `12` | Maximum active runtime genes |

## Repository Layout

```text
packages/claude-code/        Claude Code adapter and templates
skills/claude-self-evolve/   Companion skill for operating this system
docs/                        Architecture and user documentation
examples/                    Minimal install examples
```

## Development

The installed runtime uses Node.js standard library only and does not require npm packages.

## Uninstall

Remove hook references while preserving memory data:

```bash
./uninstall.sh /path/to/your-claude-code-project
```

The uninstall script intentionally keeps `.evolve/` and copied scripts in place so project memory can be inspected, backed up, or removed manually.

## Roadmap

- v0.1: Claude Code local hook integration
- v0.2: safer installer, uninstaller, and doctor command
- v0.3: companion skill and richer examples
- v0.4: release packaging and CI
- v0.5: adapter boundary for other agentic coding tools
