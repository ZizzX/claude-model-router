#!/usr/bin/env node
// claude-model-router — SubagentStop hook. Captures REAL per-subagent token usage.
//
// SubagentStop's transcript_path is the PARENT session transcript (opus, huge) —
// NOT the subagent's. The real subagent transcripts live next to it, in
// <session>/subagents/agent-<id>.jsonl. So we derive that dir, scan every
// agent-*.jsonl, sum each one's usage (its real model + tokens), and merge into
// usage.jsonl keyed by agentId (overwrite this session's agents with their latest
// numbers, keep other sessions' records, drop bogus "unknown"). Idempotent and
// self-healing across parallel/partial subagents. Fully guarded.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let input;
try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

const tp = input.transcript_path || input.transcriptPath || '';
if (!tp) process.exit(0);

// Sum usage across a transcript file → { model, input, output, cache_read, cache_creation }.
function sumTranscript(file) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return null; }
  const s = { model: '', input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  for (const l of lines) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const u = o.message && o.message.usage;
    if (!u) continue;
    if (o.message.model) s.model = String(o.message.model);
    s.input += u.input_tokens || 0;
    s.output += u.output_tokens || 0;
    s.cache_read += u.cache_read_input_tokens || 0;
    s.cache_creation += u.cache_creation_input_tokens || 0;
  }
  return s;
}

// Where the subagent transcripts live for this session.
const base = tp.replace(/\.jsonl$/, '');
const subDir = path.join(base, 'subagents');

const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const usagePath = process.env.MR_USAGE || path.join(cfg, 'model-router', 'usage.jsonl');

try {
  fs.mkdirSync(path.dirname(usagePath), { recursive: true });

  // Load existing records into a map by agentId (drop the bogus "unknown" rows).
  const byId = new Map();
  try {
    for (const l of fs.readFileSync(usagePath, 'utf8').split(/\r?\n/)) {
      if (!l) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.agentId && o.agentId !== 'unknown') byId.set(o.agentId, o);
    }
  } catch { /* no prior file */ }

  // Scan this session's subagent transcripts; overwrite with fresh (final) sums.
  let scanned = false;
  if (fs.existsSync(subDir)) {
    scanned = true;
    for (const f of fs.readdirSync(subDir)) {
      const m = /^agent-(.+)\.jsonl$/.exec(f);
      if (!m) continue;
      const agentId = m[1];
      const s = sumTranscript(path.join(subDir, f));
      if (!s) continue;
      const total = s.input + s.output + s.cache_read + s.cache_creation;
      if (total === 0) continue;
      byId.set(agentId, {
        ts: new Date().toISOString(), agentId,
        model: s.model || 'unknown',
        input: s.input, output: s.output, cache_read: s.cache_read, cache_creation: s.cache_creation,
      });
    }
  }

  // Fallback: transcript_path was itself a subagent transcript (no subagents/ dir).
  if (!scanned) {
    const idFromName = /agent-(.+)\.jsonl$/.exec(path.basename(tp));
    let agentId = idFromName ? idFromName[1] : '';
    let s = sumTranscript(tp);
    if (s) {
      // try to recover agentId from the transcript body
      if (!agentId) {
        try {
          for (const l of fs.readFileSync(tp, 'utf8').split(/\r?\n/)) {
            if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
            if (o.agentId) { agentId = String(o.agentId); break; }
          }
        } catch { /* ignore */ }
      }
      const total = s.input + s.output + s.cache_read + s.cache_creation;
      if (agentId && agentId !== 'unknown' && total > 0) {
        byId.set(agentId, { ts: new Date().toISOString(), agentId, model: s.model || 'unknown', input: s.input, output: s.output, cache_read: s.cache_read, cache_creation: s.cache_creation });
      }
    }
  }

  // Rewrite the log from the merged map.
  const out = [...byId.values()].map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(usagePath, out ? out + '\n' : '');
} catch { /* never break the session */ }

process.exit(0);
