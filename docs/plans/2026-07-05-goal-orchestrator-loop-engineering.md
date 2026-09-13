# Goal Orchestrator — Evolving agentic-swe into a Loop-Engineering System

> **Status:** Design (brainstorm output). Not yet approved for implementation.
> **Origin:** `/brainstorm` on 2026-07-05 — "can agentic-swe evolve into loops?" (ref: [Loop Engineering, O'Reilly Radar](https://www.oreilly.com/radar/loop-engineering/)).
> **Decision locked with human:** (1) *Evolve the paradigm first.* (2) *Outer loop shape = **Goal orchestrator (Approach A)**.* (3) *New name = **`agentic-loops`*** — availability-verified 2026-07-05 (free on npm, GitHub org, `.dev`); rename **executed as a later phase, co-launched with the goal loop** (paradigm first).
> **For agentic workers:** when this is promoted to implementation, run via `/work` so a valid `.worklogs/<id>/state.json` is bootstrapped by `work-engine init`. This doc is the design artifact that run should consume.

---

## Goal

Turn agentic-swe from a **human-invoked, single-pass** governed pipeline into a system where you **define a goal and it iterates until a verifiable condition holds** — closing the one missing loop-engineering pillar (automation/heartbeat + an outer recursive loop) **without discarding the human gates** that are the pack's core value.

## The wedge: "governed loops — loop *up to* the gate, not *through* it"

The article's central caution is "cognitive surrender" — outsourcing thinking to an unbounded loop. This pack already ships the antidote: `ambiguity-wait`, `approval-wait`, budget caps, stall detection, escalation. The outer goal loop **reuses that exact discipline one level up**. It advances autonomously but **halts** at any human gate, budget ceiling, or stall — then surfaces to the engineer. That is the differentiator against Ralph-style unbounded loops and the raw built-in `/loop`.

## Loop-engineering pillar coverage (why this is mostly reuse)

| Pillar (from the article) | Status | Evidence in repo |
|---|---|---|
| Subagents (maker/checker) | ✅ mature | 139 subagents, design panel, `self-review`→`code-review`, `cross-model-reviewer` |
| Memory / state | ✅ mature | `.worklogs/<id>/state.json`, `progress.md`, `audit.log`, `memory.sqlite` |
| Worktrees | ✅ | `isolation: "worktree"` in delegation |
| Skills | ✅ | 22 commands + repo-knowledge templates |
| Plugins / MCP | ✅ | Ships as a plugin; `mcp-servers.json` |
| **Automations (heartbeat)** | ⚠️ **gap** | No self-triggering discovery loop; no outer recursive goal loop |

**5 of 6 pillars already exist.** This design builds only the 6th plus the outer loop that turns the pack's existing internal convergence loops (impl↔self-review↔code-review↔validation) into a true "recursive goal."

---

## Approaches considered

- **A — Goal orchestrator (CHOSEN).** A new outer state machine that wraps the existing per-work-item machine unchanged: read a goal + verifiable criteria → discover/triage work → run child work items → verify the goal → loop until met / gate / budget. Max reuse, exact fit to "a recursive goal where you define a purpose and the AI iterates until complete." Heaviest new surface, but all of it is *additive* — zero change to the inner machine.
- **B — Thin convergence loop (rejected).** Auto-re-enter the single-item pipeline until a predicate holds. Fastest, but it's a convergence loop not a *discover-and-distribute* goal loop, and it overlaps confusingly with the built-in `/loop` and `ralph-loop`.
- **C — Heartbeat/discovery only (folded into A).** Scheduled scan that enqueues+triages work items. This is the front half of A's `goal-discovery` state; shipped as part of A rather than standalone.

---

## Architecture

A **goal** is a durable, verifiable objective that may take one or more work items to satisfy. It lives at `.worklogs/goals/<goal-id>/` and owns an **outer state machine** that is a structural twin of the inner one.

### Outer state machine (`goal-state-machine.json`, mirrors `state-machine.json`)

```
goal-initialized -> goal-discovery
goal-discovery   -> goal-execute | goal-failed
goal-execute     -> goal-verify | goal-gate | goal-escalated
goal-verify      -> goal-execute | goal-approval | goal-escalated
goal-gate        -> goal-execute | goal-failed
goal-approval    -> goal-met | goal-execute
goal-escalated   -> goal-execute | goal-failed
```

| Outer state | Role |
|---|---|
| `goal-discovery` | Enumerate/triage work from sources (explicit sub-goal list, failing tests, TODO markers — later: issues, CI failures, review comments). Queues child work items. **This is pillar 6.** |
| `goal-execute` | Pick the next child work item; run it through the **existing** state machine (`/work` semantics) to `completed` or a gate. No inner changes. |
| `goal-verify` | Run `completion_criteria`. A new **`goal-verifier` subagent** (maker/checker at the goal level) returns an evidence-backed verdict: is the *objective* met — distinct from per-item validation. |
| `goal-gate` | A child hit `ambiguity-wait`/`approval-wait`; outer loop pauses and surfaces to human; resumes on resolution. |
| `goal-approval` | Human confirms the goal is truly met before closing ("machine proposes, human disposes"). |
| `goal-escalated` / `goal-met` / `goal-failed` | Escalation + terminals. |

### Completion criteria (the crux — verifiable-first)

Loops live or die on a crisp stop condition. `goal.json.completion_criteria` is structured and machine-checkable-first:

- `type: "command"` — a shell command must exit 0 (e.g. `npm test`, a project `verify` script). **Strongest.**
- `type: "checklist"` — sub-goals, each ideally with its own verify command; met when all verified.
- `type: "assertion"` — description requiring human confirmation at `goal-approval`. **Weakest; explicitly flagged human-verified.** Resist overusing this.

Every path ends at the `goal-approval` human gate before `goal-met`.

### Budgets & stall detection (outer, mirrors inner discipline)

`goal.json.budget`: `max_child_items`, `max_loop_turns`, aggregate `cost_budget_usd` / `cost_used` (separate from and larger than per-item budgets). `goal.json.convergence`: if `goal-verify` returns the same `last_failure_category` for `consecutive_same_category >= 2`, **escalate** — the same reflection-based stall rule the inner loop already uses. `hook-record-cost.cjs` rolls child costs up to the goal.

---

## File Structure

**Created files:**

| Path | Responsibility |
|------|----------------|
| `commands/goal.md` | `/goal` slash command — outer entry/discovery surface (see namespacing risk below) |
| `goal-state-machine.json` | Canonical outer edges; twin of `state-machine.json` |
| `templates/goal.json` | Outer state template; twin of `templates/state.json` |
| `schemas/goal.schema.json` | JSON Schema for `goal.json` (validated by engine, like `state.json`) |
| `phases/goal-discovery.md` | Phase text: discovery/triage/enqueue |
| `phases/goal-execute.md` | Phase text: advance the chosen child work item |
| `phases/goal-verify.md` | Phase text: run criteria + goal-verifier consult |
| `agents/subagents/meta-orchestration/goal-verifier.md` | Goal-level checker (natural home beside workflow-orchestrator, task-distributor) |
| `scripts/lib/work-engine/goal.cjs` | Pure lib: read/validate/transition `goal.json` (parallels the state lib) |
| `scripts/goal-engine.cjs` | CLI + CI enforcement (`init`/`validate`/`transition` for goals) — invalid transition → non-zero exit |
| `test/goal-state-machine.test.js` | Enforce `goal-state-machine.json` ↔ CLAUDE.md sync (mirrors `state-machine-json.test.js`) |
| `test/goal-engine.test.js` | Transition/validation unit tests |
| `test/fixtures/goal/happy/goal.json` | Fixture: goal that completes |
| `test/fixtures/goal/gated/goal.json` | Fixture: goal that pauses at a child gate |

**Modified files:**

| Path | Reason |
|------|--------|
| `CLAUDE.md` | New "Goal loop" section *above* the work-item state machine; Hypervisor now owns goals **and** work items; document "loop up to the gate"; add `/goal` to skills + common-ops tables |
| `README.md` | Loop-engineering positioning language lands here (still under the `agentic-swe` name per the deferral) |
| `bin/agentic-swe.cjs` | Add `goal` subcommand for npm-path users |
| `package.json` | Add `goal-engine` npm script |
| `docs/roadmap.md` | Record the goal-loop milestone |

---

## First slice (ship small to de-risk)

- [ ] Single active child work item at a time (no parallel worktrees yet).
- [ ] `completion_criteria` types: `command` + `checklist` (defer `assertion`).
- [ ] Discovery sources: explicit sub-goal list + failing-tests + TODO scan (defer issues/CI/review-comment connectors).
- [ ] Heartbeat: manual `/goal` re-entry + documented `ScheduleWakeup` / `/loop` binding (defer packaged cron).
- [ ] Full outer state machine + `goal.json` + `goal-verifier` + engine enforcement + tests + CLAUDE.md sync test.

**Later slices:** parallel children via worktrees (design `goal.json.children` to carry ordering/deps now); connector-based discovery; packaged heartbeat; cross-goal memory in `memory.sqlite`.

---

## Risks & open questions

1. **Command-name collision.** Claude Code ships `/loop` and `/goal`; `ralph-loop` is also installed. Plugin commands are namespaced (`agentic-swe:goal`), but the bare `/goal` will collide. **Decision needed:** namespace-only, or rename to `/swe-goal` / `/pipeline-goal`. Positioning stays "the *governed* goal loop."
2. **Fuzzy goals** that aren't command-checkable lean on `assertion` + the `goal-approval` gate. Guard against everything becoming `assertion`.
3. **Token cost** — outer loops multiply spend (the article's main caution). Guardrails: aggregate `cost_budget_usd`, hard `max_loop_turns`, cost roll-up via `hook-record-cost.cjs`.
4. **Multi-item merge/dependency ordering** when parallel — deferred, but `goal.json.children` must carry ordering/deps from v1.
5. **State-machine drift** across `goal-state-machine.json`, CLAUDE.md, and the engine — mirror the existing sync test.

---

## Design self-review checklist

- [x] **Fits the article's definition** — "recursive goal … iterates until complete" maps 1:1 to the outer machine + `completion_criteria`.
- [x] **Preserves the pack's identity** — human gates retained; "loop up to the gate" is explicit; no inner-machine changes.
- [x] **Maximizes reuse** — inner state machine, budget/counters/convergence/history shapes, engine enforcement pattern, subagent pattern all reused.
- [x] **Verifiable stop condition is first-class** — criteria are machine-checkable-first; human `goal-approval` backstop.
- [x] **Bounded** — outer budgets + stall detection mirror the inner loop; addresses the token-cost caution.
- [x] **Grounded in real structures** — twins `state.json` (v2), `state-machine.json` (edge list), `work-engine.cjs` CLI, `docs/plans/` doc convention.
- [ ] **Open:** `/goal` naming collision (needs human decision).
- [ ] **Open:** confirm `schemas/` already houses a `state.json` schema to mirror (verify during impl).

---

## Naming decision & migration plan — `agentic-swe` → `agentic-loops`

**Decision:** rebrand to **`agentic-loops`**. **Availability (verified 2026-07-05):** npm `agentic-loops` **free**, GitHub org `agentic-loops` **free**, `agentic-loops.dev` **free**, `.com` taken (irrelevant — `.dev` is the right TLD). Two acknowledged brand caveats (accepted): "agentic" is a saturated prefix, and "loops" sits near the built-in `/loop`, `/goal`, and `ralph-loop` — mitigated by positioning as the *governed* loop.

**Sequencing:** paradigm first. Build + ship the goal orchestrator under the current name, then execute this rename as a **coordinated release** (proposed **v4.0.0**) so the new name and the loop-engineering story land together — a stronger launch than a bare rename. Do **not** interleave the rename with feature work.

### Migration checklist (by cost tier)

**Tier 3 — external identity (semi-irreversible; coordinate + keep redirects/aliases for ≥1 deprecation window):**
- [ ] **npm:** publish `agentic-loops` (unscoped, free). Publish a final `@agentic-swe/agentic-swe` release that `npm deprecate`s with a pointer to the new package. Keep old install path working via the deprecation notice.
- [ ] **GitHub:** *recommended low-friction path* — **keep the `agentic-swe` org, rename the repo** `agentic-swe/agentic-swe` → `agentic-swe/agentic-loops` (GitHub auto-redirects old URLs). Only move to the free `agentic-loops` org if org-name == product-name matters enough to justify re-pointing everything.
- [ ] **Marketplace:** existing users have `agentic-swe@agentic-swe-catalog` enabled. Keep `marketplace.json` id `agentic-swe-catalog` **stable** (or publish new id + keep old as alias) so installs don't break; change only the plugin `name` in `.claude-plugin/plugin.json` (`agentic-swe` → `agentic-loops`) with a migration note in the release.
- [ ] **Docs site:** `agentic-swe.github.io/agentic-swe-site` → add `agentic-loops.dev` (or new Pages repo); 301 the old site.

**Tier 2 — code-coupled (ship with back-compat aliases, warn-on-old, remove next major):**
- [ ] **Env prefix** `AGENTIC_SWE_*` (~40 vars across ~50 files) → `AGENTIC_LOOPS_*`. Route all reads through one helper that prefers the new var, falls back to the old, and warns once. (Do this refactor first so aliasing lives in one place.)
- [ ] **Commands** `swe-dashboard`, `swe-tui` → `loops-dashboard`, `loops-tui`; keep old command files as thin alias stubs for a window. Update matching npm scripts.
- [ ] **Bin** `bin/agentic-swe.cjs` → `bin/agentic-loops.cjs`; `package.json` `bin` gains `agentic-loops` and keeps `agentic-swe` pointing at the same script for a window.
- [ ] **Config dir** `.agentic-swe/` (repo-level `budget-thresholds.json`, `memory.sqlite`) → `.agentic-loops/`; loader checks new dir, falls back to old.

**Tier 1 — cosmetic (mechanical find/replace, no back-compat needed):**
- [ ] Prose/prompt/README/CLAUDE.md mentions of the product slug `agentic-swe` → `agentic-loops` (bulk of the ~540 occurrences).
- [ ] **Keep descriptive "SWE"/"software engineering" text** (~616 standalone uses) where it means the *domain*, not the *brand* — only the identity slug changes. The "Hypervisor" metaphor is orthogonal (may be reframed by the paradigm work, not the rename).

### Open (unchanged by the name choice)
- [ ] `/goal` command collision persists — plugin namespace is now `agentic-loops:goal`, but bare `/goal` still clashes with the host built-in. Decide: namespace-only vs `/loops-goal`.

