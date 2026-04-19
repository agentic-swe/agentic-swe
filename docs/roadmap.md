# Roadmap

This document sequences **what we build next** for agentic-swe. It complements [`the-north-star.md`](./the-north-star.md), which explains **why** the gaps exist and how they group into pillars. Here we focus on **order of work**, **deliverables**, and **done means**.

## Guiding sequence

Work should generally follow the priority ladder in the North Star doc:

| Tier | Focus | Roadmap anchor |
| :--- | :--- | :--- |
| **P0** | Universal protocol and “any surface” parity | Phases 1–2 (schema + harness) |
| **P1** | Execution, cost, and lean context | Phases 2–3 (memory + routing) |
| **P2** | Proof, scale, and enterprise fit | Phases 3–4 (eval + sandbox + integrations) |

Phases below can overlap in implementation, but **protocol and state correctness** stay ahead of optimization and polish.

---

## Phase 1 — Universal protocol and hard state

**Goal:** One way to describe work, one enforced lifecycle, same behavior in the IDE and in CI.

| Deliverable | Description |
| :--- | :--- |
| **WorkItem schema** | Strict JSON schema for a `WorkItem` consumed and produced by every entry path (Claude Code, Cursor, headless). Include `currentState`, budget/limit fields, delegation metadata (`assignedSubagent` or equivalent), and **evidence** attachments required for transitions. |
| **Programmatic state machine** | Replace Markdown-only workflow policy with a **coded** state machine (e.g. XState or a small DAG implementation). Invalid transitions (e.g. “testing → code review” without passing test evidence) must **fail at the engine**, not “fail socially” in chat. |
| **Headless harness** | CLI or Node runner that drives the state machine **without** a UI, so GitHub Actions (or similar) runs the same graph as local sessions. |

**Exit criteria:** A work item can be created, advanced only with valid evidence, and completed end-to-end from a single non-interactive command in a clean environment.

---

## Phase 2 — Durable memory and token-aware context

**Goal:** Decisions and history survive beyond one session and one model context window.

| Deliverable | Description |
| :--- | :--- |
| **Compaction + storage** | Parse `.worklogs/` and architecture-style artifacts into a **local** retrieval store (vector DB or SQLite + vectors). Treat this as an implementation detail; the contract is “queryable memory,” not a specific vendor. |
| **Retrieval before work** | On task start, run a fixed **pre-step** that pulls relevant prior context from memory before implementation begins. |
| **Sliding summaries** | Automated summarization of older chat or log segments: keep recent instructions verbatim; compress older debugging into short, cited bullets to preserve focus and tokens. |

**Exit criteria:** A new session on an old work item gets injected context that measurably reduces repeated questions and rework (qualitatively at first; later measurable via evals in Phase 4).

**In-repo progress:** Local SQLite index (**`memory-index`**), **memory prime** CLI, optional **embeddings** + **auto/hybrid** retrieval, deterministic **`memory-compact`**, **`memory-import`** (graph JSON bundle), **transcript sliding summary** (deterministic + optional LLM), and **session-start** memory prime **on by default** (opt out **`AGENTIC_SWE_MEMORY_PRIME=0`**) — see [`docs/specs/memory-graph.md`](specs/memory-graph.md) and [Durable memory](https://surajSFDC.github.io/agentic-swe/docs/durable-memory).

---

## Phase 3 — Orchestration, routing, and catalog hygiene

**Goal:** Subagents and models are chosen **deliberately**, and the catalog does not rot as it grows.

| Deliverable | Description |
| :--- | :--- |
| **Semantic router** | Embed task text (or structured fields) and retrieve top‑k specialists from the subagent catalog by similarity, instead of dumping full descriptions into one prompt. |
| **Model routing policy** | Route by phase or task class: fast/cheap models for lint, parse, and shallow edits; reserve the heaviest models for architecture, security-sensitive review, and deep debugging. |
| **Catalog CI** | CI job that lints the agent catalog: overlaps in purpose, missing I/O expectations, and broken or stale entries block merge. |

**Exit criteria:** Default routing is data-driven; catalog changes are mechanically guarded.

---

## Phase 4 — Sandboxing, verification, and regression gates

**Goal:** “Done” is **reproducible** and **checkable** outside the author’s laptop.

| Deliverable | Description |
| :--- | :--- |
| **Ephemeral execution** | On completion (or on demand), spin an isolated environment (Docker or microVM), install deps, run tests, capture exit codes and logs as **evidence** for the state machine. |
| **Gold benchmark suite** | Add `tests/evaluation_corpus/` (or equivalent) with a modest set of realistic issues and known-good outcomes. Wire a GitHub Action that runs the pipeline against this corpus. **Merge blocks** when success rate regresses after prompt or core policy changes. |

**Exit criteria:** Merges that touch orchestration or core prompts require a green eval signal; failures are actionable (logs + corpus case ID).

---

## What this roadmap does not claim

- **Today:** The Hypervisor model in `CLAUDE.md` is largely **session-carried**; this roadmap describes **productizing** enforcement and runners, not documenting current behavior as already shipped.
- **Scope creep:** Enterprise items (Jira/Linear sync, attested approvals, telemetry) belong in the North Star’s P2 pillar; fold them in after Phases 1–2 are credible, unless a sponsor explicitly sequences them earlier.

---

## Suggested next doc (optional)

When Phase 1 stabilizes, a short **technical spec** for the `WorkItem` schema and transition table (states, allowed edges, required evidence per edge) will keep implementers aligned. That can live beside this file or under `docs/specs/` when someone authors it.

## When to start Phase 1

Phase 1 (WorkItem schema, **programmatic** state machine, headless harness) is a major build. Start it when **adoption is no longer blocked by install friction** and at least one of the following is true:

1. **CI sameness** — You need the pipeline to advance states with **identical rules** in GitHub Actions (or similar) without a human in chat, and markdown policy is no longer acceptable as the only source of truth.
2. **Incident pressure** — Sessions repeatedly **skip or corrupt** transitions (`state.json` / `history` diverge from what shipped), and `/check` is not enough because hosts ignore it.
3. **Design partner** — A team refuses to scale usage until **invalid transitions are rejected by code**, not by reviewer vigilance.
4. **Multi-host contract** — You committed to **Tier D** in [Host support tiers](https://surajSFDC.github.io/agentic-swe/docs/host-support-tiers) (same engine in IDE and automation), not only Tier B docs.

Until then, prefer the **[Golden path](https://surajSFDC.github.io/agentic-swe/docs/golden-path)** and pre-roadmap docs: prove value with **`.worklogs/`**, gates, and evidence before investing in a runtime control plane.
