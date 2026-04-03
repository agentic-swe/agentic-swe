# Spec Self-Review Checklist

Run this checklist against the design artifact before presenting it. Every item must pass.

## Completeness

- [ ] No placeholder text ("TBD", "TODO", "fill in later", "details to follow")
- [ ] All sections internally consistent (no contradictions between approach, constraints, and file plan)
- [ ] Scope matches the original task — no scope creep, no missing requirements
- [ ] Ambiguities explicitly identified and called out, not hidden or glossed over

## Design Discipline

- [ ] YAGNI applied — no speculative features, no "might need later" additions
- [ ] Data flow described end-to-end (inputs → processing → outputs)
- [ ] Error handling addressed — not just the happy path
- [ ] Edge cases enumerated for critical paths

## Dependencies and Integration

- [ ] External dependencies identified (services, libraries, APIs, config)
- [ ] Version or compatibility constraints noted where relevant
- [ ] Migration or rollback path documented if modifying existing behavior
- [ ] Breaking changes flagged with mitigation strategy

## Validation Readiness

- [ ] Testing strategy outlined — what to test, how, at which layer
- [ ] Acceptance criteria are concrete and verifiable (not subjective)
- [ ] Performance or resource implications noted if non-trivial

## Final Check

- [ ] A reviewer unfamiliar with the task can understand the design from the artifact alone
- [ ] The design is the simplest approach that fully satisfies the requirements
