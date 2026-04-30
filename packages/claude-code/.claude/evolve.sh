#!/bin/bash
# evolve.sh — distill spark records into runtime/archive genes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

exec node "$SCRIPT_DIR/evolve.mjs" evolve --project-dir "$PROJECT_DIR"
