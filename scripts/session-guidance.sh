#!/usr/bin/env bash
# claude-model-router — SessionStart hook. Injects the routing rule into context
# at the start of each session, so a plain plugin install is enough for the agent
# to remember the delegate-first policy — no CLAUDE.md editing required.
#
# Single source of truth: the text lives in CLAUDE.routing.md (also used by the
# non-plugin install.sh path). Here we just strip the marker comments and emit it
# as SessionStart additionalContext. Fully guarded — never breaks the session.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
