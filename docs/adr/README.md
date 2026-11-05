# Architecture Decision Records

Architecture decisions for the AutoEng runtime built on Agentic SWE. Each record states its status, date, and decider. A record marked **Accepted** binds new code from its acceptance date. No code change may cite an ADR that is not listed here as Accepted.

The full list of sixteen ADRs was proposed in the AutoEng target-architecture RFC (AE-010 §11). The eight below were reviewed for milestone M2 (one architecture, one security, and one adversarial reviewer per ADR) and accepted by the founder with the amendments recorded in each file.

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-002](0002-node-typescript.md) | Node.js + TypeScript; incremental migration of existing CJS | Accepted | 2026-11-06 |
| [ADR-004](0004-storage-adapters.md) | Storage adapters: 004a JSONL event store (Accepted); 004b memory store (Proposed) | Accepted (004a) / Proposed (004b) | 2026-11-06 |
| [ADR-008](0008-model-gateway.md) | Provider-agnostic model gateway; usage from provider responses | Accepted | 2026-11-06 |
| [ADR-009](0009-tool-contract.md) | Tool contract, declared permissions, argv execution, sandbox profiles | Accepted | 2026-11-06 |
| [ADR-011](0011-receipts-from-verified-log.md) | Receipts derived only from a verified log; integrity, trust, and anchor status | Accepted | 2026-11-06 |
| [ADR-014](0014-minimal-durable-executor.md) | Minimal durable executor on the kernel; reassess Temporal/Restate before M5 | Accepted | 2026-11-06 |
| [ADR-015](0015-repository-module-layout.md) | Repository and module layout (one repo; build in place for M2) | Accepted | 2026-11-06 |
| [ADR-016](0016-layering-rule.md) | Layering: downward-only dependencies; post-commit side effects via subscribers | Accepted | 2026-11-06 |

Other RFC ADRs:

- ADR-001 (two operating modes), ADR-003 (event-sourced, hash-chained kernel), ADR-005 (GitHub review is the binding approval), ADR-006 (fail-closed policy engine), and ADR-007 (engine-owned loop counters) were accepted by the founder on 2026-10-31. Their records have not been written into this directory yet.
- ADR-010 (skill manifest), ADR-012 (redact-on-write memory), and ADR-013 (isolated eval harness) remain Proposed.

## Conventions

- File name: `NNNN-short-title.md`, numbered by ADR id.
- Sections: Status, Context, Decision, Consequences, Alternatives.
- An accepted ADR changes only through a new ADR that supersedes it, or a dated amendment section approved by the founder.
