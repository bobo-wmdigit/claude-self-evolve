#!/bin/bash
# evolve-hook.sh — UserPromptSubmit hook wrapper

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

exec node "$SCRIPT_DIR/evolve.mjs" hook --project-dir "$PROJECT_DIR"
