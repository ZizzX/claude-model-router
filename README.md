# claude-model-router

Portable Claude Code config that routes subagents to cheaper models (Haiku/Sonnet/Opus) to cut token cost. Ships cost-aware subagents, an advisory routing hook, and a routing rule that the plugin injects into context automatically. Install as a plugin (recommended) or via one idempotent `install.sh`.

> **Scope: Claude Code only.** The routing *concept* is portable — the tier policy lives in [`ROUTING.md`](./ROUTING.md) tool-agnostically — but supporting another agent tool (Codex, Cursor, …) needs an adapter that maps tiers to that tool's model/effort knobs.

> **Runtime: Node.js** (already required by Claude Code — nothing extra to install). The hooks and reporter are plain `.mjs`, so they run identically on **macOS, Linux, and native Windows** — no bash, no `jq`.

## What's inside
- `agents/scout.md` — read-only code locator on **Haiku** (search / "where is X" / "does it already exist?").
- `agents/analyst.md` — read-only analyst on **Sonnet** (research / review / plan / synthesis).
- `hooks/hooks.json` + `scripts/route-advisor.mjs` — `PreToolUse` advisory hook on the `Agent` tool (nudges + per-spawn logging).
- `scripts/session-guidance.mjs` — `SessionStart` hook that injects the routing rule into context and installs the `router-stats` launcher (so a plugin install alone makes the agent delegate-aware).
- `scripts/router-stats.mjs` — impact report from the spawn log.
- `CLAUDE.routing.md` — the canonical routing rule (source of truth for both the SessionStart hook and `install.sh`).
- `install.sh` — idempotent installer for the non-plugin path on Unix (copy or `--link`).

## Routing model
| Task | Agent type | Model |
|---|---|---|
| search / locate / count | `scout` | haiku (~60× cheaper than Opus) |
| research / review / plan / synthesis | `analyst` | sonnet (~5× cheaper than Opus) |
| code generation / hard reasoning | generic `Agent` | opus |

`opus` is the ceiling. A `PreToolUse` advisory hook nudges both ways: pure-retrieval tasks on a top-tier agent → down to `scout` (haiku), and any subagent explicitly set to `fable` (above opus, most expensive) → back down to `opus`+high, or lower for analysis/retrieval. Advisory only — it never blocks.

## Does the agent delegate on its own? (yes)
Installing the plugin is enough. Two mechanisms make the agent remember to spawn subagents:
1. **`SessionStart` hook** injects the routing rule (the delegate-first reflex + tier table) into context at the start of every session — no `CLAUDE.md` editing needed.
2. **`PreToolUse` advisory hook** fires at the moment of each spawn and nudges the model choice.

The hook can't *force* delegation (it only reacts once you already call the `Agent` tool), but the SessionStart rule primes the agent to reach for `scout`/`analyst` before doing read-only work itself.

## Impact report (terminal command)
The advisory hook logs one JSONL event per subagent spawn (tier / requested model / task class / which nudge fired) to `~/.claude/model-router/events.jsonl`.

The `SessionStart` hook installs a **version-independent launcher** on first session start, so any user gets the same terminal command regardless of which plugin version is active. Pick the form for your OS:
```bash
# Any OS (always works — Node is already installed):
node ~/.claude/model-router/router-stats.mjs

# macOS / Linux convenience (symlinked into ~/.local/bin if that dir exists & is on PATH):
router-stats

# Windows: add %USERPROFILE%\.claude\model-router to PATH, then:
router-stats.cmd
```
It renders ASCII bar charts: **spend by model** (est. tokens · share · est.$), **tier distribution**, task class, nudge counts, and a **savings** block comparing actual routing vs an all-opus baseline (≈ what it would cost with no cheap delegation). Savings are an estimate — the hook sees the *requested* model, not real usage; every spawn is assumed to be `MR_AVG_TOKENS`. Tune via env: `MR_AVG_TOKENS` (tok/spawn), `MR_OPUS_PRICE` ($/Mtok), `MR_W_CHEAP|MR_W_MID|MR_W_CEILING` (per-tier price weight vs opus). A `fable` spawn costs more than opus, so it reduces savings. For **real** per-model $ across the whole session, use the [token-optimizer](https://github.com/alexgreensh/token-optimizer) plugin — this report is about routing decisions, not exact billing.

## Install

### Option A — plugin (recommended)
Agents, both hooks, and the routing rule load automatically; no files are touched:
```
/plugin marketplace add ZizzX/claude-model-router
/plugin install model-router@claude-model-router
```
`/plugin list` to check, `/plugin marketplace update` then `/reload-plugins` to update.

### Option B — script (no plugin: agents + rule written into global CLAUDE.md)
Use this only if you don't want the plugin. It copies the agents and writes the routing rule into `~/.claude/CLAUDE.md` (a plugin delivers the same rule via the SessionStart hook instead). Note: `install.sh` does **not** register the hooks — the advisory nudge, spawn logging, and impact report are plugin-only.
```bash
git clone https://github.com/ZizzX/claude-model-router ~/claude-model-router
bash ~/claude-model-router/install.sh          # copy (snapshot)
bash ~/claude-model-router/install.sh --link   # symlink (git pull auto-updates agents)
# restart Claude Code (agents load at startup)
```
`CLAUDE_HOME` overrides `~/.claude`. Re-running never duplicates the CLAUDE.md block (marker-guarded).

> Don't run both paths: the plugin already injects the rule via the SessionStart hook, so `install.sh` would add a redundant copy to your `CLAUDE.md`.

## Update
- **Plugin:** `/plugin marketplace update` then `/reload-plugins`.
- **Script (copy):** `git pull && bash install.sh`.
- **Script (`--link`):** `git pull` — symlinked agents update automatically; re-run only to refresh the CLAUDE.md block.

## Intentionally NOT ported
- Project-specific agents (a repo-tuned `scout`/`analyst` variant with your paths and rules) — keep those local.
- Skills/plugins — installed via their own marketplace.
- `settings.json` (permissions) — left untouched to avoid clobbering machine-specific config.
