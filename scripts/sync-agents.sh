#!/usr/bin/env bash
# Purpose: Symlink the repo's reusable Pi subagents into the user agent directory.
# Responsibilities: Resolve the repo root, ensure the target directory exists, and
#   create/update stable symlinks for all agent source files in this repo.
# Scope: Only manages files under ./agents and the destination agents directory.
# Usage: bash scripts/sync-agents.sh
# Invariants/Assumptions: Bash is available; agent source files live in ./agents;
#   PI_CODING_AGENT_DIR defaults to ~/.pi/agent when unset.

set -euo pipefail
shopt -s nullglob

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/agents"

mkdir -p "$DST"

removed=0
for target in "$DST"/*.md "$DST"/*.chain.md; do
  [[ -L "$target" ]] || continue
  link="$(readlink "$target")"
  case "$link" in
    "$ROOT"/agents/*)
      if [[ ! -e "$link" ]]; then
        rm "$target"
        printf 'removed stale %s -> %s\n' "$target" "$link"
        removed=$((removed + 1))
      fi
      ;;
  esac
done

count=0
for f in "$ROOT"/agents/*.md "$ROOT"/agents/*.chain.md; do
  ln -sfn "$f" "$DST/$(basename "$f")"
  printf 'linked %s -> %s\n' "$DST/$(basename "$f")" "$f"
  count=$((count + 1))
done

echo "Synced ${count} agent file(s), removed ${removed} stale symlink(s) in $DST"
