#!/usr/bin/env node
// claude-model-router — SessionStart hook (Node.js, cross-platform). Two guarded
// side-effects:
//   1. Injects the routing rule into context so a plain plugin install is enough
//      for the agent to remember the delegate-first policy (no CLAUDE.md editing).
//      Single source of truth: CLAUDE.routing.md (also used by install.sh).
//   2. Installs a version-independent `router-stats` launcher so EVERY user, on any
//      OS, can run the impact report from a terminal with a stable command:
//        node ~/.claude/model-router/router-stats.mjs        (works everywhere)
//        router-stats            (POSIX: ~/.local/bin symlink, if that dir exists)
//        router-stats.cmd        (Windows: add ~/.claude/model-router to PATH)
//
// Only the guidance JSON is written to stdout; the launcher install is silent.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(here, '..');
const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const stableDir = path.join(cfg, 'model-router');

// ── Side-effect 2: refresh the stable terminal launcher (silent, best-effort).
try {
  fs.mkdirSync(stableDir, { recursive: true });
  const statsSrc = path.join(root, 'scripts', 'router-stats.mjs');
  const statsDst = path.join(stableDir, 'router-stats.mjs');
  fs.copyFileSync(statsSrc, statsDst);

  // POSIX shell wrapper: `router-stats`. Embed the absolute .mjs path so it works
  // when invoked through a ~/.local/bin symlink (where $0's dirname is wrong).
  const shWrap = path.join(stableDir, 'router-stats');
  fs.writeFileSync(shWrap, `#!/usr/bin/env sh\nexec node "${statsDst}" "$@"\n`);
  try { fs.chmodSync(shWrap, 0o755); } catch { /* chmod is a no-op on Windows */ }

  // Windows batch wrapper: `router-stats.cmd`
  const cmdWrap = path.join(stableDir, 'router-stats.cmd');
  fs.writeFileSync(cmdWrap, '@echo off\r\nnode "%~dp0router-stats.mjs" %*\r\n');

  // POSIX convenience: symlink into ~/.local/bin if that dir already exists (commonly on PATH).
  const localBin = path.join(os.homedir(), '.local', 'bin');
  if (process.platform !== 'win32' && fs.existsSync(localBin)) {
    const link = path.join(localBin, 'router-stats');
    try { fs.rmSync(link, { force: true }); } catch { /* ignore */ }
    try { fs.symlinkSync(shWrap, link); } catch { /* ignore */ }
  }
} catch { /* launcher install must never break the session */ }

// ── Side-effect 1: emit the routing rule as SessionStart additionalContext.
try {
  const doc = path.join(root, 'CLAUDE.routing.md');
  const body = fs.readFileSync(doc, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.includes('claude-model-router: subagent-routing'))
    .join('\n')
    .trim();
  if (body) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: body },
    }));
  }
} catch { /* no guidance if the doc is missing */ }
process.exit(0);
