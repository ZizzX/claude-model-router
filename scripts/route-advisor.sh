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
# Worst case = an ignored hint.
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

# ── Nudge B: cap the ceiling — fable (or pricier than opus) is almost always overkill.
# Match `fable` in any form (bare enum value or full model id). Runs first and
# regardless of subagent type, because `model:` overrides the type's pinned tier.
case "$MODEL" in
  fable|fable-*|claude-fable-*|*-fable-*)
    if has_retrieval_signal && ! has_edit_verb; then
      emit "[claude-model-router] This subagent is set to \`fable\` (top-tier, most expensive) but the task looks read-only (locate/search). Prefer the \`scout\` agent (Haiku, ~60x cheaper). If it truly needs fable-class capability, ignore this and proceed."
    elif ! has_edit_verb; then
      emit "[claude-model-router] This subagent is set to \`fable\` (top-tier, most expensive) for read-only analysis. Prefer the \`analyst\` agent (Sonnet) — or \`opus\`+effort:high if it needs hard reasoning. If fable is truly warranted, ignore this and proceed."
    else
      emit "[claude-model-router] This subagent is set to \`fable\` (top-tier, most expensive). For code/build tasks prefer \`opus\`+effort:high — nearly as capable, materially cheaper. Reserve fable for tasks that genuinely need its edge; otherwise ignore this and proceed."
    fi
    exit 0
    ;;
esac

# ── Nudge A: downgrade a pure-retrieval task off a generic top-tier subagent.
# 1. Only nudge generic top-tier subagents. Already-cheap/read-only agents => skip.
case "$SUBAGENT" in
  general-purpose|claude|"") : ;;                         # candidates
  *) exit 0 ;;                                            # scout/analyst/Explore/etc — leave alone
esac

# 2. Explicit cheap model already chosen => nothing to do.
case "$MODEL" in
  haiku) exit 0 ;;
esac

# 3. Edit/build intent => bias to quality, stay silent.
if has_edit_verb; then
  exit 0
fi

# 4. Pure-retrieval signal => nudge to scout. No match => stay silent.
if has_retrieval_signal; then
  emit "[claude-model-router] This subagent task looks read-only (locate/search). Prefer the \`scout\` agent (Haiku, ~60x cheaper) instead of a top-tier generic agent. If the task actually needs edits or hard reasoning, ignore this and proceed."
  exit 0
fi

exit 0
