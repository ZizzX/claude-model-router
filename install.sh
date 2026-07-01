#!/usr/bin/env bash
# claude-model-router installer — puts subagents + routing rules into ~/.claude
# Idempotent: re-running updates in place, never duplicates.
#
# Usage:
#   bash install.sh          # copy agents (snapshot; re-run after git pull)
#   bash install.sh --link   # symlink agents (git pull auto-updates them)
set -euo pipefail

MODE="copy"
[ "${1:-}" = "--link" ] && MODE="link"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
AGENTS_DEST="$DEST/agents"
CLAUDE_MD="$DEST/CLAUDE.md"
MARKER_BEGIN="<!-- BEGIN claude-model-router: subagent-routing -->"
MARKER_END="<!-- END claude-model-router: subagent-routing -->"

echo "→ claude-model-router install (mode: $MODE)"
echo "  src:  $SRC"
echo "  dest: $DEST"

# 1. Subagents
mkdir -p "$AGENTS_DEST"
for f in "$SRC"/agents/*.md; do
  target="$AGENTS_DEST/$(basename "$f")"
  rm -f "$target"   # clear prior file/symlink so copy<->link switching is clean
  if [ "$MODE" = "link" ]; then
    ln -sf "$f" "$target"
    echo "  agent (link): $(basename "$f") → $target"
  else
    cp "$f" "$target"
    echo "  agent (copy): $(basename "$f") → $target"
  fi
done

# 2. Routing block in global CLAUDE.md (idempotent: strip old block, append fresh)
ROUTING="$(cat "$SRC/CLAUDE.routing.md")"
touch "$CLAUDE_MD"
if grep -qF "$MARKER_BEGIN" "$CLAUDE_MD"; then
  # remove existing block between markers
  tmp="$(mktemp)"
  awk -v b="$MARKER_BEGIN" -v e="$MARKER_END" '
    $0 ~ b {skip=1}
    skip==0 {print}
    $0 ~ e {skip=0}
  ' "$CLAUDE_MD" > "$tmp"
  mv "$tmp" "$CLAUDE_MD"
  echo "  routing: updated block in $CLAUDE_MD"
else
  echo "  routing: added block to $CLAUDE_MD"
fi
# append fresh block
printf '\n%s\n' "$ROUTING" >> "$CLAUDE_MD"

echo "✓ Done. Restart Claude Code (or /reload-plugins) to pick up the agents."
