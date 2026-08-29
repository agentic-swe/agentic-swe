# Autonomous One-Command Goal Loop — Design Spec

> **Status:** Design (brainstorm output, revised after `/agentic-swe:doubt` + 3-model evaluation). Awaiting user review before implementation.
> **Origin:** brainstorming session 2026-07-05, extending [the goal-orchestrator design](2026-07-05-goal-orchestrator-loop-engineering.md) and the shipped first slice (`commands/goal.md`, `goal-state-machine.json`, `scripts/goal-engine.cjs`).
> **Locked decisions (human):** (1) Trust model = **roadmap approval + human OK on every merge**. (2) Concurrency v1 = **sequential, parallel-ready** (build the dependency DAG, execute one chunk at a time in topological order). (3) Approach = **evolve the slice**, don't rewrite.
> **Revision note (2026-07-05):** A 3-model design panel (security/opus, adversarial/sonnet, independent/sonnet) returned **two independent REJECTs** on one converging root cause — *the §5 safety contract and roadmap approval were prose the LLM was asked to follow, not enforced by the only code that runs.* This revision moves enforcement into the engine (**fail-closed**) and adds the missing scope, DAG, unwind, and least-privilege guarantees. Reviewer findings and their disposition are in [Appendix A](#appendix-a--design-panel-reconcile).
> **HARD GATE:** no implementation until this spec is user-approved.

---

## 1. Problem & the trust constraint

`/agentic-swe:goal "<objective>"` should be **one command** that takes a high-level, possibly-ambiguous goal (e.g. *"perform code cleanup, best-in-class standards, 100% safe, with proper gates"*) and autonomously: analyzes the codebase, clarifies what's ambiguous, produces an approvable roadmap, decomposes into small chunks, resolves hard dependencies, and executes each chunk through the existing inner pipeline — **without breaking anything**.

**The overriding constraint is trust.** A single destructive mistake discredits the whole "agentic loops" premise. The design principle that follows from this, and that the panel forced into the foreground:

> **Enforcement lives in code, not in prose.** Any safety property that matters must be checked by the engine and **fail closed** (missing/incomplete evidence → non-zero exit → no transition). A property that exists only as an instruction to the Hypervisor LLM is, under budget/time pressure, optional — and therefore not a guarantee. The engine is the trust boundary; the LLM is an untrusted planner operating inside it.

Autonomy is bounded by *"loop up to the gate, not through it"* — and every gate is mechanically closed, not narratively closed.

## 2. Approach — evolve the slice (chosen)

Add a **planning layer** in front of the executor and refine the outer state machine with three human gate types. The **inner pipeline (`/work` state machine) and the `goal-verifier-agent` are unchanged as pipelines**; each chunk is an ordinary inner work item that already ends at its own PR/`approval-wait`. What changes is that `goal-engine.cjs` gains real enforcement (roadmap validation, per-chunk safety-contract validation, scope check) rather than only edge-existence checks.

Rejected alternatives: a `/goal-plan` + `/goal-run` split (violates "one command"); a pure roadmap-as-code generator (loses the governed loop + gates).

**Considered alternative (independent reviewer #1):** collapse the new outer states into *data* on the existing slice (`goal-gate` + a `gate_type` field) instead of new nodes, to avoid duplicating the inner pipeline's `ambiguity-wait`/`approval-wait` semantics one level up. **Disposition:** keep distinct outer states. Rationale: the outer gates guard *different objects* than the inner ones (a whole roadmap; a cross-chunk merge decision; final objective sign-off), a drift-tested named graph is easier to audit than a polymorphic `gate_type`, and the enforcement backbone below attaches naturally to named transitions. We accept the extra test surface as the price of an auditable trust boundary. (Recorded, not dismissed.)

## 3. Lifecycle — extended outer state machine

Supersedes the first-slice machine. Canonical edges live in `goal-state-machine.json`; human-readable graph in `commands/goal.md` (drift-tested by `test/goal-state-machine.test.js`, which must be updated in the **same commit** as the graph and the engine — see §11).

```
goal-initialized -> goal-discovery | goal-clarify
goal-clarify -> goal-discovery | goal-planning | goal-execute | goal-failed
goal-discovery -> goal-planning | goal-failed
goal-planning -> goal-roadmap-review | goal-clarify
goal-roadmap-review -> goal-execute | goal-planning | goal-failed
goal-execute -> goal-merge-review | goal-clarify | goal-escalated
goal-merge-review -> goal-verify | goal-execute | goal-escalated
goal-verify -> goal-execute | goal-approval | goal-escalated
goal-approval -> goal-met | goal-execute
goal-escalated -> goal-execute | goal-planning | goal-failed
```

- **Terminal:** `goal-met`, `goal-failed`. (Both require a recorded `disposition` for already-merged chunks — see §5a.)
- **Human gates (3 types):** `goal-roadmap-review` (approve the plan once), `goal-merge-review` (approve each chunk's PR before it lands), `goal-approval` (final objective sign-off). Plus `goal-clarify` (ask-when-in-doubt).
- **Escalation:** `goal-escalated` (bounded; human decides resume / replan / fail).

| State | Behavior | Engine gate on **exit** |
|-------|----------|--------------------------|
| `goal-discovery` | Repo scan (`/repo-scan`), collect signals, gather standards inputs, detect verify commands. No writes. | — |
| `goal-clarify` | Ask the human when the goal/scope/standards are ambiguous. Answers recorded as roadmap assumptions. | — |
| `goal-planning` | Decompose into chunks; build the dependency DAG; assign risk/verify/revert/area per chunk; write `roadmap.json` + render human summary. | — |
| `goal-roadmap-review` | **GATE 1.** Human approves / edits / aborts. | Engine requires `roadmap.approved=true` **and** roadmap passes schema + **acyclic topo-feasibility** validation, **and** the frozen quality-gate policy is captured (§5b). Fail → reject. |
| `goal-execute` | Pick the next chunk whose deps are all `merged` (topological, one at a time in v1); run it via `/work`. | Engine requires the chosen chunk's deps are all `merged` and the chunk is topologically eligible. |
| `goal-merge-review` | **GATE 2 (per chunk).** Present PR + safety evidence; human approves the merge. Only path by which code lands on main. | **Engine requires a complete, passing `safety_contract` object (§5) on the chunk. Fail-closed.** |
| `goal-verify` | `goal-verifier-agent` re-checks objective progress + regressions; independently re-diffs each merged chunk vs its `area`. | Engine requires a verifier verdict artifact. |
| `goal-approval` | **GATE 3.** Human confirms the whole objective is met. | Engine requires `completion_criteria.verified=true`. |

## 4. Roadmap artifact — `.worklogs/goals/<id>/roadmap.json`

The reviewable dependency DAG. This is what the human approves at GATE 1. Validated by `schemas/goal-roadmap.schema.json` and by engine logic (acyclicity, topo-feasibility) **before** `approved` can be honored.

```json
{
  "schema_version": 1,
  "goal_id": "code-cleanup",
  "objective": "…",
  "assumptions": ["target standard = eslint airbnb + tsc strict", "no public API changes"],
  "quality_gate_policy": {
    "test_cmd": "npm test",
    "lint_cmd": "npm run lint",
    "coverage_min": 0.0,
    "lint_config_hash": "sha256:…",
    "frozen_at": null
  },
  "chunks": [
    {
      "id": "c1-lint-baseline",
      "title": "Introduce lint/type baseline + CI check",
      "area": ["package.json", ".eslintrc*", "tsconfig.json"],
      "depends_on": [],
      "risk": "low",
      "verify_cmd": "npm run lint && npm test",
      "modifies_quality_policy": true,
      "revert_plan": "revert single PR",
      "rationale": "gates all later cleanup",
      "status": "pending",
      "work_id": null,
      "safety_contract": null
    }
  ],
  "approved": false,
  "approved_at": null
}
```

- `depends_on` edges define topological execution order. `status`: `pending|running|merged|failed|skipped`. `work_id` links to the inner `.worklogs/<id>` once executed.
- `area` is an explicit file/glob list. **Granularity is a planning-quality problem, not a solved mechanism** (like dependency detection, §7): too narrow → constant false scope flags; too broad → the check never trips. Planning SHOULD prefer directory/glob granularity matching the chunk's stated intent and record its choice in `rationale`. The human calibrates it at GATE 1.
- `modifies_quality_policy: true` marks chunks that touch the frozen policy (§5b) so merge-review highlights them distinctly.
- `safety_contract` is populated by the executor before `goal-merge-review`; its shape and the engine check are §5.

`goal.json` gains: `roadmap: { path, approved, quality_gate_policy_frozen }`, `active_chunk`, and `disposition` (§5a).

## 5. Per-chunk safety contract (the "don't break anything" guarantee, now mechanical)

A chunk is **never** surfaced at `goal-merge-review` unless the engine validates a complete `safety_contract` object. **The check is fail-closed: absent or incomplete → non-zero exit → transition refused.** This is the operational meaning of "100% safe / proper gates," and it is the single most important change from the prior draft (panel BLOCKER, security + adversarial converge).

`chunks[].safety_contract`:

```json
{
  "branch": "goal/code-cleanup/c1",              // isolated branch/worktree off approved main (§5c)
  "base_sha": "…",                               // the approved-main SHA it was cut from
  "build": { "cmd": "…", "exit_code": 0, "evidence": "path/to/build.log" },
  "tests": { "cmd": "…", "exit_code": 0, "evidence": "path/to/test.log", "full_suite": true },
  "lint":  { "exit_code": 0, "delta_new_errors": 0, "evidence": "…" },
  "coverage": { "before": 0.0, "after": 0.0, "decreased": false },
  "scope":   { "declared_area": ["…"], "changed_files": ["…"], "out_of_scope": [], "confined": true },
  "revert":  { "command": "git revert <sha>", "single_pr": true },
  "verifier": { "verdict": "confirmed", "brief": "per-chunk-scope-diff", "evidence": "…" }
}
```

The engine (`goal-engine.cjs` → `goal.cjs`) validates, on the transition **into** `goal-merge-review` and again **out of** it toward `goal-verify`:

1. **Isolation** — `branch` set and `base_sha` equals the current approved-main SHA recorded in `goal.json`.
2. **Green build + full suite** — `build.exit_code === 0`, `tests.exit_code === 0`, `tests.full_suite === true` (or an explicitly-approved scoped target, §8-no-tests), each with a non-empty `evidence` path that exists.
3. **No regression vs frozen policy** — `lint.delta_new_errors === 0` and `coverage.decreased === false`, measured against the **frozen** `quality_gate_policy` (§5b), not the chunk's current tree.
4. **Scope confined** — `scope.out_of_scope` is empty (engine recomputes `git diff --name-only base_sha...HEAD` vs `declared_area`; a mismatch **forces `status: failed`**, not a soft flag — see §5d).
5. **One-command revert** — `revert.command` present and `single_pr === true`.
6. **Independent verifier sign-off** — `verifier.verdict === "confirmed"` from the **per-chunk, scope-diff-focused** brief (distinct from the goal-level verifier pass — see §5e).

Any check failing → the transition is rejected and the chunk goes to rework (`goal-execute`) or, on a second failure, `goal-escalated`. **Never auto-lands.**

### 5a. Abandonment & unwind (previously silent — panel MAJOR, independent + adversarial)

Merging is per-chunk and irreversible-by-default; abandoning a goal must therefore be an explicit, recorded decision, not a silent stop.

- Every chunk merged under a goal is tagged (commit trailer `Goal-Id: <id>` + `chunks[].merged_sha`) so merged-under-goal work is distinguishable from ordinary history.
- The engine **requires** a `disposition` on `goal.json` before allowing any edge into `goal-failed` when ≥1 chunk is `merged`:
  - `disposition: "keep_merged"` — merged chunks stay; the goal stops. Repo state is documented in the final receipt.
  - `disposition: { "revert_chunks": ["cN", …] }` — engine emits the reverse-order revert plan (each chunk's `revert.command`); reverts still go through `goal-merge-review`-style human approval.
- Entering `goal-escalated` surfaces the list of already-merged chunks prominently so the human decides with full state visibility.
- **Locked default:** abandonment does **not** auto-revert approved work; it stops further chunks and records `keep_merged` unless the human chooses otherwise.

### 5b. Frozen quality-gate policy (panel MAJOR — the yardstick can't be moved mid-goal)

At `goal-roadmap-review` approval, the engine **freezes** `quality_gate_policy` (test/lint commands, `coverage_min`, `lint_config_hash`) into `goal.json` with `frozen_at`. Every chunk's §5.3 "no regression" check measures against this frozen baseline. A chunk with `modifies_quality_policy: true` must diff its proposed policy change against the frozen baseline and surface it as a **distinct, highlighted risk** at merge-review — a policy weakening is never just another green check.

### 5c. Least-privilege execution (panel — security blockers)

Chunk execution runs with the minimum authority needed, so a mistaken or gamed chunk can't do wide damage before any human sees it:

- **Isolated worktree/branch off approved main**; the goal loop never commits directly to the protected default branch — landing is only via the human-approved PR merge at GATE 2.
- **`verify_cmd` is untrusted input.** It is authored by the LLM planner and human-approved at GATE 1; the engine treats it as data. It runs inside the isolated worktree with a **git-command denylist** (no `push --force`, no `branch -D` of protected refs, no history rewrite of main) and never with elevated/CI-deploy credentials. Dependency installs during verification use `--ignore-scripts` by default (policy-configurable).
- **Protected paths** (policy-as-code): a repo-configurable denylist (e.g. `.github/workflows/**`, deploy manifests, secrets files) that, if touched by a chunk whose `area` didn't explicitly and human-approvedly include them, forces `status: failed`.
- **Secret hygiene:** evidence logs written to `.worklogs/goals/<id>/` are redacted (reuse the pack's redaction conventions), and `.worklogs/goals/` is git-ignored by default so evidence/tokens never leak into commits or PRs.

### 5d. Scope confinement is mechanical, not advisory (panel BLOCKER)

The engine computes changed files (`git diff --name-only <base_sha>...HEAD`) and matches them against the chunk's `area` globs (using the existing `minimatch` dependency). Any file outside `area` (or inside a protected path not explicitly approved) → `scope.confined = false` → the chunk **cannot** reach merge-review; it is forced to `status: failed` and returns to rework. The only way forward is the human explicitly widening `area` in `roadmap.json` (which is itself a tamper-evident, GATE-1-style edit — §6a), not the agent quietly proceeding.

### 5e. Verifier independence (panel MAJOR)

The per-chunk sign-off (§5.6) and the goal-level `goal-verify` pass are **separate invocations with separate briefs**:

- **Per-chunk:** a narrow, scope-diff-focused prompt — "did this chunk change exactly its `area` and nothing else; is the diff what the roadmap said." 
- **Goal-level:** the existing `goal-verifier-agent` objective-met check — and it **independently re-diffs every merged chunk** against its declared `area` rather than trusting the earlier per-chunk verdict. Same agent file is acceptable; the two calls must not share state such that one rubber-stamps the other.

## 6. Clarification loop ("ask when in doubt")

Up-front scoping Q&A bounds the goal before planning. Residual unknowns become **explicit `assumptions` in `roadmap.json`** the human sees at GATE 1. Mid-execution doubt pauses at `goal-clarify` instead of guessing. Doubt detection reuses the pack's ambiguity conventions; the inner pipeline's own `ambiguity-wait` still applies within a chunk.

### 6a. Engine-owned state files & tamper-evidence (panel BLOCKER — the bypass)

A hardened engine only protects transitions that go *through* it; nothing stops an agent from editing `goal.json`/`roadmap.json` directly with the Edit/Write tool and inventing an "approved" state. Therefore:

- `goal.json` and `roadmap.json` are **engine-owned**. Every engine write records a content hash (`state_hash`) of the canonical file.
- A **pre-flight integrity check** (a `/check goal-integrity`-equivalent skill + a `PreToolUse`/`Stop` hook) recomputes the hash before honoring any transition and **refuses to proceed** if the file was modified outside `applyGoalTransition`. Human approvals (`approved`, merge-review OK, disposition) are recorded **through the engine** (`goal-engine.cjs approve …`), which stamps actor + timestamp + new hash — not by hand-editing the JSON.
- This makes the "rushed agent just fixes the JSON" path loud and blocked instead of silent.

## 7. Dependency detection (honest about limits)

LLM reasoning over the discovery scan + reference grep (imports/callers/build graph). The DAG is **human-confirmed at GATE 1** — auto-detected deps are proposals, not truth. **Conservative default: when unsure, add a dependency** (serialize) rather than risk a wrong order/parallelization.

**Mechanical guardrails (panel MAJOR):** before `approved` is honored, the engine validates the DAG is **acyclic and fully topologically orderable** (every chunk reachable, no cycle). A cycle or unorderable graph → the approval action itself is **rejected** (non-zero exit) with the offending edges named. At execution, if no chunk is eligible while `pending` chunks remain (a mid-run deadlock), the loop transitions to `goal-escalated` — it never silently spins burning budget.

## 8. One-command UX & control flow

`/agentic-swe:goal "<objective>"` runs the whole lifecycle autonomously, pausing only at `goal-clarify` and the three gates. Between gates: no babysitting. Every transition validated by `goal-engine.cjs` (invalid edge **or failed enforcement check** → non-zero exit) and appended to `goal.json.history` + `audit.log`.

**Roadmap review experience (GATE 1) (panel MAJOR):** `goal-planning` renders a **human-readable companion** to `roadmap.json` — an ordered chunk list grouped by topological layer, with per-chunk risk, `area`, verify command, and dependency arrows (a small Mermaid/ASCII DAG). The human approves *that*, not a raw JSON dump. This is the actual trust-critical surface.

**Merge review experience (GATE 2) (panel MAJOR):** the presentation **leads with** the computed scope-creep verdict (yes/no + out-of-scope file list) and a diff-stat, then the PR link — so the signal most likely to be missed under approval fatigue is the first thing seen. Batching *presentation* of upcoming diffs is allowed in v1 (it doesn't weaken "approve every merge"); auto-land stays out of scope (§12).

**No trustworthy test suite (panel MAJOR):** if `goal-discovery` cannot establish a verify command / the repo has no/failing/flaky tests, affected chunks are marked `risk: high`, the `safety_contract` records `tests.full_suite:false` with the reason, and such chunks get **heightened** merge-review scrutiny (the human is told test evidence is weak). They can never bypass GATE 2. Where possible, an early chunk that *establishes* a test baseline is proposed first.

**Resumability (panel MAJOR):** `/agentic-swe:goal <id>` resumes from `goal.json`. If `active_chunk` is `running`, the outer loop re-enters the inner `/work <id>` at *its* `current_state` (the inner pipeline already supports resume) rather than re-planning; if the inner work item is missing/corrupt, the chunk is marked `failed` and routed to rework/escalation. Documented in Required Artifacts + risks.

## 9. Reuse vs. new

**Reuse (unchanged as pipelines):** inner `/work` state machine, `agents/goal-verifier-agent.md`, `work-engine.cjs`, worktree isolation, evidence/audit conventions, `minimatch`, redaction conventions.
**Extend:** `goal-state-machine.json` (new states/edges), `commands/goal.md` (planning + gates + presentation), `scripts/goal-engine.cjs` + `scripts/lib/work-engine/goal.cjs` (roadmap load/validate incl. **acyclicity/topo**, **safety-contract enforcement**, **scope check**, **policy freeze**, **integrity hash**, `approve`/`disposition` subcommands), `templates/goal.json`.
**New:** `templates/roadmap.json`, `schemas/goal-roadmap.schema.json`, planning/scheduler logic, a `/check goal-integrity`-equivalent + integrity hook, `test/goal-roadmap.test.js` + scheduler/safety-gate/scope/DAG/integrity tests, CLAUDE.md goal-loop section update, policy defaults for protected paths / denylists in `config/`.

## 10. Budgets & stall (outer)

`goal.json.budget`: `max_child_items`, `max_loop_turns`, aggregate `cost_budget_usd` — **enforced by the engine** (a transition that would exceed a ceiling is rejected, not merely noted). Stall rule: same failure category twice at `goal-verify` → `goal-escalated`. A chunk failing its safety contract twice → `goal-escalated`, never retried blindly. Deadlocked DAG (no eligible chunk) → `goal-escalated`.

## 11. Risks & open questions

1. **Unreliable dependency/scope detection** → human GATE 1 + conservative serialization + **mechanical** acyclicity/topo check + **mechanical** scope-confinement (forced-fail, not flag).
2. **"Full test suite green" assumes tests exist and are trustworthy** → `risk:high` + heightened scrutiny fallback (§8); prefer a test-baseline chunk first. Cost/slowness on large repos → policy may scope the target, default full.
3. **Roadmap explosion** on huge goals → cap chunk count; phased roadmap (approve phase 1 first).
4. **Token cost** of a long autonomous loop → **engine-enforced** outer budget ceilings + `hook-record-cost` roll-up.
5. **`goal-merge-review` fatigue** → scope-creep-first presentation (§8); batch presentation v1; auto-land deferred (§12).
6. **Graph/engine/test drift** — extending the machine changes `goal-state-machine.json`; the drift test + engine tests + `commands/goal.md` graph must change in **one commit**. **No in-flight goals exist under the shipped slice to migrate** (early feature, low usage); if any exist, `current_state` values absent from the new graph route to `goal-escalated` for human disposition.
7. **Enforcement completeness** — the engine can only guarantee what it checks; the integrity hash (§6a) closes the direct-edit bypass but depends on the hook/skill actually running in the host. Where a host cannot run the hook, the loop degrades to "engine-validated transitions only" and this limitation is stated to the user, not hidden.

**Open (accepted, human-gated):** dependency-detection reliability; `area` granularity calibration; default scope of "full test suite" for very large repos.

## 12. Out of scope (v2+)

Parallel chunk execution via concurrent worktrees; connector-based discovery (issues/CI/review comments); opt-in auto-land for low-risk chunks that pass the full contract; cross-goal memory.

## 13. Design self-review checklist

- [x] Every safety property that matters is **engine-checked and fail-closed**, not prose (§1, §5, §5d, §7, §10).
- [x] The engine-bypass (direct JSON edit) is addressed by tamper-evidence (§6a).
- [x] Every autonomy path yields to a gate or the safety contract (no unattended landing).
- [x] Scope confinement is mechanical and forces failure, not a soft flag (§5d).
- [x] Quality yardstick is frozen at GATE 1 and can't be silently moved (§5b).
- [x] DAG is validated acyclic/orderable before approval; deadlock escalates (§7).
- [x] Abandonment has an explicit, recorded disposition; no silent half-cleaned main (§5a).
- [x] Verifier independence between per-chunk and goal-level checks (§5e).
- [x] Least-privilege execution: isolated worktree, protected main/paths, untrusted `verify_cmd`, secret hygiene (§5c).
- [x] Human review surfaces (roadmap summary, scope-first merge review) are designed, not assumed (§8).
- [x] Resumability after interruption is specified (§8).
- [x] Reuses the inner pipeline + verifier; additive surface; graph/engine/test change in lockstep (§9, §11.6).
- [ ] **Open:** dependency-detection reliability, `area` granularity, full-suite scope on very large repos (accepted, human-gated).

---

## Appendix A — Design panel reconcile

3-model panel on the prior draft. **Two independent REJECTs** (security/opus, adversarial/sonnet) converged on one root cause: enforcement was prose, not code. DDV stop condition met (convergence, no third cycle needed). Disposition of every finding:

| # | Finding (source) | Severity | Disposition in this revision |
|---|------------------|----------|------------------------------|
| 1 | Safety contract + roadmap approval unenforceable by engine (security, adversarial) | BLOCKER | **Adopted** — §5 `safety_contract` object, fail-closed engine validation; §3 exit gates |
| 2 | Engine bypass via direct edit of `goal.json` (adversarial) | BLOCKER | **Adopted** — §6a integrity hash + pre-flight check + `approve` subcommand |
| 3 | Scope confinement has no mechanical check (security, adversarial) | BLOCKER | **Adopted** — §5d forced-fail `git diff` vs `area` via `minimatch` |
| 4 | Gameable/RCE `verify_cmd`; ungated destructive git; secret leakage (security) | BLOCKER/MAJOR | **Adopted** — §5c least-privilege: denylist, `--ignore-scripts`, protected main/paths, redaction, gitignore `.worklogs/goals` |
| 5 | Quality yardstick weakened by policy-defining chunk (adversarial) | MAJOR | **Adopted** — §5b frozen policy + highlighted policy-change risk |
| 6 | No DAG cycle/topo-feasibility check (adversarial) | MAJOR | **Adopted** — §7 engine acyclicity/topo validation; deadlock → escalate |
| 7 | No unwind for already-merged chunks on abandonment (independent, adversarial) | MAJOR | **Adopted** — §5a `disposition` required before `goal-failed`; keep-merged default |
| 8 | Per-chunk vs goal verifier non-independent (adversarial) | MAJOR | **Adopted** — §5e separate briefs; goal-verify re-diffs |
| 9 | "Full suite green" assumes tests exist/trustworthy (independent) | MAJOR | **Adopted** — §8 no-tests fallback (`risk:high`, heightened scrutiny) |
| 10 | Resumability after interruption unspecified (independent) | MAJOR | **Adopted** — §8 resume behavior |
| 11 | Roadmap review at scale needs rendered summary (independent) | MAJOR | **Adopted** — §8 GATE-1 human companion (topo groups + DAG) |
| 12 | Merge-review fatigue: scope-first presentation, batch v1 (adversarial, independent) | MINOR/MAJOR | **Adopted** — §8 scope-creep-first presentation |
| 13 | `area` granularity calibration guidance (independent) | MINOR | **Adopted** — §4 honesty note + heuristic |
| 14 | In-flight migration / graph-drift compat (independent, adversarial) | MINOR | **Adopted** — §11.6 no-in-flight note + escalate-on-unknown-state |
| 15 | New outer states may over-engineer vs `gate_type` data (independent) | MAJOR (design) | **Recorded, kept states** — §2 rationale (different guarded objects, auditable named graph) |

Enforcement-completeness residual (§11.7) is stated honestly rather than claimed solved.
