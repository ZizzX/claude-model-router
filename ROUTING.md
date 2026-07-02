# Routing policy (tool-agnostic)

The **policy** — which kind of task goes to which model tier — is independent of any
single agent tool. The Claude Code agents in `agents/` are one *implementation* of it.
To support another tool (Codex, Cursor, …), write an adapter that maps these tiers to
that tool's model/effort knobs — the policy below stays the same.

## Task → tier

| Task class | Tier | Why |
|---|---|---|
| **Locate** — search, "where is X", "who calls Y", all usages, count, map a directory, "does it already exist?" | **cheap** | Mechanical retrieval; no deep reasoning. Cheapest model is enough and ~orders of magnitude cheaper. |
| **Analyze** — read-only research before coding, synthesis across sources, diff review, parity check, migration plan, summarization | **mid** | Needs reasoning beyond retrieval, but produces analysis — not code. Mid tier balances cost vs quality. |
| **Build** — code generation, refactor, hard multi-step reasoning, context-heavy debugging | **top** | Correctness-critical generation. Use the strongest model; don't cheap out here. |

## Tier → model, per tool

| Tier | Claude Code (model + effort) | Codex (OpenAI) — *adapter TODO* |
|---|---|---|
| cheap | `haiku` + `effort: low` | GPT-5.x-Mini / low reasoning effort |
| mid | `sonnet` + `effort: high` | GPT-5.x / medium effort |
| top | `opus` (effort from session/skills) | GPT-5.x-Codex / high–xhigh effort |
| *(ceiling)* | `fable` — **above top, most expensive** | — |

`fable` is the ceiling, not a routing target: it sits above `opus` and costs the most. Treat
`top` as `opus`. Reserve `fable` only for a task that demonstrably needs its edge — otherwise
a `fable` subagent is paying above-top price, the mirror image of paying top price for retrieval.

Pair effort with the tier: retrieval is mechanical → `low` (cheaper, no quality loss); analysis
needs reasoning → `high`. Subagent `.md` frontmatter takes an `effort:` field (`low`/`medium`/`high`/`xhigh`;
`max` is session-only, not valid in frontmatter).

## Rules (any tool)
1. **Never spawn a subagent without deciding its tier** — the default usually inherits the top model = paying top price for retrieval.
2. Prefer routing by **named agent type** over passing a model per call — the type pins the tier, so it can't be forgotten.
3. **Locate → cheap, Analyze → mid, Build → top.** When unsure between two tiers, pick the cheaper for read-only work, the pricier only when generating code.
4. **Cap at `top` (opus).** Never spawn a subagent on `fable` (or any tier above opus) unless the task genuinely needs it — build tasks cap at `opus`+high, analysis at `sonnet`, retrieval at `haiku`. The advisory hook nudges `fable` spawns back down the ladder, symmetrically to how it nudges top-tier retrieval down to cheap.

## Prompt-cache hygiene (tool-agnostic)
- Send images/screenshots in one batch up front — an image dropped mid-session re-caches the whole tail.
- Don't mutate the stable prefix mid-session (global instructions, MCP servers) — it forces a full re-cache.
- Clear/reset context between unrelated tasks — shorter sessions are cheaper and higher-quality.

---

**Current implementation:** Claude Code only (`agents/scout.md` = cheap, `agents/analyst.md` = mid, generic Agent = top). Other tools need an adapter over this policy.
