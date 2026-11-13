# ADR-012 — Memory writes redacted first; untrusted envelopes; privacy scopes

- **Status:** Accepted
- **Date:** 2026-11-13
- **Decider:** founder
- **Related:** ADR-001, ADR-004b, ADR-006, ADR-010, ADR-013, ADR-016; AE-R04; AE-R12;
  master prompt §9 M4.1–M4.2; RFC AE-010 §5.6; SEC-005; PD-39, PD-46, PD-47, PD-48

## Context

M4 needs governed engineering memory. On `origin/main`, redaction exists on major
write paths (AE-R12) and AE-R04 separates auto vs human procedure approval, but
there is no Accepted ADR, no six-type taxonomy, no retrieval envelope, and no
binding retention/visibility policy. RFC ADR-012 was a one-liner.

## Decision

**Taxonomy.** Memory records use six scopes: execution, repository, project,
skill, organizational, evaluation, plus `tenant_id`. Legacy session/personal/team
`work_id` values map into this taxonomy (AE-030a).

**Redact-on-write.** Every persist path redacts with the shared redaction
ruleset before storage. Records store redaction metadata (`applied`, ruleset id,
hit count). M4 redaction depth is **regex `redact.cjs` only** (no entropy/ML
scanner). Residual miss risk is accepted and labeled honestly.

**Untrusted envelope.** Retrieval and MCP prime/search return a typed
untrusted envelope. Recalled content is never treated as trusted instructions
(SEC-005). Privileged tool influence from memory requires explicit confirmation
policy elsewhere (ADR-006), not implicit trust.

**Provenance.** Each record carries origin, actor, optional source_uri,
source_hash, and ingested_at. Trusted learning requires evidence references;
unverified outcomes stay out of trusted sets (M4.2).

**AE-R04.** `auto_confirmed` and `human_approved` remain distinct fields.
Auto-confirm paths must not set `human_approved`. Human approval requires a
`user:` actor attestation.

**Retention (PD-47).** session 90d; execution procedures 180d; organizational 1y;
negative/failed evaluation results retained indefinitely. Enforcement via TTL
job + tombstones + delete API (AE-030d).

**Boundaries (PD-46).** Organizational/fleet memory is local and private by
default until M5/AE-036. Personal memory may be global with an explicit tenant
label. Private → public publication is human-gated; silent leak is forbidden.

**Layering.** Memory service code stays in `service` / `storage` per
`config/layers.json`; no forbidden edges.

## Consequences

- AE-030a..d and AE-031* implement schema, envelope, retention, and learning
  trust against this ADR.
- Eval history scope cooperates with ADR-013 isolation (no train contamination).
- Redaction is defense-in-depth, not a guarantee of zero secret leakage.
- Accepted 2026-11-13 as amended in `m4-adr-review.md` A1–A7 (PD-48; C3 =
  regex `redact.cjs` only).

## Alternatives

- Skip envelope and rely on redaction only: rejected (SEC-005).
- Treat auto_confirmed as human_approved: rejected (AE-R04).
- Publish org memory by default: rejected (PD-46).
- Entropy/ML scanner in M4: deferred (C3 = regex only).
