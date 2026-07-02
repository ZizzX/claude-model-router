#!/usr/bin/env node
// claude-model-router — impact reporter. Reads the JSONL event log written by
// route-advisor.mjs and prints routing distribution + an ESTIMATED token/cost
// saving vs an "everything ran on opus" baseline. Cross-platform (Node.js).
//
//   est_saved_opus_tokens = Σ over each spawn of  AVG_TOKENS × (1 − weight[tier])
// weight = tier price relative to opus (opus = 1.0). Below-opus tiers add positive
// savings; a `fable` (ceiling) spawn contributes NEGATIVE (overspend vs opus).
//
// Env knobs (with defaults):
//   MR_LOG        event log path
//   MR_AVG_TOKENS assumed output tokens per subagent      (default 30000)
//   MR_OPUS_PRICE opus output $/Mtok for the $ estimate   (default 15)
//   MR_W_CHEAP    haiku  price weight vs opus             (default 0.017 ≈ 1/60)
//   MR_W_MID      sonnet price weight vs opus             (default 0.2   ≈ 1/5)
//   MR_W_TOP      opus   price weight vs opus             (default 1.0)
//   MR_W_CEILING  fable  price weight vs opus             (default 1.5)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const logPath = process.env.MR_LOG || path.join(cfg, 'model-router', 'events.jsonl');
const AVG = Number(process.env.MR_AVG_TOKENS || 30000);
const PRICE = Number(process.env.MR_OPUS_PRICE || 15);
const W = {
  cheap: Number(process.env.MR_W_CHEAP || 0.017),
  mid: Number(process.env.MR_W_MID || 0.2),
  top: Number(process.env.MR_W_TOP || 1.0),
  ceiling: Number(process.env.MR_W_CEILING || 1.5),
};

let lines = [];
try {
  lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
} catch { lines = []; }

if (!lines.length) {
  console.log('claude-model-router — no events logged yet.');
  console.log('log: ' + logPath);
  console.log('(spawn a subagent via the Agent tool; the PreToolUse hook records each one.)');
  process.exit(0);
}

const events = [];
for (const l of lines) { try { events.push(JSON.parse(l)); } catch { /* skip bad line */ } }
const total = events.length;

const byModel = {}, byTier = {}, byClass = {};
let nA = 0, nB = 0, savedTok = 0;
for (const e of events) {
  byModel[e.model] = (byModel[e.model] || 0) + 1;
  byTier[e.tier] = (byTier[e.tier] || 0) + 1;
  byClass[e.class] = (byClass[e.class] || 0) + 1;
  if (e.nudge === 'A') nA++;
  if (e.nudge === 'B') nB++;
  const w = e.tier in W ? W[e.tier] : W.top;
  savedTok += AVG * (1 - w);
}
const savedUsd = savedTok * PRICE / 1e6;

const pct = (n) => (total ? Math.round((n * 1000) / total) / 10 : 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
const sortedEntries = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);

const L = [];
L.push('claude-model-router — impact report');
L.push('log: events=' + total);
L.push('');
L.push('── model actually requested ("inherit" = took parent/opus) ──');
for (const [k, v] of sortedEntries(byModel)) L.push('  ' + pad(k, 12) + '  ' + v + '  (' + pct(v) + '%)');
L.push('');
L.push('── tier that ran ──');
for (const t of ['cheap', 'mid', 'top', 'ceiling']) if (byTier[t] != null) L.push('  ' + pad(t, 9) + '  ' + byTier[t] + '  (' + pct(byTier[t]) + '%)');
L.push('');
L.push('── task class ──');
for (const [k, v] of sortedEntries(byClass)) L.push('  ' + pad(k, 10) + '  ' + v + '  (' + pct(v) + '%)');
L.push('');
L.push('── nudges fired (advisory hints emitted) ──');
L.push('  A  top→cheap (retrieval off top-tier):   ' + nA);
L.push('  B  fable→down (ceiling capped to opus):  ' + nB);
L.push('');
L.push('── ESTIMATED savings vs all-opus baseline ──');
L.push('  assumptions: ' + AVG + ' tok/subagent, opus $' + PRICE + '/Mtok, weights cheap=' + W.cheap + ' mid=' + W.mid + ' ceiling=' + W.ceiling);
L.push('  est. opus-equiv tokens avoided: ' + Math.round(savedTok));
L.push('  est. cost avoided:              $' + (Math.round(savedUsd * 100) / 100));
L.push('  (ESTIMATE — hook sees requested model, not real usage; tune via MR_* env vars.)');

console.log(L.join('\n'));
