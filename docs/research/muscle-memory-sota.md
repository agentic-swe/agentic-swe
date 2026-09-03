# Muscle memory for agentic SWE — research and SOTA

**Date:** 2026-08-29
**Scope:** What already exists in **agentic-swe**, what the market is doing, and what this orchestrator must uniquely own. Architecture that follows is in [`docs/specs/muscle-memory-orchestrator.md`](../specs/muscle-memory-orchestrator.md).

This note is a research artifact, not a claim of `proven_at_scale`. Token-reduction numbers live only in dated `bench/results/*.json` scorecards.

## What the installed product already is

agentic-swe is a **host-agnostic plugin** (Claude Code, Cursor, Codex, OpenCode, Gemini) with:

- A **work-item state machine** (`.worklogs/<id>/state.json` is source of truth).
- **182 versioned skills** generated from commands, phases, and subagents, gated by golden eval (`npm run verify`).
- **Durable memory**: SQLite graph + chunks, session ingest, personal style profile, team sync events.
- **Descent ladder** L0–L3: replay recorded procedures before spending frontier tokens.

The gap vs the product goal is not “another chatbot wrapper.” It is **closing the loop**: every SWE action is an evaluated skill; every conversation is distilled into scoped memory; replay (not re-prompting) carries most of the load; **live** `/work` traffic—not only fixtures—must prove the 1–2% token claim.

## Cost evidence (why replay, not compaction)

| Finding | Source | Implication for this repo |
|--------|--------|---------------------------|
| SWE-bench Verified tasks average ~4.17M tokens / ~$1.86; input dominates | arXiv:2604.22750 | Cost is re-appended history, not one-shot generation |
| Same task varies up to ~30× across identical attempts | arXiv:2604.22750 | Failed retries dominate spend; capture verify+files, not chat |
| Deterministic graph retrieval ~17.8K tokens vs agentic exploration ~711K | Measured during architecture work | Retrieval helps but cannot hit 1–2% alone |
| Agent-controlled compaction ~22.7% savings | alphaXiv 2601.07190 | Compaction is a tax cut, not a 50–100× win |
| Recorded-procedure replay fidelity 1.0 at zero tokens | agrepl; arXiv:2607.16200 | L0 replay is the only published mechanism with that headroom |

**Measurement contract used here:** cold ≈ policy (7700) + L3 (~200K); warm ≈ policy (1750) + ladder tier. `target_met` requires ≥3 **delivered holdout** tasks and combined multiplier ≤ 2%. `proven_e2e_bench` allows fixture `.worklogs`. `proven_at_scale` requires **pack-root live** `.worklogs` with `budget.tier_totals`—isolated tmp dogfood does not count.

## Market / SOTA map (2025–2026)

| Approach | What it is | What it does not do (for SWE orgs) |
|----------|------------|-------------------------------------|
| **Agent Skills** (agentskills.io) | Portable `SKILL.md` + progressive disclosure | No eval gate, no work-item engine, no token ladder |
| **Cursor / Claude Code memory** | Host-level memories and transcripts | Not a versioned SWE skill catalog; not replay of verify commands |
| **Letta / MemGPT-style OS** | Hierarchical memory, paging | General agent OS; not fingerprint→procedure replay for tests |
| **Graph RAG / code graphs** | Retrieval over AST/deps | Still LLM-in-the-loop per task |
| **SWE-agent / OpenHands / Aider** | Tool-using coding agents | Optimize for solve rate, not 50–100× token reduction via muscle memory |
| **agrepl / procedure replay papers** | Recorded actions, zero-token replay | Not packaged as a multi-host SWE plugin with eval + worklogs |

**Positioning:** this orchestrator is a **compiler + runtime**. Frontier models compile procedures and skills once; the runtime selects evaluated skills, primes bounded memory, and **replays** L0/L1 before L3. Model IDs are mapped behind capability tiers so the loop survives vendor churn.

## Repo implications (implemented vs still unproven)

**Implemented (code + tests + benches):** skill eval fail-closed; transcript/session/git/organic skip_llm benches; **runtime skill routing boosted by the project memory graph** (`routeSkillsWithMemory`); production E2E `descent-try --files`; session-start chat-warm; host maps for Claude Code, Cursor, Codex, Gemini, OpenCode.

**Unproven against the headline claim:** fleet `/work` from independent teams producing live `.worklogs` `tier_totals` that keep the portfolio ≤ 2%. Isolated **consumer-repo** bench (`npm run bench:consumer-repo-descent`) proves the plugin path outside the pack root; `npm run fleet-learning-status` lists honest blockers. Until real fleet traffic exists, `goal_complete` stays false.

## References

- SWE-bench token economics: arXiv:2604.22750
- Compaction savings: alphaXiv 2601.07190
- Procedure replay: arXiv:2607.16200; agrepl
- Agent Skills: https://agentskills.io
- In-repo architecture: `docs/specs/muscle-memory-orchestrator.md`, `docs/specs/memory-graph.md`
