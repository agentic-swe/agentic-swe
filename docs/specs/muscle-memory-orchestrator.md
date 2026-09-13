# Muscle memory orchestrator — architecture and measurement

**Status:** Implemented in-repo (Phases 0–5); bench token-reduction evidenced; fleet-scale `proven_at_scale` pending live team usage.

This spec is the validated architecture plan for evolving agentic-swe from an LLM-narrated pipeline into a **compiler-and-runtime** system: frontier tokens compile durable artifacts once; a deterministic runtime replays them at near-zero marginal cost.

## Thesis and research basis

| Finding | Source | Implication |
|--------|--------|-------------|
| SWE-bench Verified tasks average ~4.17M tokens / $1.86; input dominates | arXiv:2604.22750 | Token cost is mostly re-appended history, not one-shot reasoning |
| Same task varies up to 30× across identical attempts | arXiv:2604.22750 | Failed attempts and re-reasoning dominate spend |
| Deterministic graph retrieval ~17.8K tokens vs agentic exploration ~711K | Measured in plan research | Retrieval alone cannot reach 1–2%; replay is required |
| Agent-controlled compaction ~22.7% savings | alphaXiv 2601.07190 | Compaction is insufficient vs recorded-procedure replay |
| Recorded-procedure replay fidelity 1.0 at zero tokens | agrepl, arXiv:2607.16200 | L0 replay is the only mechanism with 50–100× headroom |

**Market alignment:** See [`docs/research/muscle-memory-sota.md`](../research/muscle-memory-sota.md). Agent Skills (agentskills.io) for portable skill packaging; progressive disclosure matches industry direction. Procedural / muscle memory remains the least-developed agent memory type in shipping coding agents.

## Execution ladder

```
Task → Fingerprint (files + verify + failure signature)
  → L0 Reflex (0 tokens): procedure replay, repo-map, engine transition, lint/test oracle
  → L1 Recall (~1.5K): verify-only procedure match, memory-assisted
  → L2 Assist (~8K): memory-guided verify, repo-map test verify
  → L3 Deliberate (~200K): frontier model
Success → Distill → Eval gate → Promotion (L1→L0 after 2 successes or human approval)
```

Implementation:

| Component | Path |
|-----------|------|
| Fingerprint | `scripts/lib/descent/fingerprint.cjs` |
| Replay | `scripts/lib/descent/replay.cjs` |
| Full ladder | `scripts/lib/descent/ladder.cjs` |
| Promotion / demotion | `scripts/lib/descent/promotion.cjs` |
| Capture from validation | `scripts/lib/descent/capture-procedure.cjs` |
| Session mining | `scripts/lib/descent/mine-session-procedures.cjs` |
| Transcript tool mining | `scripts/lib/descent/mine-transcript-procedures.cjs` |
| Tier telemetry | `scripts/lib/descent/tier-telemetry.cjs` |
| Token estimates | `config/descent.default.json` |

## Skill substrate

- **182 skills** under `skills/` (commands, phases, subagents) via `scripts/generate-skills.cjs`
- Governance in SKILL.md `metadata`: `tier`, `eval_status`, `eval_ref`, `version`, `provenance`
- **Fail-closed gate:** `scripts/lib/skills/eval-gate.cjs` blocks autonomous use of `unevaluated`, `deprecated`, and **unknown** skills
- **Golden eval:** `scripts/skill-eval.cjs` + `config/skill-golden-eval.json`; **182/182 evaluated** in `npm run verify`
- **Runtime discovery:** `scripts/skill-route.cjs` ranks evaluated skills and flags unevaluated ones; session-start uses `routeSkillsWithMemory` so project memory graph, **evaluated procedure `npm run` rituals**, and chunk mentions can boost skills the team actually uses

## Memory graph

Three scopes: **session** (transcripts in project sqlite), **personal** (`~/.agentic-swe/memory.sqlite`), **team** (git-sync events ingested as `work_id=team` chunks).

| Pipeline stage | Command / hook |
|----------------|----------------|
| Repo + chunk index | `npm run memory-index` |
| All scopes | `npm run ingest-memory-scopes` |
| Session ingest | `scripts/ingest-sessions.cjs`, `scripts/cold-start-warm.cjs` |
| Stop capture + distill + evolve | `scripts/session-capture.cjs` → `scripts/evolve-cycle.cjs` (hooks Stop); **Cursor `session-stop` also runs `hook-record-cost.cjs`** (parity with Claude Code) |
| Callable search | `npm run memory-search -- --scope session\|personal\|team` |
| Prime (session start) | `npm run memory-prime`, `hooks/session-start` |
| Team sync | `npm run sync:memory` → `scripts/sync/git-sync.cjs`; events ingested by `ingestTeamEvents` |
| Style profile | `scripts/lib/memory/style-profile.cjs` → personal sqlite |

Storage: `.agentic-swe/memory.sqlite` (nodes, edges, chunks). Memory is **advisory**; `state.json` and repo files remain authoritative.

## Model independence

- Capability tiers: `fast|balanced|heavy|frontier` (not vendor model IDs)
- **Model independence:** typed actions in a context pack translate to Claude Code, Cursor, Codex, and Gemini tool names (`scripts/lib/runtime/hosts.cjs`).
- Conformance: `scripts/model-conformance.cjs` in `npm run verify`

## Progressive disclosure

- **CLAUDE.md** core ~7K bytes (~1,750 tokens measured); deferred policy in `references/deferred/hypervisor-deferred.md`
- **AGENTS.md** portable mirror; drift checked in verify
- **repo-map:** `npm run repo-map -- --symbol|--imports-of|--tests-for`

## Operating loop integration

| Phase | Integration |
|-------|-------------|
| Session start | Memory prime, model tier hint, descent hint, skill-route hint |
| Implementation | Engine `implementation-descent` + **`context-pack.json`** (evaluated muscle_memory) on entry |
| Validation approved | `applyTransition` runs `validation-descent` (`tier_totals`) + `descent-capture` into the **project** procedure store (plugin store used as fallback for replay) |
| Install | `npm run cold-start-warm` documented in `/install` |

## Measurement contract

**Delivered unit:** one corpus task whose acceptance command exits 0.

**Headline metric:** median delivered tokens per unit (policy + ladder tier estimate), cold vs warm portfolio.

**Honesty rules (enforced in scorecards):**

1. **Circular benchmark flag** when L0 procedures are seeded from the same corpus being measured
2. **Holdout benchmark** seeds oracle-* only, evaluates ritual-* + mined-* without circular seeding
3. **Learning curve** simulates incremental validation-approved captures
4. **Portfolio benchmark** uses live `.agentic-swe/procedures.json` + full L0–L3 ladder
5. **`target_met` requires** `min_holdout_delivered` (default 3) **and** combined portfolio multiplier ≤ 2%
6. **`claim_status: proven_at_scale`** requires bench holdout target **and** live `.worklogs` `tier_totals` (≥1 work item, not bench fixtures)
7. **`claim_status: proven_e2e_bench`** — bench holdout + E2E fixture work items (reproducible CI evidence)
8. **Production E2E bench** exercises real `descent-try` with `--files` holdout task keys (corpus fingerprints, not `bench-<id>` work_id) and plugin `project-root`, plus `validation→pr-creation` descent-capture (implementation.md backticks like `` `mined-trivial-pass` `` count as declared file keys)
9. **Self-evolution loop** — Stop hook `session-capture` → chunks + nodes → `evolve-cycle` mines L1 candidates from session text, **host tool traces**, **repo rituals**, and **git history**; **`skill-eval suggest`** / **`scaffold-rituals`** / **`evolve-cycle --promote-rituals`** promote or scaffold skills backed by evaluated `npm run` procedure rituals (project-local skills in **`.agentic-swe/skills`**); **session-start `session-chat-warm`** ingests recent host transcripts then mines **session chunks and Read/Shell tool traces**; then **captures organic `/work`**; **unevaluated procedures are not replayed**
10. **Live work-engine path** — `applyTransition` validation→pr-creation records `budget.tier_totals` via `validation-descent` (declared files + git/transcript/**organic-worklog** overlap, not `work_id` as the only fingerprint file) and captures procedures. Session-start binds `.worklogs/<id>` when the git branch (or `work/`/`feature/` suffix) matches that id, including completed items.
11. **Organic session USD** — `bench:organic-portfolio` reports `session_usd_multiplier` from `budget.cost_used` / `usage_totals` vs warm policy+ladder tokens. That is billed-equivalent replay of recorded verify (and captured file reads), not a claim that the original design session would now cost 1–2%.
12. **Zero-LLM pack replay** — on fingerprint skip_llm, `implementation-descent` executes `context-pack.json` (declared file reads + **primary verify only**) and writes `descent-replay.md`. CLI: `npm run replay-context-pack -- --work-dir .worklogs/<id>` or `work-engine replay-pack`. Extra `muscle_memory` / `verification_commands` rows are listed, not executed (avoids whole-repo `npm test`).
13. **Organic counts** — `sources.organic` / `organic_live` are pack-root `.worklogs` only. `organic_fixtures` is reported separately and must not pad team-learning gates. `npm run objective-evidence` keeps `goal_complete: false` (product fleet goal); use `scorecard_all_met` for the local matrix.

**Commands:**

```bash
npm run bench:token-scorecard      # publish scorecard
npm run bench:warm-cold            # warm vs cold model
npm run bench:descent-holdout      # non-circular holdout
npm run bench:descent-learning-curve
npm run bench:portfolio            # live store + ladder
npm run bench:production-evidence  # work-engine E2E + tier_totals fixtures
npm run bench:accumulate-holdout   # validation capture for delivered holdout
npm run ingest-memory-scopes       # repo + chats + team events + git history + organic + muscle replay
npm run live-production-status     # live pack .worklogs vs proven_at_scale
npm run fleet-learning-status      # honest blockers for product goal_complete
npm run dogfood:live-worklogs      # maintainer/CI: pack-root live work items via applyTransition
npm run bench:live-path            # isolated tmp .worklogs (not pack-root)
npm run bench:organic-portfolio    # organic /work capture + ladder + session USD when billed
npm run bench:transcript-descent   # conversation tool trace → evaluated replay vs L3
npm run bench:git-descent          # git co-changed tests → implementation skip_llm vs L3
npm run bench:git-pack-descent     # this pack’s git history → isolated store skip_llm
npm run bench:organic-descent      # organic /work capture → follow-up skip_llm vs L3
npm run bench:session-mine-descent # session chunks → isolated verify skip_llm vs L3
npm run bench:implementation-entry # skip_llm_exploration vs L3 on fingerprint hit
npm run bench:suite                # includes dogfood-live before portfolio + objective-evidence
```

**Evidence artifacts:** `bench/results/*.json` (date-stamped). Do not claim 1–2% until holdout coverage and production `tier_totals` confirm.

## Current evidence snapshot (2026-08-29)

| Metric | Value |
|--------|-------|
| Fixed overhead reduction | 77.3% (7700 → 1750 policy tokens) |
| Skills evaluated | 182/182 |
| Holdout delivered | 3/7 (`mined-*` pass tasks; `ritual-*` are negative controls) |
| Bench portfolio multiplier | ~0.84% per-task (3 holdout L0 hits) |
| **`bench_target_met`** | **true** |
| **`claim_status`** | **`proven_at_scale` on a pack with live `.worklogs/`** (gitignored; CI remains `proven_e2e_bench` without those files) |
| Production E2E | 3 fixture + 3 live work items @ 0.84% portfolio via `tier_totals` |
| Organic session USD | Reported when live worklogs have `usage_totals`; CI fixtures typically omit bills |
| Live pack `.worklogs` | CI/maintainer dogfood via `applyTransition` (gitignored). **Organic `/work` still required** for `organic-team-learning`. |
| Corpus L0 replay (circular) | 16/16 delivered @ 0 frontier tokens |
| Holdout (non-circular isolated) | improves after validation capture accumulation |

## Risks

- **Bad muscle memory:** eval gate, auto-demotion after 2 verify failures, `state.json` authority
- **Secrets in transcripts:** mandatory redaction at capture
- **Sync optional:** full test suite passes offline
- **Scope:** `/work` engine preserved; no monolithic rewrite

## Related specs

- [`memory-graph.md`](memory-graph.md) — memory layers and CLI
- [`catalog-routing.md`](catalog-routing.md) — model routing and catalog
- [`work-item-engine.md`](work-item-engine.md) — state machine and budgets
- Plan (read-only): `.cursor/plans/muscle_memory_orchestrator_023e5d20.plan.md`
