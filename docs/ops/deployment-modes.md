# Deployment modes — threat models and ops responsibilities (AE-041a)

**Authority:** ADR-017 A6 / C3 (PD-62), PD-59.  
**Scope:** Four modes — self-hosted, private runners, managed, hybrid.  
**Honesty rule:** Docs state which claims are **tested in this repository** and which remain **documented limits**. Do not invent a managed control plane.

---

## Mode summary

| Mode | Ops owner | Tested in-repo | Documented limits (not faked) |
|---|---|---|---|
| **self-hosted** | Install operator | Tenant store path isolation; cross-tenant path non-collision | OS-user/ACL hardening; physical host compromise |
| **private runners** | Runner operator + install operator | Env allow-list filter; network host allow-list (deny-by-default) | CI vendor isolation; ephemeral VM/container boundaries |
| **managed** | Vendor (not available here) | *None* — no managed plane in this pack | Multi-tenant hosted isolation; central credential custody; remote policy push / fleet attestation |
| **hybrid** | Install operator + optional remote operator | Fail closed when remote stub absent / unreachable / denies | Production remote SLOs; mutual auth to a real managed plane |

Code catalog: `scripts/lib/deployment/modes.cjs` (`modeCatalog()`).  
Tests: `test/deployment-modes.test.js`.

---

## 1. Self-hosted

### Threat model

| Threat | Mitigation in pack | Residual |
|---|---|---|
| Cross-tenant memory/path read | `org-store` `tenantDir` isolation; deny path traversal in tenant ids | Host operator misconfigures shared disks |
| Agent rewrites local policy/journal | Cooperative in-host (ADR-001); optional separate OS user (`docs/hosted-mode.md`) | Not OS-enforced by default |
| Credential leak via connectors | AE-040a vault seam; no caller-supplied secrets | Operator-placed secrets outside vault |

### Ops responsibilities

- Write `tenant_id` in `.agentic-swe/tenant.json` (human-written; ADR-017 C1).
- Keep store roots on operator-controlled volumes.
- Do not share one store root across distinct pilot tenants without path isolation.

### Tested vs limit

- **Tested:** `AE-041a: self-hosted tenant path isolation`.
- **Limit:** Full OS sandbox / separate-user journal ownership (see hosted-mode doc).

---

## 2. Private runners

### Threat model

| Threat | Mitigation in pack | Residual |
|---|---|---|
| Exfil via arbitrary env | Private-runner-shaped env allow-list (`PRIVATE_RUNNER_PROFILE`) | Runner image still trusted by operator |
| Exfil via arbitrary network | Network allow-list; deny-by-default | CI vendor side-channels |
| Shell injection | `shell: false` in profile shape | Runner OS compromise |

### Ops responsibilities

- Pin runner images; rotate runner tokens outside the repo.
- Keep allow-listed hosts minimal (`registry.npmjs.org`, `github.com` in the fixture profile).
- Never bake long-lived cloud credentials into the runner env allow-list.

### Tested vs limit

- **Tested:** `AE-041a: private-runner env allow-list`; `AE-041a: private-runner network allow-list`.
- **Limit:** GitHub Actions / Buildkite / k8s job isolation itself.

---

## 3. Managed (control plane)

### Threat model (design only)

| Threat | Would require | Status in this repo |
|---|---|---|
| Cross-customer data bleed | Vendor tenancy + attestation | **Not implemented** |
| Central secret custody abuse | HSM/KMS + audited break-glass | **Not implemented** |
| Malicious policy push | Signed remote policy + local pin | **Not implemented** |

### Ops responsibilities

- None inside this pack — there is no managed control plane to operate.
- PD-62 **C3:** threat model + documented limit is enough for the partial M5 exit; do **not** block exit on a real managed plane, and do **not** fake one in tests.

### Tested vs limit

- **Tested:** *nothing that claims managed isolation exists.*
- **Documented limit:** `managedControlPlaneStatus()` returns `MANAGED_PLANE_NOT_IMPLEMENTED`.
- **Test:** `AE-041a: managed mode is documented limit only (no fake plane)`.

---

## 4. Hybrid

### Threat model

| Threat | Mitigation in pack | Residual |
|---|---|---|
| Silent degrade to open remote | Fail closed when remote absent/unreachable/denies | Operator sets `require_remote: false` deliberately |
| Stub remote treated as production | Stub used only in tests; docs forbid inventing a plane | Confusion with future real remotes |

### Ops responsibilities

- Treat hybrid as self-hosted plus an **optional** remote.
- If remote is required for a pilot, fail closed on outage (do not open cross-tenant share).

### Tested vs limit

- **Tested:** `AE-041a: hybrid fail-closed against stub remote`.
- **Limit:** Real managed remote availability, mTLS, and fleet policy sync.

---

## Related

- ADR-017 (enterprise tenancy / deployment modes A6)
- ADR-014 (minimal durable executor; PD-60 — no Temporal/Restate)
- AE-040a connector framework (fixture-only; PD-58)
- `docs/hosted-mode.md` (separate OS user sketch)
