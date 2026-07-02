#!/usr/bin/env bash
# claude-model-router — PreToolUse advisory hook for the Agent (subagent-spawn) tool.
#
# Two symmetric nudges, both ADVISORY only (never block, exit 0), biased toward
# quality — when in doubt, stay silent (leave the call as-is):
#
#   A. DOWNGRADE-FROM-TOP: a PURE read-only retrieval task on a generic top-tier
#      subagent => suggest the cheap `scout` (haiku) agent.
#
#   B. CAP-THE-CEILING: a subagent explicitly set to `fable` (or any tier pricier
#      than opus) => suggest `opus`+high, or lower (sonnet/scout) when the task is
#      analysis/retrieval. Fable is the most expensive tier; almost nothing needs
#      it that opus can't do. Fires on ANY subagent type (a `model:` override
#      beats the type's pinned model), so it runs before the type gate.
#
# Side effect: appends ONE JSONL event per spawn to the event log (tier/model/
# class/nudge) for `router-stats.sh` to aggregate. Logging is fully guarded and
# never affects the tool call. Worst case = an ignored hint.
set -euo pipefail

# Fail-safe: no jq => do nothing (never break the tool call).
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
SUBAGENT="$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null || echo "")"
MODEL="$(printf '%s' "$INPUT" | jq -r '.tool_input.model // ""' 2>/dev/null || echo "")"
PROMPT="$(printf '%s' "$INPUT" | jq -r '.tool_input.prompt // ""' 2>/dev/null | tr '[:upper:]' '[:lower:]')"

# Intent detectors (RU + EN), shared by both nudges.
has_edit_verb() {
  printf '%s' "$PROMPT" | grep -qiE 'почини|исправ|измен|добав|удали|рефактор|напиши|напис|создай|создать|реализ|обнов|перепиши|fix|edit|chang|modif|refactor|writ|creat|implement|updat|generat|delet|remov|rewrit|build|patch'
}
has_retrieval_signal() {
  printf '%s' "$PROMPT" | grep -qiE 'найд|где определ|где живёт|где наход|поиск|перечисл|список|сколько|посчита|использован|кто вызыва|покажи структур|структур директор|locate|where is|where.s|search for|find all|list all|count|usages of|who calls|show.*structure|grep|map (the )?dir'
}

emit() {  # $1 = advisory text
  jq -n --arg ctx "$1" '{
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: $ctx
    }
  }'
}

# ── Classify the task (edit takes precedence — mirrors "edit => bias to quality").
CLASS="other"
if has_edit_verb; then CLASS="edit"; elif has_retrieval_signal; then CLASS="retrieval"; fi

# ── Infer the tier that will actually run: explicit model wins, else the type's
#    pinned model, else parent inheritance (opus => top).
case "$MODEL" in
  haiku)                                TIER="cheap" ;;
  sonnet)                               TIER="mid" ;;
  opus)                                 TIER="top" ;;
  fable|fable-*|claude-fable-*|*-fable-*) TIER="ceiling" ;;
  "")
    case "$SUBAGENT" in
      *scout*)   TIER="cheap" ;;
      *analyst*) TIER="mid" ;;
      *)         TIER="top" ;;   # generic/Explore/etc inherit the parent (opus)
    esac ;;
  *)                                    TIER="top" ;;   # unknown explicit model
esac

# ── Decide which nudge (if any) fires. NUDGE also becomes the logged field.
NUDGE="none"
OUT=""

if [ "$TIER" = "ceiling" ]; then
  # Nudge B: fable is above opus — steer back down the ladder by task class.
  NUDGE="B"
  if [ "$CLASS" = "retrieval" ]; then
    OUT="[claude-model-router] This subagent is set to \`fable\` (top-tier, most expensive) but the task looks read-only (locate/search). Prefer the \`scout\` agent (Haiku, ~60x cheaper). If it truly needs fable-class capability, ignore this and proceed."
  elif [ "$CLASS" = "edit" ]; then
    OUT="[claude-model-router] This subagent is set to \`fable\` (top-tier, most expensive). For code/build tasks prefer \`opus\`+effort:high — nearly as capable, materially cheaper. Reserve fable for tasks that genuinely need its edge; otherwise ignore this and proceed."
  else
    OUT="[claude-model-router] This subagent is set to \`fable\` (top-tier, most expensive) for read-only analysis. Prefer the \`analyst\` agent (Sonnet) — or \`opus\`+effort:high if it needs hard reasoning. If fable is truly warranted, ignore this and proceed."
  fi
else
  # Nudge A: downgrade a pure-retrieval task off a generic top-tier subagent.
  case "$SUBAGENT" in
    general-purpose|claude|"")
      if [ "$MODEL" != "haiku" ] && [ "$CLASS" = "retrieval" ]; then
        NUDGE="A"
        OUT="[claude-model-router] This subagent task looks read-only (locate/search). Prefer the \`scout\` agent (Haiku, ~60x cheaper) instead of a top-tier generic agent. If the task actually needs edits or hard reasoning, ignore this and proceed."
      fi ;;
  esac
fi

# ── Log the event (always, guarded — never breaks the tool call).
LOG="${MR_LOG:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/model-router/events.jsonl}"
{
  mkdir -p "$(dirname "$LOG")" 2>/dev/null &&
  TS="$(date -u +%FT%TZ 2>/dev/null || echo "")" &&
  jq -nc \
    --arg ts "$TS" \
    --arg type "${SUBAGENT:-inherit}" \
    --arg model "${MODEL:-inherit}" \
    --arg tier "$TIER" \
    --arg class "$CLASS" \
    --arg nudge "$NUDGE" \
    '{ts:$ts,type:$type,model:$model,tier:$tier,class:$class,nudge:$nudge}' >> "$LOG" 2>/dev/null
} || true

# ── Emit the advisory (if any) and exit successfully no matter what.
[ -n "$OUT" ] && emit "$OUT"
exit 0
