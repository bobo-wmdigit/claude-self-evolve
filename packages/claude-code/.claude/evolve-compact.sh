#!/bin/bash
# evolve-compact.sh — compile spark records into runtime/archive genes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

exec python3 "$SCRIPT_DIR/evolve.py" compact --project-dir "$PROJECT_DIR"
