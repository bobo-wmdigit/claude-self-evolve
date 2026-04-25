#!/bin/bash
# install.sh - install Claude Self-Evolve into a Claude Code project.

set -euo pipefail

TARGET="${1:-.}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$ROOT/packages/claude-code"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "error: missing dependency: $1" >&2
        exit 1
    fi
}

merge_settings() {
    local target_file="$1"
    python3 - "$target_file" <<'PY'
import json
import sys
from pathlib import Path

target = Path(sys.argv[1])
if target.exists():
    try:
        settings = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"settings.local.json is not valid JSON: {exc}")
else:
    settings = {}

settings.setdefault("permissions", {})
settings["permissions"].setdefault("allow", ["Bash(*)", "Skill(*)", "WebSearch", "WebFetch(*)"])
settings["permissions"].setdefault("deny", ["Bash(rm *)", "Bash(rm -*)"])
settings.setdefault("hooks", {})

def ensure_command(event_name: str, command: str) -> None:
    matchers = settings["hooks"].setdefault(event_name, [])
    for matcher in matchers:
        hooks = matcher.setdefault("hooks", [])
        for hook in hooks:
            if hook.get("type") == "command" and hook.get("command") == command:
                return
    matchers.append({"matcher": "", "hooks": [{"type": "command", "command": command}]})

ensure_command("UserPromptSubmit", "$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh")
ensure_command("Stop", "$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh")

target.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

copy_if_missing() {
    local source_file="$1"
    local target_file="$2"
    if [ ! -f "$target_file" ]; then
        cp "$source_file" "$target_file"
    fi
}

require_cmd bash
require_cmd python3

if [ ! -d "$SOURCE/.claude" ] || [ ! -d "$SOURCE/.evolve" ]; then
    echo "error: package files not found under $SOURCE" >&2
    exit 1
fi

if [ ! -d "$TARGET" ]; then
    echo "error: target directory does not exist: $TARGET" >&2
    exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"

echo "==> Installing Claude Self-Evolve into $TARGET"

mkdir -p "$TARGET/.claude" "$TARGET/.evolve"

echo "==> Copying Claude Code hook scripts ..."
for file in evolve.py evolve-hook.sh evolve-capture.sh evolve-compact.sh evolve-health.sh evolve-verify.sh; do
    cp "$SOURCE/.claude/$file" "$TARGET/.claude/$file"
done
chmod +x \
    "$TARGET/.claude/evolve.py" \
    "$TARGET/.claude/evolve-hook.sh" \
    "$TARGET/.claude/evolve-capture.sh" \
    "$TARGET/.claude/evolve-compact.sh" \
    "$TARGET/.claude/evolve-health.sh" \
    "$TARGET/.claude/evolve-verify.sh"

echo "==> Merging .claude/settings.local.json ..."
merge_settings "$TARGET/.claude/settings.local.json"

echo "==> Initializing .evolve templates ..."
for file in state.json spark.jsonl audit.jsonl genes.runtime.md genes.archive.md GENES.md SPARK.md .counter; do
    copy_if_missing "$SOURCE/.evolve/$file" "$TARGET/.evolve/$file"
done

echo "==> Updating CLAUDE.md ..."
if [ -f "$TARGET/CLAUDE.md" ]; then
    if grep -q "## 自进化机制（/.evolve/）" "$TARGET/CLAUDE.md"; then
        echo "    CLAUDE.md already contains Self-Evolve instructions; skipped"
    else
        printf "\n" >> "$TARGET/CLAUDE.md"
        cat "$SOURCE/CLAUDE-EVOLVE-MD.md" >> "$TARGET/CLAUDE.md"
        echo "    appended Self-Evolve instructions"
    fi
else
    cp "$SOURCE/CLAUDE-EVOLVE-MD.md" "$TARGET/CLAUDE.md"
    echo "    created CLAUDE.md"
fi

echo "==> Updating .gitignore ..."
if [ ! -f "$TARGET/.gitignore" ]; then
    touch "$TARGET/.gitignore"
fi
for entry in ".evolve/state.json" ".evolve/lock" ".evolve/.counter" ".claude/__pycache__/"; do
    if ! grep -Fxq "$entry" "$TARGET/.gitignore"; then
        printf "%s\n" "$entry" >> "$TARGET/.gitignore"
    fi
done

echo "==> Running health check ..."
CLAUDE_PROJECT_DIR="$TARGET" "$TARGET/.claude/evolve-health.sh" >/dev/null

echo
echo "==> Installation complete"
echo "Health check:"
echo "  CLAUDE_PROJECT_DIR=\"$TARGET\" \"$TARGET/.claude/evolve-health.sh\""
echo "Manual compact:"
echo "  CLAUDE_PROJECT_DIR=\"$TARGET\" \"$TARGET/.claude/evolve-compact.sh\""
