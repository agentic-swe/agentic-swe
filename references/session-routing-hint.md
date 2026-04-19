**Implicit routing (read before coding):**
1. List `.worklogs/` — if a work folder exists, read its `state.json` and continue that pipeline; do not start a second work item unless the user asks.
2. **Memory prime (default on)** — Session start usually includes a **memory prime** block unless **`AGENTIC_SWE_MEMORY_PRIME=0`**. Treat it as **advisory** retrieval only; **`state.json`** and repo files win on conflict (`CLAUDE.md` Source priority).
3. Match user intent to entry points:
   - Small fix, typo, single module → `/work` → expect **lean track** after `lean-track-check`.
   - Medium scope, tests + design but lighter review → `/work` → **standard track** may apply (`pipeline.track` `standard`).
   - New subsystem, security, multi-file architecture → `/work` → expect **rigorous track** (full design + reviews).
   - Design/spec only, no implementation → `/plan-only` or `/brainstorm`.
   - Implementation plan only (artifact already approved) → `/write-plan` then `/execute-plan` inside the same work item.
   - Extend phases/commands/agents → `/author-pipeline`.
4. Full rules: `${CLAUDE_PLUGIN_ROOT}/references/implicit-routing.md`. State machine: root `CLAUDE.md`.
