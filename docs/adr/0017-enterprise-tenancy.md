# ADR-017 — Enterprise tenancy: single controlled pilot tenant

- **Status:** Accepted
- **Date:** 2026-11-14
- **Decider:** founder
- **Related:** ADR-006, ADR-010, ADR-012, ADR-014, ADR-015, ADR-016; PD-46
  (revisited), PD-51..PD-62; decision ref **PD-62**

## Context

M4 left organizational memory **local and private by default** (PD-46). M5 must
let a controlled enterprise pilot use public AutoEng capabilities alongside
private organizational skills and knowledge without violating isolation or
governance. Opening share without a binding ADR invents tenancy in code.
Multi-org hosted memory, npm publish, paid LLMs, Temporal/Restate, and a
concrete SaaS connector are out of scope for this milestone.

## Decision

Accepted as amended in `m5-adr-review.md` **A1–A9**, with founder choices
**C1–C3** recorded in **PD-62**.

**Pilot tenancy (A1).** AutoEng M5 supports **one controlled pilot tenant** per
self-hosted install. Org/team memory may be shared **inside that tenant only**.
Cross-tenant access is denied fail-closed. **Private must not become public**
without an explicit governed authorization path. Multi-org hosted memory is a
non-goal.

**Tenant identity (A2 / C1).** The pilot install sets an explicit `tenant_id` as
a **human-written value in project config** (for example
`.agentic-swe/tenant.json` or equivalent). It is **not inferred** from caller
input, git remote, or org slug. Callers cannot self-assert a broader tenant.
Tests may create a second synthetic tenant with isolated store paths to prove
deny. Default without opt-in remains PD-46 local-private organizational
behavior (`visibility` private/local; organizational→public writes forbidden).

**Ownership (A3 / AE-036).** First-class resources: Organization, Team, Project,
User, Role (org RBAC), Workspace. Each has explicit ownership.
MemoryRecord.scope continues to use the six taxonomy scopes (`execution`,
`repository`, `project`, `skill`, `organizational`, `evaluation`).
Organizational/team share binds under the pilot `tenant_id`; personal `skill`
memory stays user-labeled and does not silently join org share. Legacy CLI
scope maps in `taxonomy.cjs` / `scopes.cjs` remain; share is gated by tenant
membership, not by legacy strings alone.

**Skill visibility (A4 / AE-037).** Skills carry visibility `public` |
`organization` | `team` | `private`. Search, list, and resolve enforce
visibility **server-side**. Private/org/team skills never appear in public
search. Revocation propagates to shared installs. Public catalog UX is M6.

**Org RBAC on the PDP (A5 / C2 / AE-039a / §15).** Org-scoped authorization uses
a disk-backed binding store evaluated inside the PDP, fail closed, with grants
never taken from caller-supplied input. Non-org work keeps today's path
(including the PD-49 self-improvement merge/deploy gate). **C2 (PD-62)
confirms** the exact §15 org-RBAC PDP diff in `m5-adr-review.md` as the PD-56
pre-approved change:

- **Do not edit** `config/default-policy.json` or agent `config/roles/*.json`.
- **Add** `schemas/org-rbac-binding.schema.json` and
  `scripts/lib/policy/org-rbac.cjs` (disk-backed bindings; empty/missing ⇒ deny
  for org-scoped ops).
- **`pdp.cjs`:** for org-scoped ops, deny with no matching binding; ignore
  caller grants for elevation; non-org work including the PD-49
  self-improvement gate is unchanged.

Unconfirmed text must not land; this confirmed text is the only authorized
§15 change set for AE-039a.

**Deployment modes (A6 / C3 / AE-041).** Threat models and operational
responsibilities are required for self-hosted, private runners, managed control
plane, and hybrid. Tests in this repository cover what can be proven with
fixtures and CI: self-hosted isolation, a private-runner-shaped allow-list
profile, and hybrid fail-closed against a stub remote. **Managed control plane
has no implementation here**; its isolation claims are documented limits, not
faked tests. **C3:** threat model + documented limit is enough for the partial
exit; do not block exit on a real managed plane, and do not fake one.

**Non-goals (A7).** Multi-org hosted memory; npm publish; paid LLMs (PD-9 /
PD-54); Temporal/Restate (PD-60); concrete SaaS connector AE-040b (PD-58); M6
website/catalog/launch.

**Migration (A8).** Enabling pilot share is an explicit opt-in. Existing
local-private data is not silently widened; enabling share does not rewrite
`private` to `public`.

**Durable executor (ADR-014 / PD-60).** Remain on the minimal durable executor.
No Temporal/Restate trigger from ADR-014 was met for M5; no external durable
engine is adopted.

**Residuals (A9 / PD-61).** AE-R1 (explicit `annotateTrust` source) and AE-R2
(shrink graph-store allowlist) are required M5 hygiene and do not block this
docs PR.

## Consequences

- AE-036..038 code may start only after this ADR is Accepted on `main` (this
  docs PR).
- AE-038a implements single-tenant share; AE-040b is skipped; AE-041 documents
  four modes with honest limits; AE-R1/R2 proceed as required hygiene.
- AE-039a may merge only against the C2-confirmed §15 diff (PD-62); no other
  policy baseline edit is authorized by this ADR.
- Partial M5 exit (isolation, governance, private skills/memory, synthetic
  pilot) remains the exit bar unless the founder later raises it.
- Accepted 2026-11-14 as amended in `m5-adr-review.md` A1–A9 (PD-62; C1 =
  human-written `tenant_id`; C2 = §15 diff confirmed; C3 = managed limit OK).

## Alternatives

- Keep PD-46 local-private with ownership APIs only (rejected for M5 by PD-53).
- Multi-org hosted memory (rejected by PD-53).
- Infer `tenant_id` from git remote / org slug (rejected by C1).
- Block M5 exit until a real managed plane exists (rejected by C3).
- Adopt Temporal/Restate now (rejected by PD-60; no trigger met).
