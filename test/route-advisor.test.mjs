// Golden-case tests for the PreToolUse classifier. Run: node --test
// Feeds JSON payloads through route-advisor.mjs and asserts which nudge fires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', 'scripts', 'route-advisor.mjs');

// Run the hook with a throwaway log so tests never touch real data.
function nudge(toolInput) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_input: toolInput }),
    env: { ...process.env, MR_LOG: path.join(os.tmpdir(), 'mr-test-events.jsonl') },
    encoding: 'utf8',
  }).trim();
  if (!out) return 'none';
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  if (/mechanical chore/.test(ctx)) return 'C';
  if (/set to `fable`/.test(ctx)) return 'B';
  if (/read-only \(locate\/search\)/.test(ctx)) return 'A';
  return '?';
}

const CASES = [
  // [name, tool_input, expected nudge]
  ['retrieval on generic top → A', { subagent_type: 'general-purpose', prompt: 'найди где определён useVacancy' }, 'A'],
  ['retrieval EN → A', { subagent_type: 'claude', prompt: 'search for all usages of foo' }, 'A'],
  ['edit stays quality → none', { subagent_type: 'general-purpose', prompt: 'почини баг в auth' }, 'none'],
  ['fable build → B', { subagent_type: 'general-purpose', model: 'fable', prompt: 'напиши компонент' }, 'B'],
  ['fable retrieval → B', { subagent_type: 'claude', model: 'claude-fable-5', prompt: 'найди использования' }, 'B'],
  ['chore commit+push (RU, "изменения") → C', { subagent_type: 'general-purpose', prompt: 'закоммить и запушь изменения' }, 'C'],
  ['chore bump+push (EN) → C', { subagent_type: 'general-purpose', prompt: 'bump the version and push' }, 'C'],
  ['codegen + commit stays edit → none', { subagent_type: 'general-purpose', prompt: 'почини баг и закоммить' }, 'none'],
  ['scout is left alone → none', { subagent_type: 'scout', prompt: 'найди файл' }, 'none'],
  ['explicit haiku → none', { subagent_type: 'general-purpose', model: 'haiku', prompt: 'найди X' }, 'none'],
  ['analyst (mid) is left alone → none', { subagent_type: 'analyst', prompt: 'проанализируй фичу' }, 'none'],
];

for (const [name, input, expected] of CASES) {
  test(name, () => assert.equal(nudge(input), expected));
}
