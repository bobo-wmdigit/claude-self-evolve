#!/bin/bash
# install.sh - install Claude Self-Evolve into a Claude Code project.

set -euo pipefail

TARGET="${1:-.}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$ROOT/packages/claude-code"
VERSION_FILE="$ROOT/VERSION"
VERSION="unknown"
if [ -f "$VERSION_FILE" ]; then
    VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
fi

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "error: missing dependency: $1" >&2
        exit 1
    fi
}

merge_settings() {
    local target_file="$1"
    node - "$target_file" <<'JS'
const fs = require("node:fs");
const target = process.argv[2];
let settings = {};

if (fs.existsSync(target)) {
  try {
    settings = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    console.error(`settings.local.json is not valid JSON: ${error.message}`);
    process.exit(1);
  }
}

settings.permissions ||= {};
settings.permissions.allow ||= ["Bash(*)", "Skill(*)", "WebSearch", "WebFetch(*)"];
settings.permissions.deny ||= ["Bash(rm *)", "Bash(rm -*)"];
settings.hooks ||= {};

function ensureCommand(eventName, command) {
  const matchers = settings.hooks[eventName] ||= [];
  for (const matcher of matchers) {
    const hooks = matcher.hooks ||= [];
    if (hooks.some((hook) => hook.type === "command" && hook.command === command)) return;
  }
  matchers.push({ matcher: "", hooks: [{ type: "command", command }] });
}

ensureCommand("UserPromptSubmit", "$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh");
ensureCommand("Stop", "$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh");

fs.writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
JS
}

copy_if_missing() {
    local source_file="$1"
    local target_file="$2"
    if [ ! -f "$target_file" ]; then
        cp "$source_file" "$target_file"
    fi
}

require_cmd bash
require_cmd node

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
for file in evolve.mjs evolve-hook.sh evolve-capture.sh evolve-compact.sh evolve-health.sh evolve-verify.sh; do
    cp "$SOURCE/.claude/$file" "$TARGET/.claude/$file"
done
mkdir -p "$TARGET/.claude/lib"
for file in evolve-core.js; do
    cp "$SOURCE/.claude/lib/$file" "$TARGET/.claude/lib/$file"
done
chmod +x \
    "$TARGET/.claude/evolve.mjs" \
    "$TARGET/.claude/evolve-hook.sh" \
    "$TARGET/.claude/evolve-capture.sh" \
    "$TARGET/.claude/evolve-compact.sh" \
    "$TARGET/.claude/evolve-health.sh" \
    "$TARGET/.claude/evolve-verify.sh"

echo "==> Merging .claude/settings.local.json ..."
merge_settings "$TARGET/.claude/settings.local.json"

echo "==> Initializing .evolve templates ..."
for file in state.json spark.jsonl audit.jsonl genes.runtime.md genes.archive.md; do
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
for entry in ".evolve/state.json" ".evolve/self-evolve.json" ".evolve/lock" ".claude/__pycache__/"; do
    if ! grep -Fxq "$entry" "$TARGET/.gitignore"; then
        printf "%s\n" "$entry" >> "$TARGET/.gitignore"
    fi
done

echo "==> Writing install metadata ..."
node - "$TARGET/.evolve/self-evolve.json" "$VERSION" <<'JS'
const fs = require("node:fs");
const [target, version] = process.argv.slice(2);
let previous = {};
if (fs.existsSync(target)) {
  try {
    previous = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    previous = {};
  }
}
const payload = {
  schema_version: 1,
  installed_version: version,
  installed_at: new Date().toISOString(),
  source_repo: "https://github.com/bobo-wmdigit/claude-self-evolve",
  scope: "project",
  previous_installed_version: previous.installed_version || "",
};
fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
JS

echo "==> Running health check ..."
CLAUDE_PROJECT_DIR="$TARGET" "$TARGET/.claude/evolve-health.sh" >/dev/null

echo
echo "==> Installation complete"
echo "Version: $VERSION"
echo "Health check:"
echo "  CLAUDE_PROJECT_DIR=\"$TARGET\" \"$TARGET/.claude/evolve-health.sh\""
echo "Manual compact:"
echo "  CLAUDE_PROJECT_DIR=\"$TARGET\" \"$TARGET/.claude/evolve-compact.sh\""
