# Positioning + `/receipt` — Design Spec

**Status:** Active strategy · originally Draft (2026-05-17) · **factual refresh 2026-10-21**  
**Authors:** Suraj Gupta, design panel synthesis (adversarial, architect, competitive, content, DX subagents)  
**Related:** [`docs/the-north-star.md`](../the-north-star.md), [`docs/roadmap.md`](../roadmap.md), [`docs/capabilities-overview.md`](../capabilities-overview.md), [`docs/specs/owai-1.0.md`](./owai-1.0.md), living launch seed [`docs/launch-week-1.md`](../launch-week-1.md), control map [`docs/compliance-mapping.md`](../compliance-mapping.md)

> **Refresh note (2026-10-21, verified against `origin/main` 3.4.0):** Phase 0 silent failures below are **historical diagnosis** — all three are resolved (see §5). Live social checklist + metrics live in `docs/launch-week-1.md`. The EU AI Act high-risk dates moved (Regulation (EU) 2026/1744): any “regulatory deadline” framing below now means **2 December 2027** (Annex III) / **2 August 2028** (Annex I), not August 2026.

---

## 1. Problem statement

`agentic-swe` is technically further along than its market awareness suggests. Shipped today: a state-machine pipeline with 3 tracks, **138+** subagents, Doubt-Driven Verification, cross-model panel, Policy-as-Code, replayable worklogs, OWAI spec, AGENTIC_SWE_BENCH (3 seeded `bench/tasks/` + large corpus), Context Packs, per-phase cost attribution, and deterministic `/receipt`. Traction remains thin relative to capability (stars/npm still low — see §6 refresh). The closest analog with **no pipeline** — `wshobson/agents` — earned large GitHub stars by curating subagents alone.

A 5-axis review (adversarial, architectural, competitive, content/marketing, DX) originally (2026-05-17) converged on three findings:

1. **~~Three silent failures~~ (resolved — see §5):** (a) `SessionStart` matcher dropping Hypervisor policy on resume, (b) `/check artifacts` destination-state inversion, (c) empty `bench/tasks/`.
2. **The marketing surface risks selling architecture, not outcomes.** "Hypervisor policy · Pure markdown · No cloud runtime" speaks to platform engineers. The Claude Code audience wants `/work add retry logic` → reviewable PR → merge → `/receipt`. Keep the README outcome-first.
3. **A real wedge is in the codebase.** `state.json.history[]` + `audit.log` + `budget.cost_ledger` compose a cost-attributed, per-decision audit trail for AI coding work in the user's own repo. Hosted competitors cannot match customer-owned evidence without surrendering state.

The market still moves toward this wedge: EU AI Act record-keeping (Art. 12) and human-oversight (Art. 14) obligations for high-risk systems (from 2 December 2027 under Regulation (EU) 2026/1744), NIST AI RMF, and the OWASP Top 10 for Agentic Applications (2026). Agentic-swe already generates the artifacts; launch work makes them screenshot-able.

## 2. Strategic thesis (A+B sequenced)

**Primary position (A — The Receipt):**
> "Every AI coding decision, audited. The autonomous SWE pipeline that survives an AI Act review."

*Internal positioning only (2026-10-21):* do not use “survives an AI Act review” in public copy — it reads as a legal claim the pack cannot make. Public copy says what the pack produces (logs, oversight gates, receipts); see `docs/launch-week-1.md`.

**Acquisition channel (B — Magic-PR demo):**
> "Claude codes your PRs. You review and merge. With evidence."

A is the moat (defensible against hosted SaaS competitors, ties to a regulatory deadline). B is the daily-developer hook that gets engineers to install and try it. Devs find the project on Twitter through B, stay for A. C (OWAI as an open standard) is the year-2 protocol moat — out of scope here.

### ICP (in priority order)

| Tier | Persona | Pain | Channel |
|------|---------|------|---------|
| **P0** | Eng lead at a 30-200 person company on Claude Code; reports to a CTO who's nervous about AI | "Legal asked me how we'd audit AI-generated code; I have no answer" | LinkedIn long-form, founder DMs, the Receipt artifact itself |
| **P1** | Solo dev / indie hacker using Claude Code daily | Context-switch burnout; doesn't trust unattended Claude to ship full features | Twitter/X demo videos, dev.to / Hacker News, build-in-public weekly cadence |
| **P2** | Platform / DevEx team at a regulated-industry company (fintech, healthcare, EU) | Procurement is asking for AI governance evidence by Q3 2026 | NIST/OWASP control mapping doc, conference talks, design partners |

### What this thesis explicitly is not

- Not a hosted SaaS. The customer-owned `.worklogs/` is the moat. Adding a cloud runtime kills the differentiation.
- Not "compete with Cursor on autocomplete." Cursor wins the editor surface; we win the lifecycle layer above it.
- Not "compete with Devin on autonomy theater." Devin wins the closed-loop "fire and forget" pitch; we win the "fire, audit, approve" pitch.
- Not a sales-led enterprise motion in 2026. Free, OSS, repo-native. Enterprise comes after the bottom-up dev adoption from B.

## 3. Deliverables

### 3.1 `/receipt` command (the killer artifact)

A new pack command that renders a completed work item as a shareable markdown summary suitable for dropping into a PR description, Slack message, or compliance ticket.

**Command surface**
```
/receipt                  # newest non-completed work item, or most recent completed if none
/receipt <work-id>        # specific work item
/receipt <work-id> --format=html|markdown|json
```

**Inputs (read-only, no new state):**
- `.worklogs/<id>/state.json` (history, budget, pipeline, counters)
- `.worklogs/<id>/audit.log` (delegation trail)
- `.worklogs/<id>/*.md` (phase artifacts — used for evidence citation)
- `references/cross-model-escalation.md`, etc. — for any external review records

**Output (markdown, the default)**

```
# /work add retry logic to the API client

| Field | Value |
|---|---|
| Work ID | add-retry-logic |
| Track | standard |
| Status | completed |
| Duration | 47 min |
| Cost | $1.84 (Claude Sonnet + 1 Codex review) |
| PR | https://github.com/.../pull/142 |

## Decisions made (5)

1. **Feasibility** (3 min, $0.08) — Determined task is **standard** complexity (touched 4 files,
   no schema change). Subagent signals: `node`, `http`. → `feasibility.md`
2. **Design** (12 min, $0.41) — Chose exponential backoff with jitter (3 retries, 5xx only).
   Considered: linear backoff (rejected: thundering herd risk). → `design.md`
3. **Implementation** (18 min, $0.92) — Modified `src/api/client.js` + added
   `src/api/retry.js`. Per-file diff: +84/-12 lines. → `implementation.md`
4. **Validation** (8 min, $0.21) — 12 new tests, all green. Lint passed. Coverage +3.2%.
   → `validation-results.md`
5. **Cross-model review** (4 min, $0.18 → Codex) — Codex confirmed retry policy is correct
   and flagged one minor concern (no upper-bound on jitter), incorporated. → `cross-model-review.md`

## Human gates respected (1)
- `approval-wait` resolved by suraj@example at 2026-05-17T14:32Z (PR approved)

## Loop counters
- `self_review_iter`: 0 (no rework)
- `doubt_cycles`: 1 (DDV invoked at design-review, no actionable findings)
- `code_review_iter`: 0 (no rework)

## Verifiable references
- All artifacts: `.worklogs/add-retry-logic/`
- Audit log: `.worklogs/add-retry-logic/audit.log` (12 entries)
- Reproducible? `node scripts/replay.cjs add-retry-logic` ✓
```

**Implementation notes**
- One new file: `commands/receipt.md` (the slash command prompt).
- One new script: `scripts/render-receipt.cjs` (pure read-only over `.worklogs/<id>/`).
- One test: `test/render-receipt.test.js` (fixture-based, no LLM required).
- Existing data sufficient — no schema change to `state.json` required for v1.
- Future enhancement (out of scope for v1): cryptographic hash of the receipt + signed attestation. Adds the "tamper-evident" claim to the marketing copy. Bookmark as v2.

### 3.2 README rewrite (the front door)

Replace the current README headline + first viewport. The current opening sells architecture; the new opening must sell outcome + show, not tell.

**New headline** (12 words):
> "Claude codes your PRs. You review the receipt. Then merge."

**Sub-headline** (one sentence):
> "An open-source autonomous SWE pipeline that runs in your editor or CI, writes every decision into your repo, and gives you a shareable audit trail of what the AI did and why."

**First viewport order:**
1. Headline + sub-headline (above)
2. Animated demo (terminal recording, ~30 seconds): `/work add retry logic` → state bar updates → PR link → `/receipt` output rendered
3. Single install command block (one path, no toggle): `claude --plugin-dir "$(npx -y @agentic-swe/agentic-swe path)"`
4. Three-line "What it gives you" bullets: structured PRs · cost-attributed decisions · audit trail
5. "Compliance-grade" callout box linking to the NIST/OWASP mapping page (Section 3.3)
6. Then everything that's currently in the README (state machine, tracks, subagents) moves below the fold

Move "Hypervisor policy" terminology out of the user-facing README; keep it only in `CLAUDE.md` (where it's a name for the operating loop, not a marketing claim). Plain English in marketing surfaces; pack-specific vocabulary stays in the pack files.

**Constraints:**
- No new dependencies for the demo recording (use asciinema; check in the `.cast` file + a fallback GIF in `docs/assets/`).
- README total length: ≤ 200 lines for the scannable front page (everything else stays in `docs/`).
- The first command in the README must work copy-paste with one tool installed (Claude Code). Anything that requires npm scope creation or two-step plugin marketplace add goes into the Advanced section.

### 3.3 NIST/OWASP control-mapping doc

A one-page reference doc that maps `.worklogs/` artifacts to common AI governance controls. This is **not a compliance certification** — it's a screenshot for the eng lead to send to their compliance partner.

- New file: `docs/compliance-mapping.md`
- Covers: NIST AI RMF (Govern/Map/Measure/Manage), OWASP Top 10 for Agentic Applications (2026, `ASI01–ASI10`), and EU AI Act Articles 12 (record-keeping), 14 (human oversight) and 15 (accuracy/robustness/cybersecurity). *2026-10-21:* the shipped page used invented OWASP IDs and non-existent NIST subcategories; it was rewritten against the official sources.
- For each control: which artifact in `.worklogs/` provides evidence, and a one-line citation.
- Wired into the site as a top-nav item.

### 3.4 Three pre-positioning bug fixes (in flight in parallel)

The marketing work above presupposes the product works on first install. The three critical bugs identified by the adversarial review are being fixed by parallel developer-agents as this spec is finalized — see Section 5 for status. **No marketing motion ships until these three fixes are merged.**

## 4. Marketing motions (sequencing, weeks 1-6)

| Week | Motion | Asset | Goal |
|------|--------|-------|------|
| 1 | Land the three bug fixes; ship `/receipt` v1 behind a flag | PR merged | unblock everything |
| 1 | Record asciinema cast of `/work` → `/receipt` end-to-end | `docs/assets/receipt-demo.cast` | embed in README |
| 1 | README rewrite | PR merged | first-viewport rehab |
| 2 | LinkedIn long-form post: "Every AI coding decision, in your repo, with a receipt" (original competitor-comparison headline retired 2026-10-21) | Post + screenshot of `/receipt` | seed P0 ICP |
| 2 | Twitter/X thread: "Show your AI's work. 1 command. Watch." | 6-tweet thread + Loom | seed P1 ICP |
| 3 | dev.to / Medium post: "Ship a feature with Claude in 15 min, with a receipt" | Long-form article | SEO + inbound |
| 3 | Cold DM 10 Claude Code power users (offer 30-min walkthrough) | DM thread → call | discovery + design partners |
| 4 | Publish NIST/OWASP control-mapping page | `docs/compliance-mapping.md` | unlock P2 ICP |
| 4 | Show HN: "Show HN: agentic-swe — autonomous coding agent with a portable audit trail" — written and submitted by hand (HN bans generated text and automated posting) | HN post | distribution event |
| 5 | Conference / meetup submission (AI Engineer Summit, KubeCon governance track) | CFP | credibility |
| 6 | First case study (real or synthetic from a design partner) | docs/case-study/ | social proof |

## 5. Status of Phase 0 bug fixes (updated 2026-10-21)

| Bug | Original status (2026-05-17) | Current status |
|-----|------------------------------|----------------|
| **1** SessionStart missing `resume` | Resolved at spec time | Still resolved — matcher `startup\|resume\|clear\|compact` (CHANGELOG / PR #62) |
| **2** Artifact enforcement keyed on destination | In flight | **Resolved** — `requiredArtifactGroups(from, …)` in `scripts/lib/work-engine/artifacts.cjs` checks source-state outputs |
| **3** Empty `bench/tasks/` | In flight | **Resolved** — `01-off-by-one`, `02-add-retry`, `03-rate-limiter` + large `bench/corpus/` |

Remaining launch blockers are **assets/distribution**, not these bugs: missing `docs/assets/receipt-demo.cast`; README does not link `docs/compliance-mapping.md` (rewritten 2026-10-21, needs owner review first); npm registry at **3.3.0** while `main` is **3.4.0**, and the `v3.4.0` GitHub release notes still describe the 3.3.1 installer.

## 6. Success metrics (90 days)

| Metric | Baseline (2026-05-17) | Verified (2026-10-21) | 90-day target | Source of truth |
|--------|----------------------|------------------------|---------------|------------------|
| GitHub stars | 1 | **6** | 500 | github.com API |
| LinkedIn company followers | 39 | re-check manually | 1,000 | LinkedIn analytics |
| npm weekly downloads | 55 | **1** (12–18 Oct; 12 over the prior 30 days) | 1,500 | npm downloads API |
| `/receipt` mentions (Twitter/blog) | 0 | 0 (assume) | 25 | manual + search |
| Design partners (NIST/OWASP-mapping use case) | 0 | 0 | 3 | self-reported |
| AGENTIC_SWE_BENCH submissions from third parties | 0 | 0 | 1 | PR count |

Star count remains the honest acquisition signal. Growth since May is modest (1→6 stars) while weekly npm downloads fell vs the May snapshot — consistent with weak distribution (npm has also lagged two releases behind `main`), not a missing core feature. Living table: `docs/launch-week-1.md`.

Lagging indicator: a non-author cites `agentic-swe` in a blog post about AI governance or autonomous coding hygiene without prompting. Aim: at least 2 unprompted citations by day 90.

## 7. Out of scope

- Hosted SaaS or cloud runtime (would destroy the moat in Section 2)
- OWAI standards body application (year 2)
- Cryptographic attestation / signed receipts (v2 of `/receipt`)
- New subagent catalog work (catalog is already 138+; growth is not the bottleneck)
- VS Code or JetBrains extension (post-90-day, post-traction)
- New track types (lean/standard/rigorous is enough)
- IDE marketplace listings beyond Claude Code (after Claude Code traction is established)

## 8. Open questions

1. **Receipt artifact format for v1** — markdown is the default, but should we also commit a JSON sidecar so the receipt is machine-parsable (and the OWAI conformance suite could validate it)?
2. **Demo recording tool** — asciinema (terminal-only) vs. Loom (with cursor + voice). Both, or just one for v1?
3. **README installation simplification** — can we get to a true single-command install without the npm scope dance? E.g., a `curl | sh` installer that detects Claude Code's plugin dir and symlinks.
4. **Design partner pipeline** — do we want named design partners (3-5 companies) under NDA before the public push, or run the public push first and let inbound surface them?
5. **Cron persistence** — the in-session brainstorm cron is session-bound. We should also add a script that emits an `crontab` line or a `launchd` plist for true OS-level recurrence. Bookmark or include in Week 1?

---

## Self-review notes (per brainstorming skill)

- **Placeholders:** None. All sections complete with concrete file paths, commands, and counts.
- **Internal consistency:** Section 2 ICP tiers (P0/P1/P2) align with Section 4 marketing motions and Section 6 metrics.
- **Scope check:** This spec is focused enough for a single implementation plan. The plan will cover: (a) the three bug fixes, (b) the `/receipt` command, (c) README rewrite, (d) the NIST/OWASP mapping page, (e) the demo recording, (f) the Week 1-2 launch artifacts. Anything beyond Week 2 is left as roadmap, not implementation.
- **Ambiguity:** Open questions in Section 8 are flagged. Each requires a decision before implementation begins, but none block writing the implementation plan structure.
