#!/usr/bin/env bash
# claude-model-router — impact reporter. Reads the JSONL event log written by
# route-advisor.sh and prints routing distribution + an ESTIMATED token/cost
# saving vs an "everything ran on opus" baseline.
#
# The hook cannot see a subagent's real token usage, so savings are an ESTIMATE:
#   est_saved_opus_tokens = Σ over each spawn of  AVG_TOKENS × (1 − weight[tier])
# where weight is the tier's price relative to opus (opus = 1.0). Below-opus tiers
# contribute positive savings; a `fable` (ceiling) spawn contributes NEGATIVE
# (overspend vs opus). Tune the knobs via env vars — all clearly labelled.
#
# Env knobs (with defaults):
#   MR_LOG          event log path
#   MR_AVG_TOKENS   assumed output tokens per subagent            (default 30000)
#   MR_OPUS_PRICE   opus output $/Mtok, for the $ estimate        (default 15)
#   MR_W_CHEAP      haiku  price weight vs opus                   (default 0.017 ≈ 1/60)
#   MR_W_MID        sonnet price weight vs opus                   (default 0.2   ≈ 1/5)
#   MR_W_TOP        opus   price weight vs opus                   (default 1.0)
#   MR_W_CEILING    fable  price weight vs opus                   (default 1.5)
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }

LOG="${MR_LOG:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/model-router/events.jsonl}"
AVG="${MR_AVG_TOKENS:-30000}"
OPUS_PRICE="${MR_OPUS_PRICE:-15}"
W_CHEAP="${MR_W_CHEAP:-0.017}"
W_MID="${MR_W_MID:-0.2}"
W_TOP="${MR_W_TOP:-1.0}"
W_CEILING="${MR_W_CEILING:-1.5}"

if [ ! -s "$LOG" ]; then
  echo "claude-model-router — no events logged yet."
  echo "log: $LOG"
  echo "(spawn a subagent via the Agent tool; the PreToolUse hook records each one.)"
  exit 0
fi

jq -rs \
  --argjson avg "$AVG" \
  --argjson price "$OPUS_PRICE" \
  --argjson wc "$W_CHEAP" --argjson wm "$W_MID" --argjson wt "$W_TOP" --argjson wx "$W_CEILING" \
  '
  def pct($n;$d): if $d==0 then 0 else ($n*1000/$d|round/10) end;
  def weight: {cheap:$wc, mid:$wm, top:$wt, ceiling:$wx}[.] // $wt;
  . as $e
  | ($e|length) as $total
  | (reduce $e[] as $x ({}; .[$x.tier] += 1))   as $byTier
  | (reduce $e[] as $x ({}; .[$x.model] += 1))  as $byModel
  | (reduce $e[] as $x ({}; .[$x.class] += 1))  as $byClass
  | ([$e[]|select(.nudge=="A")]|length) as $nA
  | ([$e[]|select(.nudge=="B")]|length) as $nB
  | (reduce $e[] as $x (0; . + ($avg * (1 - ($x.tier|weight))))) as $savedTok
  | ($savedTok * $price / 1000000)                                as $savedUsd
  | "claude-model-router — impact report",
    "log: events=\($total)",
    "",
    "── model actually requested (\"inherit\" = took parent/opus) ──",
    ( $byModel|to_entries|sort_by(-.value)[] | "  \(.key|. + (" "*(12-length)))  \(.value)  (\(pct(.value;$total))%)" ),
    "",
    "── tier that ran ──",
    ( ["cheap","mid","top","ceiling"][] as $t | select($byTier[$t]!=null) | "  \($t|. + (" "*(9-length)))  \($byTier[$t])  (\(pct($byTier[$t];$total))%)" ),
    "",
    "── task class ──",
    ( $byClass|to_entries|sort_by(-.value)[] | "  \(.key|. + (" "*(10-length)))  \(.value)  (\(pct(.value;$total))%)" ),
    "",
    "── nudges fired (advisory hints emitted) ──",
    "  A  top→cheap (retrieval off top-tier):   \($nA)",
    "  B  fable→down (ceiling capped to opus):  \($nB)",
    "",
    "── ESTIMATED savings vs all-opus baseline ──",
    "  assumptions: \($avg) tok/subagent, opus $\($price)/Mtok, weights cheap=\($wc) mid=\($wm) ceiling=\($wx)",
    "  est. opus-equiv tokens avoided: \(($savedTok|round))",
    "  est. cost avoided:              $\(($savedUsd*100|round)/100)",
    "  (ESTIMATE — hook sees requested model, not real usage; tune via MR_* env vars.)"
  ' "$LOG"
