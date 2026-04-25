# Claude Code Copy Prompt

Use this page as the copy-paste installation or upgrade prompt for GitHub users.

Preferred flow: install `skills/claude-self-evolve` globally first, then use it from inside each target project.

```text
Use the claude-self-evolve skill to install or upgrade Claude Self-Evolve in this project.

Please check the latest GitHub release, compare it with this project's installed version if present, run the installer against only this project, then run the health check.
```

## Short Version

```text
Use the claude-self-evolve skill to install or upgrade this project. Preserve existing hooks and .evolve data. Do not modify global Claude Code settings except for the already installed global skill.
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
