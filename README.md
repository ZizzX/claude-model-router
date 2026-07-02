# claude-model-router

Portable Claude Code config that routes subagents to cheaper models (Haiku/Sonnet/Opus) to cut token cost. Ships cost-aware subagents plus a routing-rules block for your global `CLAUDE.md`. One `install.sh`, works on any of your machines — or install it as a plugin.

> **Scope: Claude Code only.** The routing *concept* is portable — the tier policy lives in [`ROUTING.md`](./ROUTING.md) tool-agnostically — but supporting another agent tool (Codex, Cursor, …) needs an adapter that maps tiers to that tool's model/effort knobs.

> 🇷🇺 [Русская версия ниже](#-русская-версия)

## What's inside
- `agents/scout.md` — read-only code locator on **Haiku** (search / "where is X" / "does it already exist?").
- `agents/analyst.md` — read-only analyst on **Sonnet** (research / review / plan / synthesis).
- `CLAUDE.routing.md` — routing-rules + prompt-cache block (injected into `~/.claude/CLAUDE.md` by the script).
- `install.sh` — idempotent installer (copy or `--link`).

## Routing model
| Task | Agent type | Model |
|---|---|---|
| search / locate / count | `scout` | haiku (~60× cheaper than Opus) |
| research / review / plan / synthesis | `analyst` | sonnet (~5× cheaper than Opus) |
| code generation / hard reasoning | generic `Agent` | opus |

`opus` is the ceiling. A `PreToolUse` advisory hook nudges both ways: pure-retrieval tasks on a top-tier agent → down to `scout` (haiku), and any subagent explicitly set to `fable` (above opus, most expensive) → back down to `opus`+high, or lower for analysis/retrieval. Advisory only — never blocks.

## Impact report
The hook logs one JSONL event per subagent spawn (tier / model / task class / which nudge fired) to `~/.claude/model-router/events.jsonl`. See routing distribution, model mix, nudge counts, and an **estimated** token/cost saving vs an all-opus baseline:
```
bash "$(dirname "$(which claude 2>/dev/null)")/../scripts/router-stats.sh"   # or, from the plugin dir:
bash scripts/router-stats.sh
```
Savings are an estimate (the hook sees the *requested* model, not real usage). Tune via env: `MR_AVG_TOKENS` (tok/subagent), `MR_OPUS_PRICE` ($/Mtok), `MR_W_CHEAP|MR_W_MID|MR_W_CEILING` (per-tier price weight vs opus). A `fable` spawn shows as negative savings (overspend vs opus).

## Install

### Option A — plugin (as easy as skills, recommended)
Agents are auto-discovered, no files touched:
```
/plugin marketplace add ZizzX/claude-model-router
/plugin install model-router@claude-model-router
```
`/plugin list` to check, `/plugin marketplace update` to update.
Routing rules live inside the agent descriptions — Claude decides to delegate to scout/analyst on its own.

### Option B — script (agents + rules block in global CLAUDE.md)
Use this if you also want the routing meta-rule written into `~/.claude/CLAUDE.md`:
```bash
git clone https://github.com/ZizzX/claude-model-router ~/claude-model-router
bash ~/claude-model-router/install.sh          # copy (snapshot)
bash ~/claude-model-router/install.sh --link   # symlink (git pull auto-updates agents)
# restart Claude Code (agents load at startup)
```
`CLAUDE_HOME` overrides `~/.claude`. A plugin can't write to your CLAUDE.md (security) — that's what the script is for.

## Routing hook (advisory, optional)
Ships a `PreToolUse` hook on the `Agent` tool (`hooks/`, `scripts/route-advisor.sh`). When a **generic top-tier** subagent is spawned for a **pure read-only** task (locate/search/count, RU+EN), it injects a note suggesting the `scout` agent (Haiku). It **never blocks** — worst case is an ignored hint — and is biased toward quality: any edit/build verb, an already-cheap agent, or `model: haiku` → stays silent. Requires `jq` (no-ops if absent). The hook loads automatically with the plugin.

## Update
- **Plugin:** `/plugin marketplace update`.
- **Script (copy):** `git pull && bash install.sh`.
- **Script (`--link`):** `git pull` — symlinked agents update automatically; re-run only to refresh the CLAUDE.md block.

Re-running the installer never duplicates the CLAUDE.md block (marker-guarded).

## Intentionally NOT ported
- Project-specific agents (a repo-tuned `scout`/`analyst` variant with your paths and rules) — keep those local.
- Skills/plugins — installed via their own marketplace.
- `settings.json` (hooks/permissions) — left untouched to avoid clobbering machine-specific config. Merge manually if wanted.

---

## 🇷🇺 Русская версия

Переносимый конфиг Claude Code: субагенты роутинга по стоимости моделей (Haiku/Sonnet/Opus) для экономии токенов + блок правил для глобального `CLAUDE.md`. Один `install.sh` на любой твоей машине — или ставится как плагин.

> **Scope: только Claude Code.** Сама *концепция* роутинга переносима — политика тиров лежит в [`ROUTING.md`](./ROUTING.md) tool-agnostic — но под другой инструмент (Codex, Cursor …) нужен адаптер, мапящий тиры на его модели/effort.

### Что внутри
- `agents/scout.md` — read-only локатор кода на **Haiku** (поиск / «где X» / «уже есть?»).
- `agents/analyst.md` — read-only аналитик на **Sonnet** (ресёрч / ревью / план / синтез).
- `CLAUDE.routing.md` — блок правил роутинга + защиты prompt-cache (скрипт вставляет в `~/.claude/CLAUDE.md`).
- `install.sh` — идемпотентный установщик (copy или `--link`).

### Модель роутинга
| Задача | Тип агента | Модель |
|---|---|---|
| поиск / локация / подсчёт | `scout` | haiku (~60× дешевле Opus) |
| ресёрч / ревью / план / синтез | `analyst` | sonnet (~5× дешевле Opus) |
| генерация кода / сложная логика | generic `Agent` | opus |

`opus` — потолок. `PreToolUse`-хук советует в обе стороны: read-only задачи на топовом агенте → вниз до `scout` (haiku), а любой субагент, явно поставленный на `fable` (над opus, самый дорогой) → обратно на `opus`+high, либо ниже для анализа/поиска. Только совет — никогда не блокирует.

### Установка

**Вариант A — плагин (как skills, рекомендуется).** Агенты подхватятся авто-дискавери:
```
/plugin marketplace add ZizzX/claude-model-router
/plugin install model-router@claude-model-router
```
Правила зашиты в описания агентов — Claude сам делегирует scout/analyst.

**Вариант B — скрипт (агенты + блок правил в CLAUDE.md).** Если нужно мета-правило прямо в `~/.claude/CLAUDE.md`:
```bash
git clone https://github.com/ZizzX/claude-model-router ~/claude-model-router
bash ~/claude-model-router/install.sh          # copy (снимок)
bash ~/claude-model-router/install.sh --link   # symlink (git pull обновляет агентов сам)
# перезапусти Claude Code (агенты читаются на старте)
```
`CLAUDE_HOME` переопределяет `~/.claude`. Плагин писать в твой CLAUDE.md не может (безопасность) — для этого скрипт.

### Хук роутинга (advisory, опционально)
Возит `PreToolUse`-хук на инструмент `Agent` (`hooks/`, `scripts/route-advisor.sh`). Когда **generic top-tier** субагент спавнится для **чистой read-only** задачи (найти/поиск/список, RU+EN) — впрыскивает подсказку «используй scout (Haiku)». **Никогда не блокирует** — худший случай проигнорированный хинт — и смещён к качеству: любой глагол правки, уже-дешёвый агент или `model: haiku` → молчит. Нужен `jq` (без него no-op). Грузится автоматом с плагином.

### Обновление
- **Плагин:** `/plugin marketplace update`.
- **Скрипт (copy):** `git pull && bash install.sh`.
- **Скрипт (`--link`):** `git pull` — симлинки обновляются сами; перезапуск только чтобы обновить блок в CLAUDE.md.

Повторный install не дублирует блок в CLAUDE.md (маркеры).

### Что НЕ переносит (осознанно)
- Проектные агенты (репо-тюнинг `scout`/`analyst` со своими путями и правилами) — держи локально.
- Скиллы/плагины — через свой marketplace отдельно.
- `settings.json` (хуки/permissions) — не трогает, чтобы не затереть машинно-специфичное. Мержить вручную.
