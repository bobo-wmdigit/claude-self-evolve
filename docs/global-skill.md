# Global Installer Skill

The `skills/claude-self-evolve` folder is intended to be installed globally in an agent's skill library.

This global skill is an installer and upgrader. It teaches the agent how to install, check, upgrade, and diagnose Claude Self-Evolve inside the current project.

The project memory itself is not global. The runtime installed by the skill remains scoped to one project:

- project hooks live under `.claude/`
- project memory lives under `.evolve/`
- install metadata lives in `.evolve/self-evolve.json`

## Install The Skill

Copy the skill folder into your agent's global skills directory. For Claude Code, a common location is `~/.claude/skills`:

```bash
tmpdir="$(mktemp -d)"
git clone https://github.com/bobo-wmdigit/claude-self-evolve "$tmpdir/claude-self-evolve"
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/claude-self-evolve
cp -R "$tmpdir/claude-self-evolve/skills/claude-self-evolve" ~/.claude/skills/
```

If your agent uses a different global skills directory, copy `skills/claude-self-evolve` there instead.

## Suggested Trigger

Ask the agent:

```text
Use the claude-self-evolve skill to install or upgrade Claude Self-Evolve in this project.
```

## Upgrade Behavior

The skill should:

1. Read `.evolve/self-evolve.json` when present.
2. Check the latest GitHub release.
3. Compare the installed version with the latest release.
4. Clone the latest repository into a temporary directory.
5. Inspect `install.sh`.
6. Re-run `install.sh` against the current project.
7. Run `.claude/evolve-health.sh`.

Re-running the installer is the supported upgrade path. It preserves `.evolve/` memory and merges existing project hooks.
