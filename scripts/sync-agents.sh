#!/usr/bin/env bash
# Thin compatibility wrapper. The Node implementation is the only sync authority.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/sync-agents.mjs"
