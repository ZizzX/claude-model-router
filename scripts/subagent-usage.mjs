#!/usr/bin/env node
// claude-model-router — SubagentStop hook. Captures a completed subagent's REAL
// token usage from its transcript and appends it to usage.jsonl, so router-stats
// can report actual per-model spend (not just spawn-count estimates).
//
// The PreToolUse hook only sees the requested model; real tokens are only known
// once the subagent finishes. SubagentStop gives us transcript_path — the
// subagent's own transcript, which records per-message usage + model. We sum it,
// dedupe by agentId (SubagentStop can fire more than once on resume), and log
// raw token counts (pricing is applied by the reporter). Fully guarded.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let input;
try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

const transcript = input.transcript_path || input.transcriptPath || '';
if (!transcript) process.exit(0);

let lines;
try { lines = fs.readFileSync(transcript, 'utf8').split(/\r?\n/).filter(Boolean); } catch { process.exit(0); }

let agentId = '';
let model = '';
const sum = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
for (const l of lines) {
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  if (!agentId && o.agentId) agentId = String(o.agentId);
  const u = o.message && o.message.usage;
  if (u) {
    if (o.message.model) model = String(o.message.model);
    sum.input += u.input_tokens || 0;
    sum.output += u.output_tokens || 0;
    sum.cache_read += u.cache_read_input_tokens || 0;
    sum.cache_creation += u.cache_creation_input_tokens || 0;
  }
}

const totalTok = sum.input + sum.output + sum.cache_read + sum.cache_creation;
if (totalTok === 0) process.exit(0);

const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const usagePath = process.env.MR_USAGE || path.join(cfg, 'model-router', 'usage.jsonl');

try {
  fs.mkdirSync(path.dirname(usagePath), { recursive: true });
  // Dedupe: skip if this agentId was already recorded.
  if (agentId) {
    try {
      const prior = fs.readFileSync(usagePath, 'utf8');
      if (prior.includes('"agentId":"' + agentId + '"')) process.exit(0);
    } catch { /* no prior file — first record */ }
  }
  const rec = {
    ts: new Date().toISOString(),
    agentId: agentId || 'unknown',
    model: model || 'unknown',
    input: sum.input,
    output: sum.output,
    cache_read: sum.cache_read,
    cache_creation: sum.cache_creation,
  };
  fs.appendFileSync(usagePath, JSON.stringify(rec) + '\n');
} catch { /* never break the session */ }

process.exit(0);
