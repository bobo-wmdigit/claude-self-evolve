#!/bin/bash
# evolve-capture.sh — Stop hook wrapper

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

exec python3 "$SCRIPT_DIR/evolve.py" capture --project-dir "$PROJECT_DIR"
