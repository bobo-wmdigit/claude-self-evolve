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
    python3 - "$SETTINGS" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
settings = json.loads(path.read_text(encoding="utf-8"))
hooks = settings.get("hooks", {})
commands_to_remove = {
    "$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh",
    "$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh",
    "$CLAUDE_PROJECT_DIR/.claude/evolve-verify.sh",
}

for event_name, matchers in list(hooks.items()):
    kept_matchers = []
    for matcher in matchers:
        kept_hooks = [
            hook for hook in matcher.get("hooks", [])
            if hook.get("command") not in commands_to_remove
        ]
        if kept_hooks:
            matcher["hooks"] = kept_hooks
            kept_matchers.append(matcher)
    if kept_matchers:
        hooks[event_name] = kept_matchers
    else:
        hooks.pop(event_name, None)

path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
    echo "    removed hook references from settings.local.json"
fi

echo
echo "==> Uninstall complete"
echo "Data is preserved in $TARGET/.evolve"
echo "Hook scripts are preserved in $TARGET/.claude so you can inspect or remove them manually."
