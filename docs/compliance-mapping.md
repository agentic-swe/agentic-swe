# Compliance mapping — NIST AI RMF · OWASP Agentic Top 10 · EU AI Act

> **Status:** Reference doc, not a compliance certification. Maps `.worklogs/` artifacts to published AI governance controls so your security / legal team can see what evidence agentic-swe already produces — and where it produces none.
>
> **Last verified:** 2026-10-21 against [NIST AI 100-1 (AI RMF 1.0) core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/), the [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) (published December 2025), and [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng). Items marked *3.4.0+* or *unreleased* need that pack version.

## NIST AI RMF 1.0

| Subcategory | Outcome (abridged from NIST AI 100-1) | What agentic-swe produces |
|-------------|----------------------------------------|---------------------------|
| GOVERN 2.1 | Roles, responsibilities and lines of communication are documented | `audit.log` — every transition records an `actor` (`hypervisor`, `developer`, `user`, …); agent role files under `agents/` |
| MAP 2.2 | How system output is used and overseen by humans is documented | `feasibility.md` (scope, ambiguity) and the track chosen in `lean-track-check.md` |
| MAP 3.5 | Processes for human oversight are defined and documented | Human gates in `state-machine.json` (`ambiguity-wait`, `approval-wait`) |
| MEASURE 2.8 | Transparency and accountability risks are examined and documented | `state.json.history[]` (from / to / reason / evidence_refs per transition); `/receipt` |
| MANAGE 1.3 | Responses to high-priority risks are planned and documented | `reflection-log.md` after a rejection; `escalate-*` states with a recorded reason |
| MANAGE 2.4 | Mechanisms exist to supersede, disengage or deactivate the system | Budget ceilings and loop counters that force escalation; no auto-merge |
| MANAGE 4.3 | Incidents and errors are tracked and documented | `pipeline-failed` / `escalate-*` artifacts (`validation-results.md`, `review-feedback.md`) |

## OWASP Top 10 for Agentic Applications (2026)

| Risk | Coverage | What agentic-swe does |
|------|----------|-----------------------|
| ASI01 Agent Goal Hijack | Partial | Explicit task in `state.json`; human gates; Context Pack trust levels and untrusted-content handling (`references/context-engineering.md`) |
| ASI02 Tool Misuse and Exploitation | Partial | `permissions-check` phase (rigorous); allowed tools per agent file; Policy-as-Code `banned_tools` (`schemas/agentic-swe-policy.schema.json`); cost ceilings |
| ASI03 Identity and Privilege Abuse | Limited | `audit.log` actor attribution only; credentials are whatever the host grants. Signed transitions are roadmap (v2) |
| ASI04 Agentic Supply Chain Vulnerabilities | Limited | `agentic-swe doctor --verify-pack` (*unreleased, on `main`*) lists SHA-256 hashes of critical pack files and flags missing ones; there is no signed manifest to compare against yet |
| ASI05 Unexpected Code Execution | Partial | Changes land as a PR behind `approval-wait`; acceptance gate runs `pipeline.acceptance_command` before PR creation (*3.4.0+*). Shell execution during work is governed by the host, not sandboxed by agentic-swe |
| ASI06 Memory and Context Poisoning | Partial | Memory is advisory; `state.json` and repo files win over recalled memory |
| ASI07 Insecure Inter-Agent Communication | Not addressed | Subagents run inside the host session; no message authentication |
| ASI08 Cascading Failures | Partial | Bounded loop counters (`state.json.counters`); same failure twice → escalate |
| ASI09 Human-Agent Trust Exploitation | Partial | Approvals rest on evidence artifacts (`templates/evidence-standard.md`) and `/receipt`, not on chat claims |
| ASI10 Rogue Agents | Partial | `work-engine` rejects transitions not in `state-machine.json`; every action is attributable in `audit.log` |

## EU AI Act (Regulation (EU) 2024/1689, as amended by Regulation (EU) 2026/1744)

**When it applies:** the high-risk requirements in Chapter III Sections 1–3 (including Articles 12, 14 and 15) apply from **2 December 2027** for Annex III high-risk systems and **2 August 2028** for Annex I systems (Regulation (EU) 2026/1744, in force 27 July 2026). A coding pipeline is usually not itself a high-risk AI system; this table shows evidence a team can reuse when its own process or product is in scope.

| Article | Requirement | Evidence |
|---------|-------------|----------|
| 12 (Record-keeping) | Automatic recording of events (logs) | `.worklogs/<id>/audit.log` (append-only) and `state.json.history[]` |
| 14 (Human oversight) | Effective oversight by natural persons | `ambiguity-wait` / `approval-wait` gates; user attribution in `audit.log`; no auto-merge |
| 15 (Accuracy, robustness and cybersecurity) | Appropriate accuracy, robustness and cybersecurity | Partial: `validation-results.md`; `verify-result.json` from the acceptance gate (*3.4.0+*); `/security-scan` and `permissions-check` on the rigorous track |

> Article 13 (transparency and information to deployers) and Article 50 (transparency obligations for certain AI systems, such as disclosing AI interaction and marking AI-generated content) are disclosure duties at your product or service surface — agentic-swe only produces evidence. General-purpose AI model obligations (Articles 53–55) apply to model providers, not to this pack.

## How to generate evidence for an audit

For a single work item:

```bash
node scripts/render-receipt.cjs --work-dir .worklogs/<id> --format=markdown --output receipt.md
```

For an audit of a time window across many work items, walk `.worklogs/` and run `/receipt` per directory. Each receipt is self-contained and includes the `audit.log` entry count, decision count, cost, and human-gate resolutions.

## What this doc is not

- Not a SOC 2 / ISO 27001 / HIPAA certification — those require an auditor.
- Not legal advice. Talk to counsel about your specific obligations.
- Not exhaustive — rows marked *Partial*, *Limited* or *Not addressed* are honest gaps, not roadmap promises.
