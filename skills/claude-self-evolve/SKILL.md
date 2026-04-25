---
name: claude-self-evolve
description: "Global installer and upgrader for Claude Self-Evolve. Use when the user wants to install, upgrade, update, check version, diagnose, repair, or maintain Claude Self-Evolve in the current Claude Code project; when they mention self-evolve memory, .evolve, EVOLVE protocol, project-local memory, Claude Code hooks, or ask whether a newer GitHub release is available."
---

# Claude Self-Evolve

Use this globally installed skill to install, upgrade, diagnose, and maintain Claude Self-Evolve in the current project.

The skill is global; the memory runtime is project-local. Never install project memory into global Claude Code settings. Each target project gets its own `.claude/` hooks and `.evolve/` memory.

## Default Repository

Use this repository unless the user gives another fork:

```text
https://github.com/bobo-wmdigit/claude-self-evolve
```

## Install Or Upgrade Workflow

1. Confirm the target is the current project directory, not a global Claude Code configuration directory.
2. Check whether `.evolve/self-evolve.json` exists and read `installed_version` if present.
3. Check the latest GitHub release:

   ```bash
   gh release view --repo bobo-wmdigit/claude-self-evolve --json tagName,url,publishedAt
   ```

   If `gh` is unavailable, use:

   ```bash
   git ls-remote --tags https://github.com/bobo-wmdigit/claude-self-evolve.git
   ```

4. Clone or update the repository in a temporary directory.
5. Inspect `install.sh` before running it.
6. Run `./install.sh /path/to/current/project`.
7. Run health check:

   ```bash
   CLAUDE_PROJECT_DIR=/path/to/current/project /path/to/current/project/.claude/evolve-health.sh
   ```

8. Report installed version, latest version, changed files, and health check result.

Re-running `install.sh` is the upgrade path. It updates scripts and hook wiring while preserving existing `.evolve/` memory data.

## Diagnose Workflow

1. Run health check first if `.claude/evolve-health.sh` exists.
2. Inspect `.claude/settings.local.json` only if health reports hook issues.
3. Inspect `.evolve/self-evolve.json` for installed version.
4. Inspect `.evolve/state.json`, `spark.jsonl`, and `audit.jsonl` only as needed.
5. Preserve `.evolve/` data files unless the user explicitly asks to reset memory.
6. Use `evolve-compact.sh` to rebuild runtime and archive genes from `spark.jsonl`.

## Important Files

- `.evolve/self-evolve.json`: local install metadata including installed version.
- `.evolve/spark.jsonl`: canonical raw experience records.
- `.evolve/genes.runtime.md`: active rules injected into future turns.
- `.evolve/genes.archive.md`: older rules preserved but not injected.
- `.evolve/audit.jsonl`: compact lifecycle events.
- `.evolve/state.json`: local counters and timestamps.
- `.claude/settings.local.json`: Claude Code hooks; merge, never replace.

## Commands

Install or upgrade from the repository root:

```bash
./install.sh /path/to/project
```

Health check:

```bash
CLAUDE_PROJECT_DIR=/path/to/project /path/to/project/.claude/evolve-health.sh
```

Manual compact:

```bash
CLAUDE_PROJECT_DIR=/path/to/project /path/to/project/.claude/evolve-compact.sh
```

Uninstall hooks while preserving data:

```bash
./uninstall.sh /path/to/project
```

## EVOLVE Records

Use `record=yes` for stable lessons, user corrections, recurring failure modes, and project constraints.

Use `record=no` for routine turns only while the counter is below the threshold.

The final block must be standalone:

```text
[EVOLVE]{"record":"yes","title":"Short title","type":"engineering-rule","scenario":"When it applies","lesson":"What was learned","action":"What to do next time","confidence":"high"}[/EVOLVE]
```

## Safety Rules

- The skill may be installed globally; the runtime must be installed per project.
- Do not delete `.evolve/` files unless explicitly requested.
- Do not remove existing non-evolve hooks.
- Do not claim installation is healthy until `evolve-health.sh` returns `issues: []`.
- Keep `genes.runtime.md` short and actionable.
