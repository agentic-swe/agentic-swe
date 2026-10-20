# Launch checklist — Weeks 1–2 (refreshed)

**Status:** Living launch seed — verified **2026-10-21** against `origin/main` (pack **3.4.0**) and live npm / GitHub numbers.  
**Source spec:** [`docs/specs/positioning-and-receipt.md`](specs/positioning-and-receipt.md) (receipt / governance wedge).  
**Historical plan archive:** [`docs/plans/2026-05-17-positioning-and-receipt.md`](plans/2026-05-17-positioning-and-receipt.md) (do not treat unchecked boxes there as current).

### Positioning to use in posts (verified)

1. **Shipped wedge (lead with this):** *Claude codes your PRs. You review the receipt. Then merge.* — state machine + `.worklogs/` + deterministic `/receipt`.  
2. **Do not claim what is not shipped or measured:** no benchmark percentages, no token or cost savings, no compliance-control coverage beyond what `docs/compliance-mapping.md` marks as covered.  
3. **No competitor put-downs.** Do not claim another tool “can't” do something; describe what agentic-swe produces.

---

## Pre-launch verification

| Item | Status (2026-10-21) | Evidence |
|------|---------------------|----------|
| Phase 0 bug fixes on `main` | Done | SessionStart matcher `startup\|resume\|clear\|compact` (CHANGELOG, PR #62); artifacts checked against the **source** state (`requiredArtifactGroups(from, …)` in `scripts/lib/work-engine/artifacts.cjs`); `bench/tasks/` has 3 tasks |
| `/receipt` on real worklog | Done | `node scripts/render-receipt.cjs --work-dir .worklogs/tui-mascot-sf-agents` (completed, standard, PR #61) |
| `/receipt` sample matches renderer | Done | `docs/assets/sample-receipt.md` equals `render-receipt` output for `test/fixtures/receipt/lean-happy/` (header comment only differs) |
| Pack version | **Drift** | `main` is **3.4.0** (CHANGELOG 2026-10-03); npm latest is **3.3.0**; GitHub release `v3.4.0` notes say the installer installs 3.3.1 |
| `docs/compliance-mapping.md` | Rewritten 2026-10-21 | Now uses real OWASP `ASI01–ASI10`, real NIST AI RMF subcategories, and the amended EU AI Act dates — needs your review before README links it |
| `docs/compliance-mapping.md` linked from README | **Gap** | No README link yet (also absent on `origin/main`) |
| Demo cast `docs/assets/receipt-demo.cast` | **Missing** | Only `docs/assets/sample-receipt.md`; clip script updated with a `/receipt` beat |
| Social drafts reviewed by you | Open | Required before anything is published |

Checklist:

- [x] Phase 0 bug fixes merged / reflected on current tree
- [x] `/receipt` works against `.worklogs/tui-mascot-sf-agents/`
- [x] README centers `/receipt` (fixture-backed sample)
- [ ] Review the rewritten `docs/compliance-mapping.md`, then link it from README
- [ ] Record the demo (`docs/assets/receipt-demo.cast` or Loom) from `examples/golden-path-demo/DEMO_SCRIPT.md`
- [ ] Publish npm **3.4.0** and correct the `v3.4.0` release notes before any post cites a version
- [ ] Review LinkedIn + X drafts (below)
- [ ] Do **not** cite bench win rates; the full LLM `bench` run is not a marketing claim

---

## LinkedIn long-form (P0 ICP — eng leads + compliance)

**Headline:** "Every AI coding decision, in your repo, with a receipt"

**Draft:**

> Every AI coding tool — Cursor, Copilot, Claude Code, Codex — leaves the same question open when the work matters:
>
> What did the AI decide, why, and what did it cost?
>
> So I built agentic-swe: an open-source pipeline that wraps your coding agent with a state machine, evidence artifacts, and human gates. Every decision lands in your repo as `state.json` + `audit.log` + a phase-by-phase markdown trail.
>
> Then `/receipt` — one command that renders the whole thing as a shareable markdown summary. Drop it in your PR description, send it to your compliance partner, or paste it in a code review.
>
> Here's what a finished work item looks like:
>
> [embed: sample receipt — `docs/assets/sample-receipt.md` or live render of the lean-happy fixture]
>
> Governance expectations keep rising: the EU AI Act's record-keeping (Art. 12) and human-oversight (Art. 14) rules for high-risk systems apply from December 2027, and NIST and OWASP now publish agentic guidance. If AI-generated code ships at a regulated company, you'll be asked to show your work.
>
> Free, open source, MIT. Install via the `curl` installer or the Claude Code plugin — link in comments.

**Asset:** screenshot of `docs/assets/sample-receipt.md` (or `render-receipt` on the lean-happy fixture) on github.com.

---

## Twitter / X thread (P1 ICP — solo devs)

1. agentic-swe ships `/receipt` — a portable, shareable audit trail for every AI coding session. 🧵
2. The problem: AI ships code, you ship the PR — but nobody can tell what the AI decided, why, or what it cost. 1 week later it's a black box.
3. The fix: every transition writes `state.json` + `audit.log` + evidence into `.worklogs/<id>/` in YOUR repo. No cloud, no lock-in.
4. `/receipt` renders it as markdown — drop into PR descriptions, Slack, or your compliance ticket: [embed: demo when recorded]
5. Plus: state machine (lean / standard / rigorous), **138+** specialist subagents, Doubt-Driven Verification, cross-model panel on the rigorous track.
6. Governance pressure is rising (EU AI Act logging + oversight rules from Dec 2027, NIST / OWASP agentic guidance). You're going to need evidence, not vibes.
7. OSS / MIT / multi-host: github.com/agentic-swe/agentic-swe — first PR in this thread 👇

**Asset:** asciinema cast or Loom (still to record). Clip script: `examples/golden-path-demo/DEMO_SCRIPT.md`.

---

## dev.to article outline

**Title:** "Ship a feature with Claude in 15 minutes — with a receipt"

**Sections (write once the demo exists):**
1. The problem — context-switch tax + AI code with no provenance
2. What agentic-swe is — pipeline + tracks + subagents + audit (skim)
3. Walk-through — `/work add retry logic`, gate at PR, `/receipt` at end
4. The receipt — what's in it, why it matters (`docs/compliance-mapping.md`, once reviewed)
5. Try it — install from README; link docs site

---

## Cold DM list (P1 ICP — 10 Claude Code power users)

Find via: X searches for "claude code" power users; GitHub stars on related repos; Anthropic Discord.

**DM template:**

> Hi [name] — saw your [X post / GitHub repo / blog]. Built something that might save you hours each week if you use Claude Code: an OSS pipeline that gives every `/work` session a portable audit trail you can drop into a PR description. Demo: [cast or golden-path doc]. Curious if you'd find it useful — happy to do a quick walkthrough.

---

## Show HN (you write this one)

HN's guidelines ask for no generated text in posts and no automated posting ([newsguidelines](https://news.ycombinator.com/newsguidelines.html)). Write the post yourself from these points and submit it by hand, once the demo exists.

**Title:** "Show HN: Agentic SWE — Claude Code pipeline with a portable audit trail"

**Talking points:**
- Who you are and why you built it (one or two sentences, your words).
- What it does: wraps a coding agent in a state machine, evidence artifacts and human gates; state lives in `.worklogs/` in your repo.
- `/receipt`: deterministic markdown from `state.json` + `audit.log` + phase artifacts — no LLM summary.
- Why now: logging and human-oversight expectations (EU AI Act Arts. 12/14 from Dec 2027; NIST / OWASP agentic guidance).
- Honest limits: no measured benchmark wins yet; the compliance map marks which controls are only partly covered.
- Links: repo, `docs/specs/positioning-and-receipt.md`, demo; compliance map only after your review.
- Cite version **3.4.0** only after npm is published.

---

## Open follow-ups

- [ ] Record the demo from `examples/golden-path-demo/DEMO_SCRIPT.md` (now ends on `/receipt`)
- [ ] Review `docs/compliance-mapping.md`, then add the README link
- [ ] Publish npm **3.4.0**; fix the `v3.4.0` release notes (they still mention the 3.3.1 installer)
- [ ] Email Anthropic devrel about a "Built with Claude Code" feature
- [ ] CFP for AI Engineer Summit + KubeCon governance track
- [ ] First case study writeup after a design partner uses it
- [ ] As each compliance gap closes, update the map and post that work item's receipt

---

## Metrics tracking (refresh baseline)

| Metric | Baseline 2026-05-17 | **Verified 2026-10-21** | 90-day target (from spec) | Source |
|--------|---------------------|-------------------------|---------------------------|--------|
| GitHub stars | 1 | **6** (0 forks) | 500 | `gh api repos/agentic-swe/agentic-swe` |
| LinkedIn company followers | 39 | *(not queried — check LinkedIn analytics)* | 1,000 | LinkedIn |
| npm weekly downloads | 55 | **1** (12–18 Oct); **12** over 19 Sep–18 Oct | 1,500 | npm downloads API |
| npm latest version | — | registry **3.3.0** / `main` **3.4.0** | aligned publish | npm + `package.json` on `main` |
| `/receipt` mentions (Twitter/blog) | 0 | 0 (assumed, not searched) | 25 | manual |
| Design partners | 0 | 0 | 3 | self-reported |
| Third-party AGENTIC_SWE_BENCH submissions | 0 | 0 | 1 | PR count |

**Do not market:** corpus/oracle pass rates or “warm/cold token reduction” as user-facing wins without a deliberate, dated scorecard. `bench/results/baseline-2026-08-29.json` (pass rate 0) and the “planned” full LLM run are maintainer signals only.

Lagging indicator (unchanged): a non-author cites agentic-swe in a governance / autonomous-coding post without prompting.
