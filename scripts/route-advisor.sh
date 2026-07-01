#!/usr/bin/env bash
# claude-model-router — PreToolUse advisory hook for the Agent (subagent-spawn) tool.
#
# Goal: nudge PURE read-only retrieval tasks off the top-tier model toward the
# cheap `scout` (haiku) agent — WITHOUT ever blocking, and biased toward quality:
# when in doubt, stay silent (leave the call as-is).
#
# It NEVER blocks (advisory only, exit 0). Worst case = an ignored hint.
#
# Fires only when ALL hold:
#   1. subagent is a GENERIC top-tier type (general-purpose / claude), not an
#      already-cheap/read-only agent (scout / analyst / Explore / investigator).
#   2. an explicit cheap model override is NOT already set (model != haiku).
#   3. prompt clearly reads as pure retrieval (locate/search/count/…),
#   4. AND has NO edit/build verb (fix/write/refactor/…) — any such verb => skip.
set -euo pipefail

# Fail-safe: no jq => do nothing (never break the tool call).
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
SUBAGENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null || echo "")"
MODEL="$(printf '%s' "$INPUT" | jq -r '.tool_input.model // ""' 2>/dev/null || echo "")"
PROMPT="$(printf '%s' "$INPUT" | jq -r '.tool_input.prompt // ""' 2>/dev/null | tr '[:upper:]' '[:lower:]')"

# 1. Only nudge generic top-tier subagents. Already-cheap/read-only agents => skip.
case "$SUBAGENT" in
  general-purpose|claude|"") : ;;                         # candidates
  *) exit 0 ;;                                            # scout/analyst/Explore/etc — leave alone
esac

# 2. Explicit cheap model already chosen => nothing to do.
case "$MODEL" in
  haiku) exit 0 ;;
esac

# 3. Edit/build intent => bias to quality, stay silent (RU + EN verbs).
if printf '%s' "$PROMPT" | grep -qiE 'почини|исправ|измен|добав|удали|рефактор|напиши|напис|создай|создать|реализ|обнов|перепиши|fix|edit|chang|modif|refactor|writ|creat|implement|updat|generat|delet|remov|rewrit|build|patch'; then
  exit 0
fi

# 4. Pure-retrieval signal (RU + EN). No match => stay silent.
if printf '%s' "$PROMPT" | grep -qiE 'найд|где определ|где живёт|где наход|поиск|перечисл|список|сколько|посчита|использован|кто вызыва|покажи структур|структур директор|locate|where is|where.s|search for|find all|list all|count|usages of|who calls|show.*structure|grep|map (the )?dir'; then
  jq -n '{
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: "[claude-model-router] This subagent task looks read-only (locate/search). Prefer the `scout` agent (Haiku, ~60x cheaper) instead of a top-tier generic agent. If the task actually needs edits or hard reasoning, ignore this and proceed."
    }
  }'
  exit 0
fi

exit 0
