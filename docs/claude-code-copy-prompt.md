# Claude Code Copy Prompt

Use this page as the copy-paste installation prompt for GitHub users.

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

## Short Version

```text
Install https://github.com/bobo-wmdigit/claude-self-evolve into this Claude Code project only. Inspect install.sh first, run it against the current project, then run the health check. Preserve existing hooks and .evolve data. Do not modify global Claude Code settings.
```

## Expected Claude Code Actions

Claude Code should run commands similar to:

```bash
tmpdir="$(mktemp -d)"
git clone https://github.com/bobo-wmdigit/claude-self-evolve "$tmpdir/claude-self-evolve"
cd "$tmpdir/claude-self-evolve"
./install.sh /path/to/current/project
CLAUDE_PROJECT_DIR=/path/to/current/project /path/to/current/project/.claude/evolve-health.sh
```

Do not ask users to run a remote `curl | bash` command as the primary path. The copy prompt keeps Claude Code in the loop so it can inspect the installer and report what changed.
