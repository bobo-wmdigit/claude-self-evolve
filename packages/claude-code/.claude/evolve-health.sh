#!/bin/bash
# evolve-health.sh — validate local self-evolve installation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

exec node "$SCRIPT_DIR/evolve.mjs" health --project-dir "$PROJECT_DIR"
