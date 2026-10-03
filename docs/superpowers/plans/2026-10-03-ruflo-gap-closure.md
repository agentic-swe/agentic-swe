# Ruflo Gap Closure Phases 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Ruflo gap-closure design: moat (doctor + receipt + docs), bounded parallel review (panel + catalog routing artifacts), and product-fit security (redaction counts, permissions waiver, pack verify).

**Architecture:** Extend existing Node CLIs (`doctor`, work-engine artifacts/transitions, hook receipts) and markdown phase skills. No new swarm/federation/vector stack.

**Tech Stack:** Node.js CommonJS, `node:test`, existing `scripts/lib/*` modules.

## Global Constraints

- Do not add Ruflo-style swarm, federation, marketplace, or HNSW runtime.
- Customer-owned `.worklogs/` and advisory memory remain authoritative patterns.
- Prefer wiring existing modules (`muscle-memory-doctor`, `catalog-route`, `redactSecrets`, install-state hashes) over greenfield.
- Phase 1–3 from `docs/superpowers/specs/2026-10-03-ruflo-gap-closure-design.md` ship together per product owner request.

## File map

| File | Responsibility |
|---|---|
| `scripts/doctor.cjs` | Muscle-memory readiness, redaction summary, `--verify-pack` |
| `scripts/lib/work-engine/artifacts.cjs` | Rigorous `design-panel-review.md`; permissions waiver path |
| `scripts/lib/work-engine/permissions-gate.cjs` | New: validation entry requires permissions-check or waiver on rigorous |
| `scripts/lib/hooks/hook-receipt.cjs` | Aggregate `redaction_hits` helpers |
| `scripts/lib/hooks/lifecycle.cjs` / session paths | Pass redaction hits into receipts when available |
| `scripts/lib/feasibility/catalog-signals.cjs` | New: format catalog-route hits for feasibility.md |
| `scripts/feasibility-catalog-route.cjs` | CLI to append Catalog Routing section |
| `phases/design.md`, `phases/feasibility.md`, `phases/design-review.md` | Require panel + routing sections |
| `docs/competitive-vs-ruflo.md` | Honest competitive note |
| `test/*` | Coverage for doctor, artifacts, permissions gate, receipt fields, fixtures |

---

### Task 1: Doctor muscle-memory + verify-pack + redaction

**Files:**
- Modify: `scripts/doctor.cjs`
- Modify: `scripts/lib/hooks/hook-receipt.cjs`
- Test: `test/doctor-gap-closure.test.js`

- [ ] Wire `checkMuscleMemoryReadiness` into `inspect()` as advisory checks + `muscle_memory` JSON field
- [ ] Add `--verify-pack` to hash `state-machine.json`, `schemas/`, `CLAUDE.md` vs pack root
- [ ] Add `summarizeRedactionHits(projectRoot)` reading hook-receipts.jsonl; expose in doctor JSON
- [ ] Tests for muscle_memory presence and verify-pack ok/fail

### Task 2: Receipt required-fields CI lock

**Files:**
- Modify: `scripts/lib/receipt/extract.cjs` or add `assertReceiptShape`
- Test: `test/receipt-required-fields.test.js`

- [ ] Assert golden lean fixture yields workId, track, status, costUsd, decisions[], humanGates[], prUrl

### Task 3: Competitive docs

**Files:**
- Create: `docs/competitive-vs-ruflo.md`
- Modify: `README.md` (one link under Extending/Architecture)
- Modify: `CHANGELOG.md` Unreleased

### Task 4: Design panel artifact enforcement

**Files:**
- Modify: `scripts/lib/work-engine/artifacts.cjs`
- Modify: `phases/design.md`, `phases/design-review.md`
- Test: `test/artifacts-rigorous-panel.test.js`
- Fixture: `test/fixtures/artifacts/rigorous-design/`

- [ ] When `pipeline.track === 'rigorous'` and leaving `design`, require `design-panel-review.md`
- [ ] Document in phase skills

### Task 5: Catalog routing into feasibility

**Files:**
- Create: `scripts/lib/feasibility/catalog-signals.cjs`
- Create: `scripts/feasibility-catalog-route.cjs`
- Modify: `phases/feasibility.md`, `skills/feasibility/SKILL.md`
- Test: `test/feasibility-catalog-route.test.js`

- [ ] CLI writes `## Catalog Routing` with top-k ids into feasibility.md (or stdout markdown)
- [ ] Phase requires the section when catalog-route is available

### Task 6: Permissions waiver gate

**Files:**
- Create: `scripts/lib/work-engine/permissions-gate.cjs`
- Modify: `scripts/lib/work-engine/engine.cjs` `validateTransition`
- Test: `test/permissions-gate.test.js`

- [ ] Rigorous track: `to === 'validation'` requires `from === 'permissions-check'` OR `state.pipeline.permissions_waiver` with `{ actor, reason, at }`
- [ ] Leaving `permissions-check` without `permissions-changes.md` allowed only with waiver (artifact OR waiver)

### Task 7: Redaction in hook receipts

**Files:**
- Modify session-capture / lifecycle to store `redaction_hits` on receipt `steps`
- Test via doctor summarize

### Task 8: Verify + PR

- [ ] `npm test` (or targeted suites) green
- [ ] Branch, commit, `gh pr create`
