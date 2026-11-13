# Self-improvement proposal (AE-035)

**Mode:** `self-improvement` · **Track:** rigorous · **Draft PR only**

## Proposal

- **proposal_id:** `<id>`
- **baseline_ref:** `<commit SHA | scorecard path | manifest digest>`
- **scope:** `platform` | `skill` | `policy` | `other`
- **summary:** <one paragraph>

## Evidence

- Journal: append `improvement.proposed` then, after compare, `improvement.evaluated`.
- Receipts fold both events with `source_seq` (ADR-011).

## Governance (M4.6)

- No autonomous security-policy change (§15).
- No privilege escalation.
- No bypass of independent review.
- No self-authorized merge (FD-B).
- No deployment without release authorization.
- Tooling may open a **draft** PR only (AE-035b); merge/deploy stay human-gated.

## Evaluation checklist

- [ ] Compared against `baseline_ref`
- [ ] Regression scorecard recorded (`improvement.evaluated`)
- [ ] Independent review artifact present before any promote path
- [ ] Human authority preserved for merge/deploy/policy/release
