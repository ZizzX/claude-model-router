<!-- BEGIN claude-model-router: subagent-routing -->
## Subagent routing (the cost lever)

**Delegate-first reflex — before any code work:** before you read, grep, or analyze in the MAIN context, ask "can a subagent do this?" Search / locate / count and read-only research / review — ALWAYS delegate (scout / analyst); don't burn the main context or pay Opus for retrieval. Keep only code generation and decisions in the main thread. If unsure whether to do read-only work yourself vs delegate → delegate.

`Agent()`/Task inherits the parent model (usually Opus) by default — a spawn with no explicit `model:` = Opus at full price. Decide the model on EVERY spawn, preferably by agent TYPE (the type pins the model more reliably than a manual `model:`):

| Subagent task | Agent type / model |
|---|---|
| search / locate / count / "where is X" / "does it already exist?" / map a directory | `scout` (haiku) |
| research before coding / synthesis / diff review / parity check / plan / summarization | `analyst` (sonnet) |
| code generation / hard reasoning | generic `Agent` (opus) |

Rule: **never spawn a subagent without deciding its model.** Search → `scout`; analysis / review / plan → `analyst`; code / logic only → Opus. Spawning several independent read-only tasks → send them in one message (they run in parallel).

**Ceiling = Opus.** `fable` is the most expensive model, sits ABOVE opus, and is not a routing target. Don't spawn a subagent on `fable` unless the task genuinely needs it: code/build → `opus`+effort:high, analysis → `sonnet`, search → `haiku`. The advisory hook nudges `fable` spawns back down the ladder — symmetrically to how it nudges read-only work off the top tier down to cheap.

## Prompt-cache hygiene
- Send all images/screenshots in the first message — dropping one mid-session re-caches the whole tail (~$1–2/turn on Opus).
- Don't edit CLAUDE.md or add an MCP server mid-session — it shifts the stable prefix and forces a full re-cache.
- `/clear` between unrelated tasks — shorter sessions are cheaper and higher quality.
<!-- END claude-model-router: subagent-routing -->
