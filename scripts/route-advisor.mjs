#!/usr/bin/env node
// claude-model-router — PreToolUse advisory hook for the Agent (subagent-spawn) tool.
// Node.js runtime: cross-platform (macOS / Linux / native Windows), no bash or jq.
//
// Two symmetric nudges, both ADVISORY only (never block), biased toward quality —
// when in doubt, stay silent:
//   A. DOWNGRADE-FROM-TOP: a pure read-only retrieval task on a generic top-tier
//      subagent => suggest the cheap `scout` (haiku) agent.
//   B. CAP-THE-CEILING: a subagent explicitly set to `fable` (above opus, priciest)
//      => steer down to opus+high, or lower (sonnet/scout) for analysis/retrieval.
//
// Side effect: appends ONE JSONL event per spawn (tier/model/class/nudge) to the
// event log for router-stats.mjs. Fully guarded — never affects the tool call.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Read the hook payload from stdin.
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let input;
try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

const ti = input.tool_input || {};
const subagent = String(ti.subagent_type || '');
const model = String(ti.model || '');
const prompt = String(ti.prompt || '').toLowerCase();

// Intent detectors (RU + EN), shared by both nudges.
const EDIT = /почини|исправ|измен|добав|удали|рефактор|напиши|напис|создай|создать|реализ|обнов|перепиши|fix|edit|chang|modif|refactor|writ|creat|implement|updat|generat|delet|remov|rewrit|build|patch/;
const RETR = /найд|где определ|где живёт|где наход|поиск|перечисл|список|сколько|посчита|использован|кто вызыва|покажи структур|структур директор|locate|where is|where.s|search for|find all|list all|count|usages of|who calls|show.*structure|grep|map (the )?dir/;
// Mechanical chores — running a command, not generating code. Cheapest tier is enough.
const CHORE = /закоммить|запушь|запуш|коммитни|сделай коммит|застейдж|отформатируй|прогони (линт|тест|прет|prettier|eslint|сборк)|забамп|подними верси|синхрониз.* кэш|git commit|git push|git add|git stash|\bcommit\b|\bpush\b|stage (the|these|changes)|bump (the )?version|run (the )?(formatter|prettier|lint|linter|tests?|build)|regenerate|format the/;
// Strong code-authoring verbs. Distinct from the loose EDIT set so a chore like
// "commit the changes" (RU "закоммить изменения" — where "изменения" trips EDIT's
// "измен") is NOT misread as codegen. Chore only defers to a REAL authoring verb.
const CODEGEN = /почини|исправ|рефактор|напиши|напис|создай|создать|реализ|перепиши|fix|refactor|implement|rewrit|writ|creat|generat|patch/;

const hasEdit = EDIT.test(prompt);
const hasRetr = RETR.test(prompt);
const hasChore = CHORE.test(prompt);
const hasCodegen = CODEGEN.test(prompt);
// Precedence: a chore with no real codegen verb is cheapest; else edit => quality,
// else retrieval, else other.
let klass = 'other';
if (hasChore && !hasCodegen) klass = 'chore';
else if (hasEdit) klass = 'edit';
else if (hasRetr) klass = 'retrieval';

// Infer the tier that will actually run: explicit model wins, else the type's
// pinned model, else parent inheritance (opus => top).
const isFable = /^(fable|fable-.*|claude-fable-.*)$/.test(model) || /-fable-/.test(model);
let tier;
if (model === 'haiku') tier = 'cheap';
else if (model === 'sonnet') tier = 'mid';
else if (model === 'opus') tier = 'top';
else if (isFable) tier = 'ceiling';
else if (model === '') {
  if (/scout/.test(subagent)) tier = 'cheap';
  else if (/analyst/.test(subagent)) tier = 'mid';
  else tier = 'top';
} else tier = 'top';

// Decide which nudge (if any) fires. `nudge` is also the logged field.
let nudge = 'none';
let out = '';

if (tier === 'ceiling') {
  nudge = 'B';
  if (klass === 'retrieval') {
    out = '[claude-model-router] This subagent is set to `fable` (top-tier, most expensive) but the task looks read-only (locate/search). Prefer the `scout` agent (Haiku, ~60x cheaper). If it truly needs fable-class capability, ignore this and proceed.';
  } else if (klass === 'edit') {
    out = '[claude-model-router] This subagent is set to `fable` (top-tier, most expensive). For code/build tasks prefer `opus`+effort:high — nearly as capable, materially cheaper. Reserve fable for tasks that genuinely need its edge; otherwise ignore this and proceed.';
  } else {
    out = '[claude-model-router] This subagent is set to `fable` (top-tier, most expensive) for read-only analysis. Prefer the `analyst` agent (Sonnet) — or `opus`+effort:high if it needs hard reasoning. If fable is truly warranted, ignore this and proceed.';
  }
} else if (subagent === 'general-purpose' || subagent === 'claude' || subagent === '') {
  if (model !== 'haiku' && klass === 'chore') {
    nudge = 'C';
    out = '[claude-model-router] This looks like a mechanical chore (commit/push/format/bump/run a command) — not code generation. Prefer the cheapest model: spawn `scout` (Haiku) or pass model:"haiku". Reserve top-tier for real codegen/reasoning.';
  } else if (model !== 'haiku' && klass === 'retrieval') {
    nudge = 'A';
    out = '[claude-model-router] This subagent task looks read-only (locate/search). Prefer the `scout` agent (Haiku, ~60x cheaper) instead of a top-tier generic agent. If the task actually needs edits or hard reasoning, ignore this and proceed.';
  }
}

// Log the event (always, guarded — never breaks the tool call).
try {
  const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const logPath = process.env.MR_LOG || path.join(cfg, 'model-router', 'events.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const ev = {
    ts: new Date().toISOString(),
    type: subagent || 'inherit',
    model: model || 'inherit',
    tier,
    class: klass,
    nudge,
  };
  fs.appendFileSync(logPath, JSON.stringify(ev) + '\n');
} catch { /* logging must never break the spawn */ }

// Emit the advisory (if any) and exit successfully no matter what.
if (out) {
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: out },
  }));
}
process.exit(0);
