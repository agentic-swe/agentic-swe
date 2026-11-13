# ADR-004 — Storage adapters

- **Status:** ADR-004a Accepted; ADR-004b Accepted
- **Date:** 2026-11-06 (004a); 2026-11-13 (004b)
- **Decider:** founder
- **Related:** ADR-001, ADR-002, ADR-003, ADR-011, ADR-012, ADR-014, ADR-016; PD-40, PD-48

## Context

The proposed title bundled three decisions: the event store, a hosted store (Postgres), and the memory store (native SQLite/pgvector). For M2 the founder decided that the durable store stays JSONL files with leases and idempotency keys, with no SQLite and no Postgres. This record is therefore split. Roughly 60% of the `EventStore` interface already exists in `scripts/lib/work-engine/journal.cjs` (hash-chained, fsync'd `commitState`, `verifyJournalText` / `verifyWorkJournal`). The gaps found in review:

- `commitState` checks only `current_state`, not the sequence number.
- `read` has no `fromSeq` parameter.
- Every event embeds a full state snapshot.
- `state-lock.cjs` is a mutex, not a lease: it has no owner, TTL, or fencing.
- The integrity check is unkeyed sha256, so an agent can rewrite the chain plus `state.json` and still get `verified`.
- Some writers bypass the lock or skip tmp+rename, and store files can be symlinked.

For M4 the founder required native SQLite with WAL for the memory store now (PD-40), with mechanism and engines floor decided in the M4 ADR review (PD-48).

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

**Deferred from 004a:** a Postgres hosted adapter (append-only role). Memory SQLite is ADR-004b (Accepted for M4). Each further hosted-store change needs a new ADR and a founder decision after M2-Q6.

### ADR-004b — Memory store (Accepted for M4, PD-40 / PD-48)

The project and personal memory databases (`.agentic-swe/memory.sqlite`,
`~/.agentic-swe/memory.sqlite`) use **native SQLite** via Node’s built-in
`node:sqlite` (`DatabaseSync`), not sql.js whole-file `export`/`writeFileSync`
and not a native npm addon (`better-sqlite3` and similar).

**Runtime floor.** `engines.node` is **`>=22.13`** so `node:sqlite` loads
without `--experimental-sqlite` (C1). CI continues to test Node 22. Processes
started with `--no-experimental-sqlite` are unsupported for memory.
`ExperimentalWarning` from the module may appear; it is not a license to
depend on unstable APIs beyond what CI pins.

**Concurrency.** Databases open with `PRAGMA journal_mode=WAL` and a
non-zero busy timeout (`PRAGMA busy_timeout` ≥ 5000 ms or constructor
`timeout`). Writers use short transactions. The store MUST NOT rewrite the
entire DB file from an in-memory snapshot on each persist. Concurrent hook
writers (e.g. Stop capture vs SessionStart prime) MUST NOT clobber each
other; tests prove distinct inserts from overlapping writers both survive.

**Migration.** Existing sql.js-produced SQLite files keep path and schema
tables (`memory_meta`, `nodes`, `edges`, `chunks`, `chunk_embeddings`).
AE-030e performs backup (file copy and/or `sqlite.backup`), opens with
`node:sqlite`, writes `memory_meta.store_engine=node:sqlite`, and removes
the `sql.js` dependency once tests pass (C2). Rollback = restore backup.
After cutover, absence of `node:sqlite` fails closed (no silent sql.js
fallback).

**Implementation note.** The `engines.node` bump to `>=22.13` and the
removal of `sql.js` from `package.json` land in **AE-030e code PRs**, not
in this docs-only acceptance. Until those PRs merge, runtime code may still
use sql.js; new code must not cite ADR-004b as implemented until AE-030e
ships.

**Deferred, NOT accepted in this ADR:** hosted Postgres memory,
pgvector / vector extensions, and any change to ADR-004a’s JSONL event
store.

**Security labeling (ADR-001):** in in-host mode the SQLite files remain
agent-writable; WAL prevents accidental wipe races, not hostile tampering.

**Layering (ADR-016):** implementation stays in `scripts/lib/memory`
(`service`) + shared helpers (`storage`); no new `service → runtime`
edges; zero dependency cycles.

## Consequences

- AE-020a builds the lease, `expectedSeq` check, and idempotency index on JSONL only.
- Multi-writer concurrency for the event store rests on file leases, not database transactions.
- Without a DB role that lacks UPDATE/DELETE, an M2 hosted log is non-agent-writable only through OS-level separation or CI.
- AE-030e implements the `node:sqlite` WAL adapter, migration, concurrency tests, engines bump, and sql.js removal against ADR-004b.
- Accepted 004b on 2026-11-13 as amended in `m4-adr-review.md` A1–A6 (PD-48; C1 = `>=22.13`, C2 = remove sql.js / fail closed).

## Alternatives

- Postgres for hosted mode: deferred (needs a new ADR).
- Native SQLite (`node:sqlite`) for the event store: excluded from M2; event store remains JSONL (004a).
- `better-sqlite3` for memory: rejected for M4 (install-script / audit friction).
- Keep sql.js as a silent runtime fallback after cutover: rejected (C2).
