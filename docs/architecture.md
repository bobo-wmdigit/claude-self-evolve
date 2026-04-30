# Architecture

Claude Self-Evolve is project-local. Each installation belongs to one target project and stores memory under that project's `.evolve/` directory.

It does not install global Claude Code hooks and does not share memory across projects.

Claude Self-Evolve has three layers:

1. Claude Code adapter
2. Local memory runtime
3. Agent-facing operation guide

## Claude Code Adapter

The adapter lives in `packages/claude-code/.claude/`.

- `evolve-hook.sh` is installed as a `UserPromptSubmit` hook.
- `evolve-capture.sh` is installed as a `Stop` hook.
- `evolve.sh` runs manual evolution.
- `evolve-compact.sh` remains as a legacy alias.
- `evolve-health.sh` verifies an installation.
- `evolve.mjs` contains the current runtime implementation.

The installer merges hook commands into the target project's `.claude/settings.local.json` and keeps existing project hooks.

## Memory Files

The installed memory directory is the target project's `.evolve/`.

- `self-evolve.json`: local install metadata including installed version and source repository.
- `state.json`: local runtime state such as counters and timestamps.
- `spark.jsonl`: raw structured EVOLVE records.
- `archive/spark-YYYY-MM.jsonl`: evolved raw records archived by month.
- `audit.jsonl`: evolve lifecycle events.
- `genes.runtime.md`: active rules synced into `CLAUDE.md`.
- `genes.archive.md`: preserved historical rules not synced by default.

## Runtime Flow

```text
UserPromptSubmit
  -> ensure .evolve layout
  -> increment counter
  -> update state; Claude reads runtime genes and EVOLVE protocol from CLAUDE.md

Stop
  -> read final assistant message
  -> parse [EVOLVE] JSON
  -> validate schema
  -> append record to spark.jsonl
  -> reset counter when a useful record is written
  -> evolve when spark threshold is reached
```

## Evolve Strategy

The current evolve implementation is deterministic. It groups records by type, title, and action (case-insensitive), aggregates count/confidence, then ranks by a composite score:

```
score = count * confidenceScore * 1 / (1 + DECAY_RATE * ageInHours)
```

where `DECAY_RATE` defaults to `0.01` per hour (half-life ~100h). This ensures old, infrequent rules naturally decay below newer ones. Top entries go to `genes.runtime.md`, the rest to `genes.archive.md`.

This avoids model calls and keeps the runtime transparent.

After evolve, active `spark.jsonl` is trimmed to the latest `EVOLVE_SPARK_RETAIN` records, while processed raw records are deduplicated into monthly archive files under `.evolve/archive/`. Evolve reads active and archived spark records together, so trimming active `spark.jsonl` does not discard old lessons.

`audit.jsonl` is trimmed to the latest `EVOLVE_AUDIT_RETAIN` events.

The runtime also tracks missing EVOLVE blocks: when the assistant reply contains no valid EVOLVE block, an audit event is appended for observability.

## Adapter Boundary

The current runtime is invoked as:

```bash
node .claude/evolve.mjs hook --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs capture --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs evolve --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs health --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs backup --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs restore --project-dir "$CLAUDE_PROJECT_DIR"
```

Core semantics: `hook` (update state), `capture` (parse + validate + store), `evolve` (group + rank + write genes), `health` (diagnose). Optional: `backup` / `restore` (archive / recover `.evolve/` data). `compact` remains accepted as a compatibility alias.

Future adapters should preserve these command semantics and translate their host tool's event model into `hook` and `capture` calls.
