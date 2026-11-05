# ADR-004 — Storage adapters

- **Status:** ADR-004a Accepted; ADR-004b Proposed
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-001, ADR-003, ADR-011, ADR-014

## Context

The proposed title bundled three decisions: the event store, a hosted store (Postgres), and the memory store (native SQLite/pgvector). For M2 the founder decided that the durable store stays JSONL files with leases and idempotency keys, with no SQLite and no Postgres. This record is therefore split. Roughly 60% of the `EventStore` interface already exists in `scripts/lib/work-engine/journal.cjs` (hash-chained, fsync'd `commitState`, `verifyJournalText` / `verifyWorkJournal`). The gaps found in review:

- `commitState` checks only `current_state`, not the sequence number.
- `read` has no `fromSeq` parameter.
- Every event embeds a full state snapshot.
- `state-lock.cjs` is a mutex, not a lease: it has no owner, TTL, or fencing.
- The integrity check is unkeyed sha256, so an agent can rewrite the chain plus `state.json` and still get `verified`.
- Some writers bypass the lock or skip tmp+rename, and store files can be symlinked.

## Decision

### ADR-004a — Event store (Accepted for M2)

Each work item has `.worklogs/<id>/journal.jsonl`: append-only, sha256 hash-chained, with file and directory fsync on append. It is the **single source of truth**. `state.json` and the idempotency index are caches. On any mismatch the journal wins, or the load fails closed. `EventStore` is the adapter seam:

- `append(e, expectedSeq)` acquires the work-dir lease, re-reads the tail, and rejects with `SEQ_CONFLICT` unless the tail seq equals `expectedSeq`. It then appends and fsyncs.
- Leases are files `{holder, host, token, epoch, expires_at}`. A monotonic epoch is stamped on every appended event, and an append carrying a lower epoch fails with `LEASE_FENCED`. An expired lease may be reclaimed; the reclaim bumps the epoch and is journaled as `lease.reclaimed`.
- Idempotency keys are deduped through a derived index that is rebuilt by replay and verified against the chain on each hit. A duplicate returns the original event and appends nothing.
- `read(workId, fromSeq)` streams. `verifyChain` reuses the `journal.cjs` verification.

All projection writes use tmp+rename. The engine refuses symlinked store files and resolves evidence paths with `realpath` containment. Append cost is bounded by tail-verify, with full verify on load, plus segmenting or a size budget. Large payloads are stored by sha256 reference.

Supported filesystems: local POSIX and NTFS. Network filesystems are unsupported and trigger a startup warning. Windows is best-effort until CI covers it.

**Security labeling (ADR-001):** in in-host mode the journal, index, and lease are agent-writable. Leases prevent accidental concurrent writes; they are not a security control. Chain integrity is detection-only and counts as tamper-evident only against an external anchor (ADR-011). Hosted mode counts as enforced only when these files are owned by a process identity the agent cannot write to, or are written only by CI (open question M2-Q6). Otherwise it is labeled cooperative.

**Deferred, NOT accepted:** a Postgres hosted adapter (append-only role) and any SQLite store. Each needs a new ADR and a founder decision after M2-Q6.

### ADR-004b — Memory store (remains Proposed; not M2)

Replace sql.js whole-file `persistDatabase` with native SQLite/pgvector. This requires a Node ≥ 22.5 or native-dependency decision. `package.json` dependencies are unchanged in M2.

## Consequences

- AE-020a builds the lease, `expectedSeq` check, and idempotency index on JSONL only.
- Multi-writer concurrency rests on file leases, not database transactions.
- Without a DB role that lacks UPDATE/DELETE, an M2 hosted log is non-agent-writable only through OS-level separation or CI.

## Alternatives

- Postgres for hosted mode: deferred (needs a new ADR).
- Native SQLite (`node:sqlite`) for the event store: excluded from M2.
