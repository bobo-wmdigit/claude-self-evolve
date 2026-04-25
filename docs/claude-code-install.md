# Claude Code Install

Install into a target project:

```bash
./install.sh /path/to/project
```

The installer:

1. Copies hook scripts into `.claude/`.
2. Merges hook commands into `.claude/settings.local.json`.
3. Initializes missing `.evolve/` files.
4. Appends the EVOLVE protocol to `CLAUDE.md`.
5. Adds transient memory files to `.gitignore`.
6. Runs a health check.

Reinstalling is supported. Scripts are updated, hook entries are deduplicated, and existing `.evolve/` data is preserved.

## Verify

```bash
CLAUDE_PROJECT_DIR=/path/to/project /path/to/project/.claude/evolve-health.sh
```

The command prints JSON with `issues: []` when the installation is healthy.

## Uninstall

```bash
./uninstall.sh /path/to/project
```

Uninstall removes hook references from settings but preserves `.evolve/` data.
