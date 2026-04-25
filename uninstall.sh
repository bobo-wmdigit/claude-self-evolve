#!/bin/bash
# uninstall.sh - remove Claude Self-Evolve hooks from a Claude Code project.

set -euo pipefail

TARGET="${1:-.}"

if [ ! -d "$TARGET" ]; then
    echo "error: target directory does not exist: $TARGET" >&2
    exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
SETTINGS="$TARGET/.claude/settings.local.json"

echo "==> Uninstalling Claude Self-Evolve from $TARGET"

if [ -f "$SETTINGS" ]; then
    node - "$SETTINGS" <<'JS'
const fs = require("node:fs");
const path = process.argv[2];
const settings = JSON.parse(fs.readFileSync(path, "utf8"));
const hooks = settings.hooks || {};
const commandsToRemove = new Set([
  "$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh",
  "$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh",
  "$CLAUDE_PROJECT_DIR/.claude/evolve-verify.sh",
]);

for (const eventName of Object.keys(hooks)) {
  const keptMatchers = [];
  for (const matcher of hooks[eventName] || []) {
    const keptHooks = (matcher.hooks || []).filter((hook) => !commandsToRemove.has(hook.command));
    if (keptHooks.length > 0) {
      matcher.hooks = keptHooks;
      keptMatchers.push(matcher);
    }
  }
  if (keptMatchers.length > 0) hooks[eventName] = keptMatchers;
  else delete hooks[eventName];
}

fs.writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
JS
    echo "    removed hook references from settings.local.json"
fi

echo
echo "==> Uninstall complete"
echo "Data is preserved in $TARGET/.evolve"
echo "Hook scripts are preserved in $TARGET/.claude so you can inspect or remove them manually."
