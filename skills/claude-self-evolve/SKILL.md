---
name: claude-self-evolve
description: "Use when working with Claude Self-Evolve: installing or maintaining the Claude Code hook-based local memory pipeline, diagnosing .evolve state, compacting spark records, repairing EVOLVE protocol issues, or preparing project memory rules for Claude Code."
---

# Claude Self-Evolve

Use this skill to operate a Claude Self-Evolve installation. Treat Claude Code support as the primary path.

## Workflow

1. If the target project may already be installed, run its health check first.
2. Install or repair using the repository `install.sh`; do not manually overwrite `.claude/settings.local.json`.
3. Preserve `.evolve/` data files unless the user explicitly asks to reset memory.
4. Use `evolve-compact.sh` to rebuild runtime and archive genes from `spark.jsonl`.
5. Verify with `evolve-health.sh` before declaring the setup fixed.

## Important Files

- `.evolve/spark.jsonl`: canonical raw experience records.
- `.evolve/genes.runtime.md`: active rules injected into future turns.
- `.evolve/genes.archive.md`: older rules preserved but not injected.
- `.evolve/audit.jsonl`: compact lifecycle events.
- `.evolve/state.json`: local counters and timestamps.
- `.claude/settings.local.json`: Claude Code hooks; merge, never replace.

## Commands

Install from the repository root:

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

- Do not delete `.evolve/` files unless explicitly requested.
- Do not remove existing non-evolve hooks.
- Do not claim installation is healthy until `evolve-health.sh` returns `issues: []`.
- Keep `genes.runtime.md` short and actionable.
