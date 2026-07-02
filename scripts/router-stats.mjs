#!/usr/bin/env node
// claude-model-router — impact reporter (visual). Two data sources:
//   • usage.jsonl  — REAL per-subagent token usage (from the SubagentStop hook).
//   • events.jsonl — routing decisions (from the PreToolUse hook): tier/model/
//                    class/nudge per spawn. No real tokens.
// When usage.jsonl has data, the report leads with REAL spend + savings; the
// routing section (tier mix, nudges, missed-savings estimate) always follows.
// With no usage yet, it falls back to a spawn-count ESTIMATE. Cross-platform.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const logPath = process.env.MR_LOG || path.join(cfg, 'model-router', 'events.jsonl');
const usagePath = process.env.MR_USAGE || path.join(cfg, 'model-router', 'usage.jsonl');
const AVG = Number(process.env.MR_AVG_TOKENS || 30000);
const OPUS_PRICE = Number(process.env.MR_OPUS_PRICE || 25); // opus OUTPUT $/Mtok, for the estimate
const W = {
  cheap: Number(process.env.MR_W_CHEAP || 0.017),
  mid: Number(process.env.MR_W_MID || 0.2),
  top: Number(process.env.MR_W_TOP || 1.0),
  ceiling: Number(process.env.MR_W_CEILING || 1.5),
};

// Real per-model prices ($/Mtok). Cache read ≈ 0.1×input, cache write ≈ 1.25×input.
const PRICE = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-fable-5': { in: 10, out: 50 },
};
const OPUS = PRICE['claude-opus-4-8'];
const priceOf = (m) => PRICE[m] || (/haiku/.test(m) ? PRICE['claude-haiku-4-5'] : /sonnet/.test(m) ? PRICE['claude-sonnet-5'] : /fable/.test(m) ? PRICE['claude-fable-5'] : OPUS);
const costOf = (r, p) => (r.input * p.in + r.output * p.out + r.cache_read * 0.1 * p.in + r.cache_creation * 1.25 * p.in) / 1e6;

// ── formatting helpers ──
const BARW = 22;
const bar = (v, max) => '█'.repeat(Math.max(0, Math.round((BARW * v) / (max || 1)))) || '·';
const pct = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : 0);
const padE = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
const padS = (s, n) => ' '.repeat(Math.max(0, n - String(s).length)) + String(s);
const tok = (n) => (n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)));
const usd = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

const readJsonl = (p) => {
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
};

const usage = readJsonl(usagePath);
const events = readJsonl(logPath);

if (!usage.length && !events.length) {
  console.log('claude-model-router — no data yet.');
  console.log('events log: ' + logPath);
  console.log('usage log:  ' + usagePath);
  console.log('(spawn a subagent via the Agent tool; hooks record routing + real usage.)');
  process.exit(0);
}

const L = [];

// ══ REAL section (from usage.jsonl) ══
if (usage.length) {
  const byModel = {};
  for (const r of usage) {
    const m = r.model || 'unknown';
    const p = priceOf(m);
    const e = byModel[m] || (byModel[m] = { n: 0, tokens: 0, cost: 0, baseline: 0 });
    e.n += 1;
    e.tokens += r.input + r.output + r.cache_read + r.cache_creation;
    e.cost += costOf(r, p);
    e.baseline += costOf(r, OPUS); // same tokens, opus rates
  }
  const rows = Object.entries(byModel).map(([m, e]) => ({ m, ...e })).sort((a, b) => b.cost - a.cost);
  const totalCost = rows.reduce((s, x) => s + x.cost, 0);
  const totalBase = rows.reduce((s, x) => s + x.baseline, 0);
  const totalTok = rows.reduce((s, x) => s + x.tokens, 0);
  const saved = totalBase - totalCost;
  const maxCost = Math.max(...rows.map((x) => x.cost));

  // ── SUMMARY: the headline numbers, up top ──
  L.push('══════ SUBAGENT SUMMARY (real) ══════');
  L.push('  subagents run      ' + padS(usage.length, 10));
  L.push('  tokens used        ' + padS(tok(totalTok), 10));
  L.push('  spent (actual)     ' + padS(usd(totalCost), 10));
  L.push('  if all on opus     ' + padS(usd(totalBase), 10) + '   ← cost with no cheap delegation');
  L.push('  YOU SAVED          ' + padS(usd(saved), 10) + '   (' + pct(saved, totalBase) + '% cheaper)');
  const maxB = Math.max(totalBase, totalCost, Math.abs(saved), 1);
  L.push('    spent  ' + padE(bar(totalCost, maxB), BARW) + ' ' + usd(totalCost));
  L.push('    saved  ' + padE(bar(Math.max(0, saved), maxB), BARW) + ' ' + usd(saved));
  L.push('');
  L.push('spend by model  (real tokens · $ · share)');
  for (const x of rows) {
    L.push('  ' + padE(x.m.replace('claude-', '').replace(/-\d{8}$/, ''), 14) + ' ' + padE(bar(x.cost, maxCost), BARW) + ' ' +
      padS(tok(x.tokens), 6) + '  ' + padS(usd(x.cost), 8) + '  ' + padS(pct(x.cost, totalCost) + '%', 6));
  }
  L.push('');
}

// ══ ROUTING section (from events.jsonl) ══
if (events.length) {
  const total = events.length;
  const byTier = {}, byClass = {};
  let nA = 0, nB = 0, nC = 0;
  for (const e of events) {
    byTier[e.tier] = (byTier[e.tier] || 0) + 1;
    byClass[e.class] = (byClass[e.class] || 0) + 1;
    if (e.nudge === 'A') nA++;
    if (e.nudge === 'B') nB++;
    if (e.nudge === 'C') nC++;
  }
  const maxTier = Math.max(...Object.values(byTier));
  L.push('ROUTING  (' + total + ' spawns logged)');
  for (const t of ['cheap', 'mid', 'top', 'ceiling']) {
    if (byTier[t] == null) continue;
    L.push('  ' + padE(t, 8) + ' ' + padE(bar(byTier[t], maxTier), BARW) + ' ' + padS(byTier[t], 3) + '  ' + padS(pct(byTier[t], total) + '%', 5));
  }
  const cls = ['retrieval', 'chore', 'edit', 'other'].filter((c) => byClass[c]).map((c) => `${c} ${byClass[c]}`);
  L.push('  class: ' + cls.join(' · '));
  L.push('  nudges: A top→cheap ' + nA + ' · B fable→down ' + nB + ' · C chore→cheap ' + nC);
  // Missed-savings estimate: retrieval/chore that stayed top-tier (nudge fired, advice not yet applied).
  const missed = (nA + nC) * AVG * (1 - W.cheap) * OPUS_PRICE / 1e6;
  if (nA + nC > 0) {
    L.push('  missed savings (est.): ' + usd(missed) + '  — ' + (nA + nC) + ' retrieval/chore spawn(s) ran top-tier; delegating to haiku would have saved this');
  }
  L.push('');
}

// ══ ESTIMATE fallback (only when no real usage yet) ══
if (!usage.length && events.length) {
  const total = events.length;
  const tierOfModel = (m) => {
    if (m === 'haiku') return 'cheap';
    if (m === 'sonnet') return 'mid';
    if (m === 'opus' || m === 'inherit') return 'top';
    if (/^(fable|fable-.*|claude-fable-.*)$/.test(m) || /-fable-/.test(m)) return 'ceiling';
    return 'top';
  };
  const byModel = {};
  for (const e of events) byModel[e.model] = (byModel[e.model] || 0) + 1;
  const rows = Object.entries(byModel).map(([m, count]) => {
    const t = tierOfModel(m); const tokens = count * AVG;
    return { m, count, tokens, spend: (tokens * W[t] * OPUS_PRICE) / 1e6 };
  }).sort((a, b) => b.tokens - a.tokens);
  const totalSpend = rows.reduce((s, x) => s + x.spend, 0);
  const baseline = (total * AVG * OPUS_PRICE) / 1e6;
  const maxTok = Math.max(...rows.map((x) => x.tokens));
  L.push('ESTIMATE (no real usage captured yet — assumes ' + tok(AVG) + ' tok/spawn)');
  L.push('SPEND BY MODEL (est.)');
  for (const x of rows) {
    L.push('  ' + padE(x.m === 'inherit' ? 'inherit→opus' : x.m, 13) + ' ' + padE(bar(x.tokens, maxTok), BARW) + ' ' + padS(usd(x.spend), 8));
  }
  L.push('  est. saved vs all-opus: ' + usd(baseline - totalSpend));
  L.push('');
}

L.push('(Real spend = subagent transcripts, prices $/Mtok: opus 5/25, sonnet 3/15, haiku 1/5, fable 10/50.');
L.push(' Routing estimate assumes fixed tok/spawn — tune via MR_* env vars. For whole-session billing use token-optimizer.)');

console.log(L.join('\n'));
