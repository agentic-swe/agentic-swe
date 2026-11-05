# ADR-011 — Receipts derived only from a verified log; report integrity, trust, and anchor status

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-001, ADR-003, ADR-004, ADR-009

## Context

Three facts in the current code undercut the proposed wording:

1. `scripts/lib/receipt/extract.cjs` builds decisions, gates, cost, and counters from `state.json` history and regex-counts tool calls in `audit.log`, with integrity as a side row. Editing `state.json` reasons or cost while leaving the journal intact still renders `Integrity | verified`.
2. `integrityReport` returns `verified` for any self-consistent unkeyed chain, and truncation is detected only via the agent-writable `state.json.journal.seq`.
3. The code label `unanchored` already means "no journal or imported history", while the RFC used it for "verified but not externally anchored".

There is also a second chain, `github-calls.jsonl`, that is not bound to the work journal, and hand-written receipt addenda need a sanctioned place.

## Decision

A receipt is a pure fold over the verified events of the work journal (`journal.jsonl`). Every entry carries the `source_seq` of the event it came from. `state.json`, `audit.log`, `pr-link.txt`, and any auxiliary file are never receipt content; differences from them are reported as divergences. An auxiliary hash chain (e.g. `github-calls.jsonl`) is in scope only when a work-journal event records its head hash.

A receipt reports three independent fields:

- `integrity` ∈ {`verified` (chain internally consistent), `FAILED at seq N`, `unverified-import`, `no-journal`}
- `trust` ∈ {`cooperative`, `enforced`}
- `anchor` ∈ {`none`, `not-checked (offline)`, `anchored seq N by <identity> (independent|cooperative)`, `ANCHOR_MISMATCH`}

The existing code label `unanchored` for pre-journal or imported worklogs is renamed `unverified-import` / `no-journal`. Without an independent anchor or a hosted log the agent cannot write, `trust` is `cooperative`, and the receipt states: "cooperative evidence: the producing agent could rewrite this log." On a failure at seq N, only events with seq < N render, marked as the verified prefix, and `receipt verify` exits non-zero. `receipt verify <dir>` runs offline using only the work dir. It recomputes artifact sha256 digests (mismatch gives `ARTIFACT_MISMATCH`) and proves internal consistency only.

**Anchors:** an anchor records `(work_id, seq, hash)`. The verifier accepts it only from a configured author identity, only if unedited, and only if the local event at `seq` has that hash. Check runs are preferred; PR comments count only from a configured bot identity. The medium and write scope remain pending open question M2-Q7, and anchoring is a separate service (AE-023b). Until M2-Q7 is decided, no track requires anchoring, and exit criterion E6's tamper-evidence clause is reported as not met.

Artifact `producer` is declared, not verified. Redaction is best-effort (pattern-based) and applied at render time. Human addenda are separate `attestation` sections naming author, date, and the head SHA they cover, never merged into derived events; past addenda remain valid. Legacy items render under a `LEGACY: not log-derived` banner. The markdown layout is preserved. Depends on AE-020a typed events.

## Consequences

- AE-023a implements the three-field labels, verified-prefix rendering, the `LEGACY` banner, the `attestation` section, and artifact digest recompute.
- AE-023b implements the `(work_id, seq, hash)` anchor format and identity and edit checks.
- The existing `receipt-*` tests and the sample receipt move to journal fixtures with the same markdown layout.

## Alternatives

- Keep deriving receipts from `state.json` with integrity as a side row: rejected, because it lets edited projections render as verified.
