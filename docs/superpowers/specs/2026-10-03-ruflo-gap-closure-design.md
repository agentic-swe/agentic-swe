# Ruflo gap closure — Design Spec

**Status:** Approved for Phase 1 planning (2026-10-03)  
**Authors:** Competitive gap review vs [ruvnet/ruflo](https://github.com/ruvnet/ruflo); design dialogue 2026-10-03  
**Related:** [`docs/specs/positioning-and-receipt.md`](../../specs/positioning-and-receipt.md), [`docs/specs/muscle-memory-orchestrator.md`](../../specs/muscle-memory-orchestrator.md), [`docs/specs/memory-graph.md`](../../specs/memory-graph.md), [`docs/roadmap.md`](../../roadmap.md), canvas `agentic-swe-vs-ruflo.canvas.tsx`

---

## 1. Problem

Public comparison with Ruflo shows two different products:

| Axis | Agentic SWE today | Ruflo today |
|---|---|---|
| Job | File-backed SWE pipeline → PR + human gate | Standing multi-agent meta-harness |
| Control | Hypervisor + `state-machine.json` | Hooks + swarm router |
| Audit | `.worklogs/` + `/receipt` + cost ledger | Federation audit + `ruflo verify` install witness |
| Memory | Local SQLite graph, optional embeddings, **muscle-memory descent (L0–L3)** | HNSW AgentDB, SONA / ReasoningBank |
| Multi-agent | Design panel + 138 catalog specialists | Swarm topologies + federation + plugin marketplace |
| Maturity | Early OSS (~5 stars) | Large community (~73.7k stars) |

A naive “be better than Ruflo” reading pushes toward swarms, federation, and MCP tool count. That would abandon the product moat (customer-owned worklogs, receipt, procedural replay) and fight Ruflo on its strongest terrain.

**Decision:** Close gaps by deepening Agentic SWE’s axis. Do not clone Ruflo.

---

## 2. Product thesis

**Agentic SWE wins software-engineering PRs.** Ruflo wins standing agent platforms.

Proof of “better for SWE” is not star count. It is:

1. `/work` → validated PR → `/receipt` with phase costs and a named human gate.
2. A second similar task hits **L0/L1 descent replay** instead of full frontier spend.
3. Multi-editor hosts remain first-class.
4. Security and review stay **file-backed and engine-enforced**, not chat theater.

---

## 3. Approaches considered

| Approach | Sequence | Trade-off |
|---|---|---|
| **A. Moat first (chosen)** | Muscle memory + receipt → bounded parallel review → security witness | Clearest competitive story; security polish waits |
| **B. Security first** | Security → moat → panel | Procurement narrative early; delays the daily demo |
| **C. Parallel spikes** | All three thin slices at once | Broad surface; high unfinished risk |

Chosen: **A**.

---

## 4. Explicit non-goals

- Swarm topologies (mesh / Raft / Byzantine / Gossip)
- Cross-machine agent federation or mTLS peer mesh
- Ruflo-style plugin marketplace or 300+ MCP tool surface
- Competing on GitHub stars or agent/tool marketing counts
- Co-install with Ruflo in one Claude Code repo without documenting hook/`CLAUDE.md` conflicts
- Hosted SaaS control plane (unchanged from positioning spec)

---

## 5. Phased roadmap

### Phase 1 — Sharpen the moat (implement first)

**Goal:** Make the receipt + replay path obviously better than a swarm harness for shipping PRs.

| Deliverable | Current state | Target |
|---|---|---|
| **Warm-path receipt** | `scripts/render-receipt.cjs` + fixtures exist | Completed `/work` items always yield a shareable receipt (phases, costs, gates, evidence paths). CI fixture asserts required fields. |
| **Descent default** | Engine already runs `implementation-descent` / `descent-try` | Keep L0/L1 first on implementation entry; escalate only on miss. Warm portfolio median tokens remain below cold baseline on existing bench scorecards. |
| **Muscle-memory doctor** | `scripts/lib/work-engine/muscle-memory-doctor.cjs` + unit test exist; not surfaced in `doctor` CLI | `agentic-swe doctor` reports ready / needs-warm for procedures, index, and prime. |
| **Honest competitive claims** | Comparison canvas exists; README does not claim Ruflo parity wrongly | Short docs note: win on pipeline + receipt + replay; do not claim “more agents than Ruflo.” |

**Phase 1 exit criteria**

- New user path documented: setup → `/work` → validation → PR → `/receipt`.
- Doctor surfaces muscle-memory readiness without requiring pack-checkout `npm run` tribal knowledge.
- At least one CI check locks receipt field presence on a golden fixture.
- No new vector DB, federation, or marketplace code lands in this phase.

### Phase 2 — Bounded parallel review

**Goal:** Stronger multi-agent review without a swarm runtime.

| Deliverable | Target |
|---|---|
| **Design panel artifacts** | Rigorous track merges architect / security / adversarial outputs into `design-panel-review.md` with dissent recorded before leaving `design-review`. |
| **Catalog routing in feasibility** | Top-k from `catalog-route` written into `feasibility.md` (file-backed, not chat-only). |
| **Non-goal enforcement** | Spec and CLAUDE.md state: single hypervisor session; no mesh/Raft/federation. |

**Phase 2 exit criteria**

- Rigorous-track fixture includes `design-panel-review.md`.
- Feasibility fixture includes routed specialist IDs from the catalog CLI.

### Phase 3 — Security that fits the product

**Goal:** Trust artifacts that match customer-owned state, not Ruflo’s install witness theater.

| Deliverable | Current state | Target |
|---|---|---|
| **Redaction receipt** | Memory lifecycle redacts secrets best-effort | Hook receipts (or doctor) surface redaction event counts. |
| **Permissions evidence** | `permissions-check` phase + skill exist on rigorous track | Engine refuses to skip `permissions-check` without a recorded waiver in state/audit. |
| **Pack verify (light)** | `doctor` already hashes install-state drift via `install-state` | Optional `doctor --verify-pack` (or equivalent) checks critical pack files (`state-machine.json`, schemas) against install manifest hashes — not Ed25519 marketplace witness. |

**Phase 3 exit criteria**

- CI fixture: rigorous track without permissions artifact cannot transition to validation without waiver.
- Doctor documents verify-pack / redaction status in `--json` output.

---

## 6. Success metrics

| Metric | Definition |
|---|---|
| **Primary** | End-to-end: `/work` → green validation → PR → `/receipt` with phase costs + named `approval-wait` resolver |
| **Secondary** | Second similar task resolves via L0/L1 replay (descent tier telemetry), not full L3 frontier |
| **Non-metric** | GitHub stars, MCP tool count, agent count marketing |

---

## 7. Relationship to existing roadmap

This gap-closure roadmap **does not replace** [`docs/roadmap.md`](../../roadmap.md). It is a competitive sequencing overlay:

- Phase 1 here hardens **already-shipped** Phase 2–3 roadmap capabilities (memory, descent, receipt).
- Phase 2 here is a thin slice of roadmap Phase 3 (catalog routing) plus design-panel productization.
- Phase 3 here is a thin slice of trust/governance, distinct from roadmap Phase 4 sandbox eval.

When both docs conflict on order, **this document wins for Ruflo-competitive work**; roadmap wins for protocol/CI harness expansion.

---

## 8. Implementation gate

1. This design is **approved** (2026-10-03).
2. Next: write an implementation plan for **Phase 1 only** under `docs/superpowers/plans/`.
3. Phases 2–3 get their own plans after Phase 1 exit criteria pass.

Do not start Phase 2 or 3 code until Phase 1 exit criteria are met or explicitly re-scoped.
