**Implicit routing (read before coding):**
1. List `.claude/.work/` — if a work folder exists, read its `state.json` and continue that pipeline; do not start a second work item unless the user asks.
2. Match user intent to entry points:
   - Small fix, typo, single module → `/work` → expect **lean track** after `lean-track-check`.
   - Medium scope, tests + design but lighter review → `/work` → **standard track** may apply (`pipeline.track` `standard`).
   - New subsystem, security, multi-file architecture → `/work` → expect **rigorous track** (full design + reviews).
   - Design/spec only, no implementation → `/plan-only` or `/brainstorm`.
   - Implementation plan only (artifact already approved) → `/write-plan` then `/execute-plan` inside the same work item.
   - Extend phases/commands/agents → `/author-pipeline`.
3. Full rules: `.claude/references/implicit-routing.md`. State machine: root `CLAUDE.md`.
