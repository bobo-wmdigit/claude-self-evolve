# Troubleshooting

## Run Health Check First

```bash
CLAUDE_PROJECT_DIR=/path/to/project /path/to/project/.claude/evolve-health.sh
```

Healthy output contains:

```json
{
  "issues": []
}
```

## Hook Is Not Running

Check `.claude/settings.local.json` for:

- `$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh` under `UserPromptSubmit`
- `$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh` under `Stop`

Re-run `./install.sh /path/to/project` to merge missing hooks.

## EVOLVE Block Is Rejected

Make sure the block is the final standalone block and the JSON is a single line.

Common failures:

- missing required field
- invalid JSON quotes
- `confidence` outside `low`, `medium`, `high`
- `record=no` after the counter reached `EVOLVE_THRESHOLD`

## Runtime Context Is Too Large

Run:

```bash
CLAUDE_PROJECT_DIR=/path/to/project /path/to/project/.claude/evolve-compact.sh
```

Then edit `.evolve/genes.runtime.md` if the active rules still contain low-value entries.
