# AGENTIC_SWE_BENCH

Pipeline-aware benchmark for autonomous software engineering agents.

## Overview

Unlike SWE-bench (which measures one-shot code generation), AGENTIC_SWE_BENCH scores the **full engineering pipeline**: feasibility, design, implementation, review, validation, and governance. Submissions are conformant **OWAI** (Open Work-item Interchange) worklogs — see **`docs/specs/owai-1.0.md`** and **`scripts/owai-conformance.cjs`** for L1/L2/L3 levels; the bench runner targets validation consistent with **L3**-style completeness where implemented.

This scaffold sits alongside the broader **#1 Moves** capabilities (Doubt-Driven Verification, cross-model panel, Policy-as-Code, replayable snapshots, adaptive track routing, etc.). See **`docs/capabilities-overview.md`** for the full tier map. Bench scoring dimensions below are chosen so runs stress **gate discipline**, **budget honesty**, and **multi-model review** — the same pressures the production pipeline encodes.

## Scoring Dimensions

| Dimension | Weight | What's Measured |
|-----------|-------:|-----------------|
| Task pass rate | 40% | Does the submitted code pass the task's acceptance tests? |
| Cost efficiency | 20% | Total API cost (from **`state.json`** **`budget.cost_used`**) |
| Cross-model agreement | 20% | Did cross-model review surface issues that a single model missed? (Aligns with **`agents/panel/cross-model-reviewer.md`** and **`references/cross-model-escalation.md`**.) |
| Gate-respect score | 20% | Human gates respected? Budgets honored? Transitions valid? (Aligns with **`/check`** semantics, Policy-as-Code where present, and DDV/review loops.) |

## Task Format

Each task in **`bench/tasks/`** is a directory:

```
tasks/<task-id>/
  task.json          # Task description, acceptance criteria, expected track
  repo/              # Minimal repository snapshot
  expected/          # Expected artifacts or test patterns
  scoring.json       # Scoring rubric specific to this task
```

## Tasks

Three starter tasks ship with the benchmark, one per pipeline track:

| ID | Track | What it tests |
|----|-------|---------------|
| **`01-off-by-one`** | lean | Fix `countItems` to return `arr.length` instead of `arr.length - 1`. Acceptance: `node test/counter.test.js` passes. No design artifact required. |
| **`02-add-retry`** | standard | Implement bounded retry with exponential backoff in `fetchWithRetry`. Retries on 5xx, not 4xx; honours `maxAttempts`. Acceptance: 5 test cases covering success, retry-then-succeed, no-retry-on-4xx, exhaustion, and `maxAttempts=1`. Scoring bonus: `design.md` mentions retry strategy. |
| **`03-rate-limiter`** | rigorous | Implement `TokenBucket` with `tryConsume`/`getTokens`, `RangeError` on invalid config, and time-based refill. Security panel must flag negative `capacity`/`refillRate` as a DoS vector. Acceptance: 9 deterministic test cases. |

Each task directory follows the layout in **Task Format** below.

## Running

```bash
# Validate all tasks (no LLM key required)
node scripts/bench/run.cjs validate --all

# Validate a single task
node scripts/bench/run.cjs validate --task 01-off-by-one

# Score a completed worklog (requires a finished .worklogs/<id>/ directory)
node scripts/bench/run.cjs score <work-dir> [task-dir]
```

Full pipeline execution (requires an LLM API key):

```bash
# (planned — not yet implemented)
node scripts/bench/run.cjs run --task 01-off-by-one
```

The scorer:

1. Reads `state.json` from the completed worklog
2. Scores task pass rate (pipeline state reached `completed`), cost efficiency, cross-model review presence, and gate-respect (transition chain validity)
3. Outputs a scorecard JSON; exits 0 if total >= 0.6

## Contributing Tasks

See **`bench/tasks/TEMPLATE.md`** for the task format. Tasks should be:

- Self-contained (no undeclared external dependencies)
- Deterministically scorable
- Representative of real engineering work

## Frozen eval manifests (ADR-013)

Suites used for isolated / holdout claims are **frozen eval manifests**: a pinned
task list by content SHA, pool (`dev` | `public` | `private`), manifest digest,
`cold_run_required` for E8-cited runs, retained negatives, and model/provider
provenance. Local Ollama/llama.cpp may appear as `observed` evidence but must
set `sole_e8_proof: false`. The field `default_score` is forbidden.

- Schema: **`schemas/eval-manifest.schema.json`**
- Committed smoke manifest: **`bench/manifests/dev-smoke.json`**
- Validate: `node scripts/bench/run.cjs validate --manifest <path>` (also covered by `npm run bench:validate` / `validate --all`)
- Decision record: **`docs/adr/0013-isolated-eval-harness.md`** (Accepted)

Holdout packaging and the agent runner are separate work (AE-034b/c).

## References

| Topic | Location |
|-------|----------|
| OWAI spec | **`docs/specs/owai-1.0.md`** |
| Conformance runner | **`scripts/owai-conformance.cjs`** |
| Capability tiers (#1 Moves) | **`docs/capabilities-overview.md`** |
| Bench entrypoint | **`scripts/bench/run.cjs`** |
| Frozen eval manifest schema | **`schemas/eval-manifest.schema.json`** |
| ADR-013 isolated eval harness | **`docs/adr/0013-isolated-eval-harness.md`** |
