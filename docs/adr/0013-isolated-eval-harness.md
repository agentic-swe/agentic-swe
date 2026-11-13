# ADR-013 — Isolated evaluation harness

- **Status:** Accepted
- **Date:** 2026-11-13
- **Decider:** founder
- **Related:** ADR-001, ADR-008, ADR-009, ADR-011, ADR-012, ADR-016; AE-R09;
  master prompt §9 M4.5; RFC AE-010 §5.9; PD-9, PD-39, PD-41, PD-42, PD-43, PD-47, PD-48

## Context

Independent learning evaluation requires train/eval separation and honest
scoring. On `origin/main` the bench skeleton and AE-R09 honesty fixes exist, but
“holdout” in descent is often an in-corpus prefix split, agent-in-the-loop
holdout is not shipped, and ADR-013 has no file. Founder decisions PD-41..43
fix spend, exit bar, and wipe policy for M4.

## Decision

**Isolation.** The evaluation harness does not read or write the learner’s
durable memory/procedure stores during cold scored runs. Write guards prevent
holdout labels and hidden oracles from entering training/learning pipelines
(pairs with AE-031c).

**Wipe (PD-43).** Each scored holdout run starts from wiped learned procedures
and wiped/fresh memory in the eval worktree. Repo-native held-out tasks are the
M4 holdout source.

**Cold-only for E8-cited runs (C4).** Any eval run cited toward exit metric E8
MUST be cold: procedures and memory wiped before the run. Warm arms (for
example fed only from the **dev** pool under a recorded profile) are allowed
only as separately labeled diagnostics and MUST NOT be sole or primary E8
proof.

**Manifests.** Suites are frozen eval manifests (content digest / pinned SHAs)
with pools `dev` | `public` | `private`. No `default_score` free floor in
manifests used for claims (AE-R09).

**Hidden scoring.** Score oracles used for pass/fail of the held-out claim are
hidden from the agent. Reproducible result records include manifest digest,
commit, runner, and provenance.

**Negatives.** Failed and negative eval results are retained (PD-47).

**Spend (PD-9 / PD-41).** Paid LLM providers stay denied. Local Ollama/llama.cpp
observed runs at $0 are allowed and must be labeled `observed`; they are never
sole E8 proof. CI defaults to fixtures.

**Claims (PD-42).** Exit reporting may be partial: platform, governance,
privacy, reproducibility, and harness completeness can pass while task-capability
improvement is reported with explicit limitations.

**Layering.** Harness code under `bench` / `scripts/lib/bench` (`service`) must
not create forbidden layer edges or import learning writers except through
explicit wipe/isolation APIs.

## Consequences

- AE-034a..c implement manifests, wipe, runner, and honesty report.
- AE-034d remains skipped while PD-9 stands.
- Skill golden-eval / routing benches stay offline gates; they do not substitute
  for ADR-013 holdout claims.
- Accepted 2026-11-13 as amended in `m4-adr-review.md` A1–A7 (PD-48; C4 =
  cold-only for E8-cited runs).

## Alternatives

- Warm-only eval without wipe: rejected for scored cold runs (PD-43).
- Warm-from-dev in scored E8 compare: rejected (C4); warm diagnostics OK if labeled.
- Paid pilot as required E8: rejected while PD-9 stands (PD-41).
- In-corpus prefix “holdout” as independent eval: rejected for M4.5 claims.
