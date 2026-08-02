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
skipped=0
for f in "$ROOT"/agents/*.md "$ROOT"/agents/*.chain.md; do
  target="$DST/$(basename "$f")"
  if [[ -L "$target" ]]; then
    link="$(readlink "$target")"
    case "$link" in
      "$ROOT"/agents/*) ;;
      *)
        printf 'skipped foreign symlink %s -> %s\n' "$target" "$link"
        skipped=$((skipped + 1))
        continue
        ;;
    esac
  elif [[ -e "$target" ]]; then
    printf 'skipped existing non-symlink %s\n' "$target"
    skipped=$((skipped + 1))
    continue
  fi
  ln -sfn "$f" "$target"
  printf 'linked %s -> %s\n' "$target" "$f"
  count=$((count + 1))
done

echo "Synced ${count} agent file(s), skipped ${skipped} conflict(s), removed ${removed} stale symlink(s) in $DST"
