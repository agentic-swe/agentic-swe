# ADR-014 — Minimal durable executor on the kernel; reassess Temporal/Restate before M5

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-001, ADR-003, ADR-004, ADR-009

## Context

Single maintainer. The durable store is JSONL files with leases and idempotency keys (ADR-004a). Work runs in host agent sessions with no supervising daemon, so pid-based leases, process-kill cancellation, and backoff timers do not fit. Review found four safety defects in the current dispatcher (`scripts/lib/dispatch/dispatcher.cjs`):

1. **Lost update.** `commitState` checks only `current_state`, and `start` loads `goal.json` and checks the budget before locking, so two parallel starts can drop a child and double-pass the budget.
2. **Starts are not crash-safe, and retries repeat side effects.** `initChild` runs before the goal commit, and idempotency keys minted per attempt would re-run pushes and PR writes.
3. **Gate states are resumable.** `childStatus` maps `approval-wait` / `ambiguity-wait` to `active`, and `resume` accepts `active`.
4. **In-flight work is not pinned to an engine or state-machine version**, so a pack upgrade can re-interpret history.

## Decision

Build a minimal durable executor in the dispatcher on the kernel journal. **Included:**

1. Bounded parallelism (`max_parallel`) over the approved DAG.
2. One expiring lease per goal and per child `{holder, host, epoch, expires_at}`, with heartbeat renewed on each engine transition. The epoch is stamped on every event, and a lower epoch fails `LEASE_FENCED`. Reclaim and cancel bump the epoch and are journaled.
3. Every read-decide-append, including budget checks, runs inside the goal lease and appends with `expectedSeq`. Counters and budgets are reduced from journal events.
4. Write-ahead start: `dispatch.starting` (key = item hash + attempt) → child init → `dispatch.started`, reconciled on re-run.
5. Intent before execute: `tool.requested` (with side-effect class) precedes every tool execution. Tool idempotency keys = hash(work_id, step, tool, canonical input) and do not depend on the attempt. On resume or retry, a side-effecting `tool.requested` with no `tool.completed` is reconciled read-only or escalated, never re-executed.
6. Retry is a new attempt child `<work_id>.a<n>`, only for a `pipeline-failed` whose engine failure code is classified retryable (never agent text), at most `max_attempts`, with a `not_before` backoff checked at the next invocation.
7. `approval-wait`, `ambiguity-wait`, and `escalate-*` are never auto-started, resumed, or retried. Only a recorded human decision advances them.
8. Cancel is cooperative: `dispatch.cancelled` bumps the epoch, and the engine refuses further child transitions with `CHILD_CANCELLED`. Unfinished remote effects are journaled for human cleanup. A restart needs a new `user:` approval bound to the item hash.
9. Decomposed sub-items enter the queue unapproved with their own item hash.
10. Each parallel child gets its own worktree, an allow-listed env, and per-child grants. Actual diff paths must fall within declared paths, or the child is re-routed or escalated.
11. Starts are gated by tool-call, wall-time, and attempt budgets as well as USD.
12. Each work item records `engine_version` and the sha256 of `state-machine.json` and `goal-state-machine.json` at init. Resume under a different digest refuses with `ENGINE_VERSION_MISMATCH` unless a declared migration exists.

Checkpoints are the existing journal snapshots plus `recoverState`. The lease file replaces `state-lock.cjs`, leaving one locking primitive.

**Excluded in M2:** durable timers or a scheduler daemon, signals and queries, sagas or compensation (rollback stays a human action), worker pools or remote workers, cross-host leases, automatic migration of in-flight work.

**Durability guarantee:** crash-safe and sleep-safe at the next invocation; not continuously running. In in-host mode, leases and cancel are cooperative (ADR-001).

**Reassess Temporal/Restate/Inngest** before M5 if any of these hold:

- hosted mode runs as a long-lived service (M2-Q6)
- more than one executor host is needed
- durable timers, signals, or compensation become requirements
- an in-flight migration is needed
- `LOCK_TIMEOUT` exceeds 1% of starts at the target `max_parallel`
- two durability defects occur in one milestone
- the executor core exceeds ~1,500 LOC

**Swap boundary:** the `Kernel` / `EventStore` interfaces.

## Consequences

- AE-020b implements write-ahead start, attempt children, gate-state exclusion (fixing `childStatus` / `resume`), engine-version pinning, cooperative cancel via epoch, and non-USD budgets.
- Under the M2 no-paid-spend decision the USD budget never trips; the non-USD budgets are the effective limits.

## Alternatives

- Temporal, Restate, Inngest, LangGraph checkpointer (RFC AE-010 §6): deferred until a reassessment trigger above holds.
