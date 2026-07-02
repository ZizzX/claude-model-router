#!/usr/bin/env bash
# claude-model-router — SessionStart hook. Two side-effects, both fully guarded:
#
#   1. Injects the routing rule into context so a plain plugin install is enough
#      for the agent to remember the delegate-first policy (no CLAUDE.md editing).
#      Single source of truth: CLAUDE.routing.md (also used by install.sh).
#
#   2. Installs a version-independent `router-stats` launcher so EVERY user can run
#      the impact report from a terminal with a stable command, regardless of which
#      plugin version cache dir is active:
#        ~/.claude/model-router/router-stats           (always)
#        ~/.local/bin/router-stats                     (if that dir exists & on PATH)
#
# Only the guidance JSON is written to stdout; the launcher install is silent.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STABLE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/model-router"

# ── Side-effect 2: refresh the stable terminal launcher (silent, best-effort).
{
  mkdir -p "$STABLE_DIR" &&
  cp "$ROOT/scripts/router-stats.sh" "$STABLE_DIR/router-stats" &&
  chmod +x "$STABLE_DIR/router-stats"
  # Optional PATH shim — only if the user already has ~/.local/bin (commonly on PATH).
  if [ -d "$HOME/.local/bin" ]; then
    ln -sf "$STABLE_DIR/router-stats" "$HOME/.local/bin/router-stats"
  fi
} >/dev/null 2>&1 || true

# ── Side-effect 1: emit the routing rule as additionalContext.
DOC="$ROOT/CLAUDE.routing.md"
[ -f "$DOC" ] || exit 0
# Drop the <!-- BEGIN/END claude-model-router --> marker lines; keep the guidance.
BODY="$(grep -v 'claude-model-router: subagent-routing' "$DOC" 2>/dev/null || cat "$DOC")"
[ -n "$BODY" ] || exit 0

jq -n --arg ctx "$BODY" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
exit 0
