#!/usr/bin/env node
// claude-model-router — impact reporter (ESTIMATE, visual). Reads the JSONL spawn
// log written by route-advisor.mjs and renders ASCII bar charts: spend by model,
// tier distribution, task class, nudges, and savings vs an all-opus baseline.
// Cross-platform (Node.js). No real token usage — the hook only sees the requested
// model, so every spawn is estimated at MR_AVG_TOKENS. Clearly labelled ESTIMATE.
//
//   tokens(model)  = spawnCount(model) × AVG
//   spend(model)   = tokens(model) × weight(tier(model)) × OPUS_PRICE / 1e6
//   baseline       = totalSpawns × AVG × 1.0 × OPUS_PRICE / 1e6   (everything on opus)
//   saved          = baseline − Σ spend                          (fable ⇒ negative)
//
// Env knobs: MR_LOG, MR_AVG_TOKENS (30000), MR_OPUS_PRICE (15 $/Mtok),
//            MR_W_CHEAP (0.017), MR_W_MID (0.2), MR_W_TOP (1.0), MR_W_CEILING (1.5).
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
try { lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean); } catch { lines = []; }
if (!lines.length) {
  console.log('claude-model-router — no events logged yet.');
  console.log('log: ' + logPath);
  console.log('(spawn a subagent via the Agent tool; the PreToolUse hook records each one.)');
  process.exit(0);
}

const events = [];
for (const l of lines) { try { events.push(JSON.parse(l)); } catch { /* skip */ } }
const total = events.length;

// tier of a model string (for spend weighting).
const tierOfModel = (m) => {
  if (m === 'haiku') return 'cheap';
  if (m === 'sonnet') return 'mid';
  if (m === 'opus' || m === 'inherit') return 'top';
  if (/^(fable|fable-.*|claude-fable-.*)$/.test(m) || /-fable-/.test(m)) return 'ceiling';
  return 'top';
};

const byModel = {}, byTier = {}, byClass = {};
let nA = 0, nB = 0, nC = 0;
for (const e of events) {
  byModel[e.model] = (byModel[e.model] || 0) + 1;
  byTier[e.tier] = (byTier[e.tier] || 0) + 1;
  byClass[e.class] = (byClass[e.class] || 0) + 1;
  if (e.nudge === 'A') nA++;
  if (e.nudge === 'B') nB++;
  if (e.nudge === 'C') nC++;
}

// ── formatting helpers ──
const BARW = 22;
const bar = (v, max) => '█'.repeat(Math.max(0, Math.round((BARW * v) / (max || 1)))) || '·';
const pct = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : 0);
const padE = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
const padS = (s, n) => ' '.repeat(Math.max(0, n - String(s).length)) + String(s);
const tok = (n) => (n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)));
const usd = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

// ── per-model derived numbers ──
const models = Object.entries(byModel)
  .map(([m, count]) => {
    const t = tierOfModel(m);
    const tokens = count * AVG;
    const spend = (tokens * W[t] * PRICE) / 1e6;
    return { m, count, tier: t, tokens, spend };
  })
  .sort((a, b) => b.tokens - a.tokens);

const totalTokens = models.reduce((s, x) => s + x.tokens, 0);
const totalSpend = models.reduce((s, x) => s + x.spend, 0);
const baseline = (total * AVG * W.top * PRICE) / 1e6; // everything on opus
const saved = baseline - totalSpend;
const savedPct = baseline ? Math.round((saved * 1000) / baseline) / 10 : 0;

const maxModelTok = Math.max(...models.map((x) => x.tokens));
const maxTier = Math.max(...Object.values(byTier));

// ── render ──
const L = [];
L.push('claude-model-router — impact report   (ESTIMATE)');
L.push(`events: ${total} spawns  ·  assumes ${tok(AVG)} tok/spawn, opus $${PRICE}/Mtok`);
L.push('');
L.push('SPEND BY MODEL  (est. tokens · share · est.$)');
for (const x of models) {
  const label = x.m === 'inherit' ? 'inherit→opus' : x.m;
  L.push('  ' + padE(label, 13) + ' ' + padE(bar(x.tokens, maxModelTok), BARW) + ' ' +
    padS(tok(x.tokens), 5) + '  ' + padS(pct(x.tokens, totalTokens) + '%', 5) + '  ' + padS(usd(x.spend), 7));
}
L.push('  ' + '─'.repeat(46));
L.push('  ' + padE('total', 13) + ' ' + ' '.repeat(BARW) + ' ' + padS(tok(totalTokens), 5) + '          ' + padS(usd(totalSpend), 7));
L.push('');
L.push('TIER DISTRIBUTION  (spawns)');
for (const t of ['cheap', 'mid', 'top', 'ceiling']) {
  if (byTier[t] == null) continue;
  L.push('  ' + padE(t, 8) + ' ' + padE(bar(byTier[t], maxTier), BARW) + ' ' + padS(byTier[t], 3) + '  ' + padS(pct(byTier[t], total) + '%', 5));
}
L.push('');
const cls = ['retrieval', 'chore', 'edit', 'other'].filter((c) => byClass[c]).map((c) => `${c} ${byClass[c]} (${pct(byClass[c], total)}%)`);
L.push('TASK CLASS   ' + cls.join('  ·  '));
L.push('');
L.push('NUDGES FIRED   A top→cheap: ' + nA + '    B fable→down: ' + nB + '    C chore→cheap: ' + nC);
L.push('');
L.push('SAVINGS vs baseline "everything on opus" (≈ no cheap delegation)');
const maxBar = Math.max(baseline, totalSpend, Math.abs(saved));
L.push('  baseline  ' + padE(bar(baseline, maxBar), BARW) + ' ' + padS(usd(baseline), 8));
L.push('  actual    ' + padE(bar(totalSpend, maxBar), BARW) + ' ' + padS(usd(totalSpend), 8));
L.push('  saved     ' + padE(bar(Math.max(0, saved), maxBar), BARW) + ' ' + padS(usd(saved), 8) + '  (' + savedPct + '%)');
if (byTier.ceiling) L.push('  note: ' + byTier.ceiling + ' fable spawn(s) cost MORE than opus → they reduce savings.');
L.push('');
L.push('(ESTIMATE — hook sees the requested model, not real usage. Tune via MR_* env vars.');
L.push(' For REAL per-model $ across the whole session, use the token-optimizer plugin.)');

console.log(L.join('\n'));
