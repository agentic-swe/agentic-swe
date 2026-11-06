# Capabilities Overview

A summary of all capabilities introduced in the "#1 Moves" release.

## Tier 0 — Gap Closure

| Capability | Files | Description |
|---|---|---|
| **Doubt-Driven Verification** | `references/doubt-driven-verification.md`, `agents/prompts/adversarial-reviewer-prompt.md`, `commands/doubt.md` | Bounded in-flight adversarial review (CLAIM → EXTRACT → DOUBT → RECONCILE → STOP). Wired into design-review, code-review, and validation phases. Counter-capped at 3 cycles. |
| **Cross-Model Panel** | `references/cross-model-escalation.md`, `agents/panel/cross-model-reviewer.md`, `scripts/lib/model-gateway/` | Fourth panel axis; model calls go through the provider-agnostic model gateway (AE-019a). External CLI probe/invoke helpers were retired. |
| **Context Pack** | `references/context-engineering.md`, `templates/context-pack.md`, `schemas/context-pack.schema.json` | Typed artifact produced before every delegation — five-level hierarchy, trust levels, untrusted-content quarantine. |
| **Phase Anatomy Lint** | `test/phase-anatomy.test.js`, `scripts/lib/phase-lint/lint.cjs`, `schemas/phase-prompt.schema.json` | Every phase file must have Rationalizations + Red Flags sections, enforced in CI. |
| **Slicing Strategies** | `references/slicing-strategies.md`, `scripts/lib/scope/diff-scope-check.cjs` | Vertical / contract-first / risk-first slicing. Scope-creep tripwire fails CI on undeclared file edits. |
| **Source-Driven Development** | `references/source-driven-development.md` | VERIFIED / UNVERIFIED markers for library API claims. Wired into feasibility, design, implementation. |
| **Deprecation Ritual** | `references/deprecation-and-migration.md` | Removal Manifest, Chesterton's Fence rule, zombie-code sweep. |

## Tier 1 — Differentiating Capabilities

| Capability | Files | Description |
|---|---|---|
| **Replayable Worklogs** | `scripts/lib/replay/snapshot.cjs` | Artifact hash snapshots per transition. `replay` command re-validates every transition deterministically. |
| **Adaptive Track Router** | `scripts/lib/router/track-router.cjs`, `references/adaptive-track-router.md` | TF-IDF similarity over completed worklogs. Advisory track recommendation with confidence scores. |
| **Dashboard v2** | `schemas/dashboard-event.schema.json`, `commands/swe-tui.md` | Typed event stream for real-time cockpit. Terminal TUI for headless environments. |
| **Cross-Repo Work Items** | `references/cross-repo-coordination.md` | Linked repos with artifact dependencies. Gates block when linked artifacts are missing. |
| **Reflection Memory** | `scripts/memory-reflect.cjs`, `references/lessons-feedback-loop.md` | Auto-classify reflection-log entries into failure categories. Surface top lessons at feasibility and design. |
| **Type-Checked Phases** | `schemas/phase-prompt.schema.json`, `scripts/lib/phase-lint/lint.cjs` | Phase prompts validated against required sections. Strict linter with structured error output. |

## Tier 2 — Moonshots

| Capability | Files | Description |
|---|---|---|
| **OWAI Spec** | `docs/specs/owai-1.0.md`, `schemas/owai/`, `scripts/owai-conformance.cjs` | Open Work-item Interchange standard with L1/L2/L3 conformance levels. |
| **AGENTIC_SWE_BENCH** | `bench/`, `scripts/bench/run.cjs` | Pipeline-aware benchmark scoring task pass rate, cost, cross-model agreement, gate respect. |
| **Policy-as-Code** | `schemas/agentic-swe-policy.schema.json`, `scripts/lib/policy/merge.cjs`, `commands/policy.md`, `references/policy-as-code.md` | Typed policy files (org > repo > pack) for track rules, mandatory subagents, banned tools, budget overrides. |
| **Runtime Facade** | `schemas/typed-actions.schema.json`, `scripts/lib/runtime/` | Host-agnostic action vocabulary with adapters for Claude Code, Codex, and Gemini. |
| **Pair Mode** | `templates/nudge-event.md` | Human-in-the-loop co-pilot mode with typed nudges captured into audit log and memory. |

## Cross-Cutting

| Capability | Files | Description |
|---|---|---|
| **Test Coverage** | `test/phase-anatomy.test.js`, `test/model-gateway.test.js`, `test/replay.test.js`, `test/policy-merge.test.js`, `test/owai-conformance.test.js` | Deterministic tests for all new capabilities. |
| **Per-Phase Cost** | `scripts/lib/work-engine/transcript-cost.cjs` (`attributeCostByPhase`) | Cost attribution broken down by pipeline phase. |
