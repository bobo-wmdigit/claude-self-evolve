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
- `evolve-compact.sh` runs manual compaction.
- `evolve-health.sh` verifies an installation.
- `evolve.mjs` contains the current runtime implementation.

The installer merges hook commands into the target project's `.claude/settings.local.json` and keeps existing project hooks.

## Memory Files

The installed memory directory is the target project's `.evolve/`.

- `self-evolve.json`: local install metadata including installed version and source repository.
- `state.json`: local runtime state such as counters and timestamps.
- `spark.jsonl`: raw structured EVOLVE records.
- `audit.jsonl`: compact lifecycle events.
- `genes.runtime.md`: active rules injected into future turns.
- `genes.archive.md`: preserved historical rules not injected by default.
- `GENES.md` and `SPARK.md`: compatibility views generated from the canonical files.

## Runtime Flow

```text
UserPromptSubmit
  -> ensure .evolve layout
  -> increment counter
  -> inject state, runtime genes, and EVOLVE protocol

Stop
  -> read final assistant message
  -> parse [EVOLVE] JSON
  -> validate schema
  -> append record to spark.jsonl
  -> reset counter when a useful record is written
  -> compact when spark threshold is reached
```

## Compact Strategy

The current compact implementation is deterministic. It groups records by type, title, and action, ranks by frequency, confidence, and recency, then writes the top entries to `genes.runtime.md`.

This avoids model calls during v1 and keeps the runtime transparent.

## Adapter Boundary

The current runtime is invoked as:

```bash
node .claude/evolve.mjs hook --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs capture --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs compact --project-dir "$CLAUDE_PROJECT_DIR"
node .claude/evolve.mjs health --project-dir "$CLAUDE_PROJECT_DIR"
```

Future adapters should preserve these command semantics and translate their host tool's event model into `hook` and `capture` calls.
