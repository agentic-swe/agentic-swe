# Compliance mapping — NIST AI RMF · OWASP Agentic Top 10 · EU AI Act

> **Status:** Reference doc, not a compliance certification. Maps `.worklogs/` artifacts to common AI governance controls so your security / legal team can see what evidence agentic-swe already produces.

## NIST AI RMF 1.0

| Function | Control reference | What agentic-swe produces |
|----------|-------------------|---------------------------|
| Govern (1.5) | Roles and responsibilities defined | `audit.log` — every transition has an `actor` field (`hypervisor`, `developer`, `panel-architect`, `user`, etc.) |
| Map (2.1) | Context categorized | `feasibility.md` — task scope, complexity, ambiguity rating |
| Map (2.2) | Risk identified | `design-panel-review.md` (rigorous) or `design.md` risks section |
| Measure (3.3) | Tracking of AI system characteristics | `state.json.budget` — cost_used, token usage, iteration counts |
| Measure (3.4) | Feedback from end-users | `audit.log` — every human-gate resolution recorded |
| Measure (3.7) | Documentation of decisions | `state.json.history[]` — from/to/reason/evidence_refs per transition |
| Manage (4.1) | Risks prioritized and acted on | `reflection-log.md` (when rejected); `escalate-*` states with documented escalation reason |

## OWASP Agentic Top 10 (December 2025)

| Risk | Mitigation in agentic-swe |
|------|----------------------------|
| AAI-1 Goal hijacking | Human gates (`ambiguity-wait`, `approval-wait`); explicit task field in `state.json` |
| AAI-2 Tool misuse | `permissions-check` phase (rigorous); allowed-tools list per agent file |
| AAI-3 Identity abuse | `audit.log` actor attribution; signed transitions (v2 — see roadmap) |
| AAI-4 Insecure output | Cross-model panel review (`agents/panel/cross-model-reviewer.md`) on rigorous track |
| AAI-5 Prompt injection | Context Pack with trust levels; untrusted-content quarantine (`references/context-engineering.md`) |
| AAI-6 Tool override | Policy-as-Code banned-tools list (`schemas/agentic-swe-policy.schema.json`). *Unreleased (ASI02 Tool Misuse, Partial):* a blocking `PreToolUse` hook (`scripts/hook-pre-tool-policy.cjs`) enforces `banned_tools`, `banned_commands` and `phase_tool_allowlist` per work-item state and logs every tool call with its decision to `audit.log` (`test/hook-pre-tool-policy.test.js`, `test/policy-runtime.test.js`). Gaps: Claude Code hosts only; shell matching is textual; hook errors fail open unless `AGENTIC_SWE_POLICY_FAIL_CLOSED=1` |
| AAI-7 Unauthorized actions | Human gate at PR creation; no auto-merge |
| AAI-8 Loop / runaway | Bounded loop counters (`state.json.counters.*`); escalation states |
| AAI-9 Resource exhaustion | Budget tracking with hard ceilings (`budget.cost_budget_usd`, `budget.iteration_budget`) |
| AAI-10 Audit trail loss | `.worklogs/<id>/` committed in repo; replayable snapshots (`scripts/lib/replay/`) |

## EU AI Act (high-risk AI systems, effective August 2026)

| Article | Requirement | Evidence |
|---------|-------------|----------|
| 14 (Human oversight) | Effective oversight by natural persons | `approval-wait` state, `audit.log` user attribution |
| 15 (Accuracy / robustness / cybersecurity) | Logging of operation | `state.json.history`, `audit.log`, cost ledger |
| 12 (Record-keeping) | Automatic logs of system events | `.worklogs/<id>/` per work item — append-only `audit.log` |

> EU AI Act Article 13 (transparency) and Article 50 (general-purpose AI obligations) require *disclosure* — agentic-swe's role is to produce the evidence; the disclosure happens at your product / service surface.

## How to generate evidence for an audit

For a single work item:

```bash
node scripts/render-receipt.cjs --work-dir .worklogs/<id> --format=markdown --output receipt.md
```

For an audit of a time window across many work items, walk `.worklogs/` and run `/receipt` per directory. Each receipt is self-contained and includes the `audit.log` entry count, decision count, cost, and human-gate resolutions.

## What this doc is not

- Not a SOC 2 / ISO 27001 / HIPAA certification — those require an auditor.
- Not legal advice. Talk to counsel about your specific obligations.
- Not exhaustive — the agentic-swe project will keep expanding this map as standards evolve.
