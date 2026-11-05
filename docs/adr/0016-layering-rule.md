# ADR-016 — Layering: downward-only dependencies; post-commit side effects via event subscribers

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-003, ADR-005, ADR-006, ADR-007, ADR-009, ADR-015

## Context

The proposed rule was the right goal but could not be enforced as written:

- No module was mapped to a layer. `scripts/lib` has about 30 dirs, and nothing said where `descent`, `context`, `bench`, `sync`, `dispatch`, `receipt`, and the rest belong.
- No lint existed in `npm run verify` or CI.
- A static require-graph scan of `origin/main` at `2735c5b` finds one strongly connected cluster of 11 `scripts/lib` modules (approval, bench, catalog, context, descent, github, memory, policy, skills, sync, work-engine) and one file-level cycle (`work-engine/engine.cjs` ↔ `work-engine/track-guard.cjs` and `work-engine/engine.cjs` ↔ `approval/human-approval.cjs`). work-engine ↔ descent is also hidden behind a dynamic `require` in `post-transition.cjs`.
- "Platform services talk to the kernel only through events" conflicts with the accepted synchronous, fail-closed gates: ADR-006 policy, ADR-005 GitHub verification, budget and acceptance checks.
- Today's only subscriber (`afterTransition` → muscle-memory → descent) runs `spawnSync(..., {shell: true})` with commands and cwd from agent-written artifacts outside the policy engine, writes `state.json` outside the journal, swallows errors, and accepts absolute module paths via `postTransitionHooks`.

The founder decided that all existing cycles are fixed before any M2 code starts, rather than frozen in a shrink-only baseline.

## Decision

Dependencies point downward: clients (1) → runtime (2) → core (3: kernel → {policy, approval, GitHub verification}) → storage/shared (4: journal, lease, paths, redaction, shared utils). Same-layer direction inside core is kernel → policy and kernel → approval, never the reverse. Platform services may depend on core interfaces and storage/shared, never on kernel entry points (`engine.cjs`, `applyTransition`). Core never imports services. Layer membership is defined in `config/layers.json`, which maps every `scripts/lib/<dir>` to exactly one layer or "service". A new dir must be added or the check fails.

**Admission vs side effects.** Decisions that can deny an action run synchronously, inline, before the event is committed, and fail closed. These are policy decisions (ADR-006), transition, artifact, budget, review, approval, and GitHub-verification gates (ADR-005), and acceptance checks. Only post-commit, non-gating effects run as event subscribers: descent and procedure capture, memory ingest, receipts, projections, telemetry. A subscriber can never gate, block, or roll back a transition.

**Subscriber governance.**

1. Every external effect of a subscriber is a tool call (ADR-009), authorized by the fail-closed policy engine before dispatch under the subscriber's own principal.
2. Subscribers are registered only in an engine-owned static manifest under the plugin root, with module digests. Runtime or per-call registration and absolute hook paths are test-only.
3. Subscribers never write `state.json` or the journal directly. They change state only by emitting kernel events with an idempotency key of (work_id, seq, subscriber_id).
4. Delivery is at-least-once with dedupe. Projection rebuild, recovery, and replay never dispatch subscribers. Each run journals `subscriber.completed` or `subscriber.failed`. Undelivered events are re-delivered on resume. A gate that depends on a subscriber's result fails closed.
5. In in-host mode event payloads are untrusted. Subscribers take executable commands only from engine-owned configuration, never from artifact text, and cwd is confined to the project root.

**Enforcement.** Zero-dependency checks run in `npm run verify` and CI:

- **Cycle check (lands with the cycle fixes, before any M2 code).** Builds the static `require` graph of `scripts/` and `bin/` and fails on **any** cycle, both between files and between `scripts/lib/<dir>` modules. There is no baseline and no allowlist for cycles.
- **Layer lint (lands with `config/layers.json`, alongside AE-020a).** Fails on any upward or forbidden edge, and on any non-literal `require` not in `config/layers.json#dynamic_allowlist`. Spawning a CLI from lib counts as an allowlisted upward edge.

**Scope.** The rule binds new code from acceptance. **All pre-existing cycles are removed before any M2 implementation item (AE-019..AE-023) starts**, through behavior-preserving refactors, and the cycle count stays at zero from then on. There is no shrink-only baseline.

## Consequences

- A cycle-removal refactor across the 11-module cluster lands before M2 Wave 1.
- Shared utilities (`redactSecrets`, deep merge, frontmatter parsing) move to a storage/shared module as needed to break cycles.
- AE-020c ports the muscle-memory / descent hook off `shell: true` and off direct `state.json` writes, and makes subscribers post-commit only and policy-governed.

## Alternatives

- Shrink-only baseline with no M2 item blocked: rejected by the founder in favor of zero cycles before M2 code.
- Kernel-to-service communication only through events, including gates: rejected, because denying checks must stay synchronous and fail closed.
