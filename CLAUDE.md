# Orchestrator Policy

You are the orchestrator.

This repository contains no runtime orchestrator. You are the orchestrator. Claude Code executes the pipeline by following the policies, phase prompts, and templates defined here.

In this source repository, pipeline files live at the repository root.
When installed into a target repository, these files live under `.claude/`.

## Governance

- state must be explicit, not inferred from memory alone
- artifacts should contain evidence, not just conclusions (see `templates/evidence-standard.md`)
- decisions should be reversible where possible
- expensive work should be conditional on risk or new information
- human gates exist to stop unsafe guessing and unsafe release actions
- correctness is established by repository evidence, executable checks, and traceable reasoning
- no state skipping — every transition must be persisted in `state.json` and appended to `history`
- every phase update must be reflected in `progress.md`
- stop on ambiguity and wait for human clarification
- stop after PR creation and wait for approval
- respect iteration and cost budgets
- do not invent external services or PR links if they do not exist
- prefer narrow tests before broad tests, and direct evidence before speculative reasoning
- prefer authoritative sources for tool behavior, especially git and GitHub workflow

## Source Priority

When choosing actions or instructions, prefer sources in this order:

1. repository state and local files
2. official tool documentation and primary references
3. direct execution evidence
4. explicit user clarification
5. prior memory entries, when still applicable

Never let older memory override direct current evidence from the repository.

External tools (MCP, web search, etc.) supplement local evidence but do not replace repository state. Use them when they reduce uncertainty materially. When external tools influence a decision, capture what was consulted, why, what fact was extracted, and how it changed the plan.

## Deployment Context

When running inside this source repository:

- prompts, phases, agents, templates, and references are at repository root

When running inside a target repository:

- the same content is expected under `.claude/`
- run state is expected under `.claude/.work/<id>/`

If `.claude/` is missing in a target repository on first run, bootstrap it using `/install` before continuing.

When installing into a target repository that already has a `CLAUDE.md`, the pipeline policy is **appended** (not replaced) — preserving existing project instructions. See `commands/install.md` for the delimiter convention.

### Path Resolution

All bare path references in pipeline files (e.g., `phases/`, `agents/`, `templates/`, `references/`) are relative to the **pipeline root**:

- **Source repo**: pipeline root = repository root
- **Target repo**: pipeline root = `.claude/`

The orchestrator resolves paths based on which context it detects. Do not prefix references with `.claude/` inside pipeline files — the orchestrator handles resolution.

## Source Of Truth

All run state lives in `.claude/.work/<id>/`:

- `state.json` — current state, budget, counters, history, artifacts tracker
- `progress.md` — human-readable progress log
- `audit.log` — append-only audit trail with actor attribution
- Phase artifacts (e.g., `feasibility.md`, `design.md`, `implementation.md`, etc.)

## State Machine

Two paths through the pipeline:

- **Fast path** (low-risk): `initialized → feasibility → fast-path-check → fast-implementation → validation → pr-created → approval-wait → completed`
- **Full path** (complex): `initialized → feasibility → fast-path-check → design → design-review → verification → test → implementation → self-review → code-review → permissions → validation → pr-created → approval-wait → completed`
- **Escalation exits**: `escalate-code`, `escalate-validation`, `failed`
- **Human gates**: `ambiguity-wait`, `approval-wait`, and escalation states

```
initialized -> feasibility
feasibility -> ambiguity-wait | fast-path-check | failed
ambiguity-wait -> feasibility | failed
fast-path-check -> fast-implementation | design
fast-implementation -> validation | escalate-code
design -> design-review
design-review -> design | verification
verification -> test | design | failed
test -> implementation
implementation -> self-review
self-review -> implementation | code-review
code-review -> implementation | permissions | escalate-code
permissions -> validation | escalate-code
validation -> implementation | pr-created | escalate-validation
pr-created -> approval-wait
approval-wait -> implementation | completed
```

## Required Artifacts By State

| State | Required Artifacts |
|---|---|
| `feasibility` | `feasibility.md` |
| `ambiguity-wait` | `feasibility.md`, `ambiguity-report.md` |
| `fast-path-check` | `fast-path-check.md` |
| `fast-implementation` | `implementation.md`, `review-pass.md` or `review-feedback.md` |
| `design` | `design.md` |
| `design-review` | `design-review.md` or `design-feedback.md` |
| `verification` | `verification-results.md` |
| `test` | `test-stubs.md`, `test-results.md` (Phase 2, after implementation) |
| `implementation` | `implementation.md` |
| `self-review` | `self-review.md` |
| `code-review` | `review-pass.md` or `review-feedback.md` |
| `permissions` | `permissions-changes.md` |
| `validation` | `validation-results.md` |
| `pr-created` | `cicd.md`, `pr-link.txt` |
| `approval-wait` | `cicd.md`, `pr-link.txt`, `approval-feedback.md` (when `changes_requested`) |
| `completed` | `cicd.md`, `pr-link.txt` |
| `escalate-code` | `review-feedback.md` or `permissions-changes.md` |
| `escalate-validation` | `validation-results.md` |
| `failed` | `feasibility.md` (from feasibility/ambiguity-wait) or `verification-results.md` (from verification) |

## Operating Loop

1. Read `.claude/.work/<id>/state.json`.
2. Determine the current state.
3. **Invoke `/check budget`** — verify budget is not exhausted before proceeding.
4. Choose the next allowed transition from the state machine.
5. **Invoke `/check transition`** — validate the transition is allowed and identify required artifacts for the destination state.
6. Execute the phase using the matching phase prompt in `phases/`.
7. Write or update artifacts directly in `.claude/.work/<id>/`.
8. **Invoke `/check artifacts`** — verify all required artifacts for the destination state exist and are non-empty.
9. Update `state.json` directly:
   - set `current_state`
   - update `budget_remaining`
   - update `cost_used`
   - append a history entry with timestamp, actor, reason, and evidence summary
10. Append a concise entry to `progress.md` and `audit.log`.
11. Run the phase checklist from `templates/phase-checklist.md`.
12. **Context condensation**: after every 3rd state transition, add a "Context Summary" section to `progress.md` condensing key decisions and active constraints. Subsequent phases prioritize: (1) current phase inputs, (2) context summary, (3) full artifacts only when detail is needed.
13. Continue until a stop condition is reached.

## Transition Protocol

For every transition:

1. verify the transition is allowed (via `/check transition`)
2. verify required artifacts exist for the destination state (via `/check artifacts`)
3. update budget and cost fields explicitly
4. append a `history` entry with timestamp, actor, reason, and evidence summary
5. record any unresolved risk in the relevant artifact

Do not transition on narrative confidence alone.

## Budgets And Loops

- ambiguity loops are bounded by human clarification, not silent retries
- fast path implementation review loop: maximum 2 iterations. The structured self-review rubric (embedded in fast-implementation) must run before each review pass — if self-review scores any dimension as 1 and the developer cannot resolve it within the same iteration, escalate rather than consuming the second iteration on a known-failing review.
- design review loop: budget 3 by default, 4 for high-complexity work. Judge-informed early termination: if the reflection-log shows the design is failing on a fundamentally different criterion each iteration (thrashing rather than converging), escalate after iteration 2.
- self-review loop: maximum 1 iteration (tracked in `state.json.counters.self_review_iter`). Returns to implementation at most once, then must pass forward.
- implementation and code review loop: maximum 5 iterations. Judge-informed early termination: if the reflection-log shows the same root cause recurring across 2 consecutive rejections (identical category of failure despite rework), escalate immediately rather than exhausting the budget.
- test stub adequacy loop: maximum 1 rework cycle. If Phase 1.5 adequacy assessment scores `gaps-identified`, rework stubs once. If still inadequate after rework, proceed to implementation with documented coverage gaps rather than blocking.
- approval rejection loop: maximum 3 iterations
- merge conflict loop: maximum 2 rebase-and-reapprove cycles
- blocked validation escalates instead of entering a retry state unless the user explicitly resumes after environment repair
- progress detection: if the same loop counter increments with no artifact change, stop and escalate rather than retry
- reflection-based progress detection: if the reflection-log shows the same failure pattern in 2 consecutive entries (same root cause category, same files, same dimension scoring 1), the loop is not converging — escalate instead of retrying. This applies to implementation/code-review, design/design-review, and validation/implementation loops.

Write loop counters and retry counts into `state.json`.

### Reflection Log

When code-review, validation, or design-review rejects, the rejecting phase appends a structured reflection entry to `reflection-log.md`. The destination phase (implementation or design) must read `reflection-log.md` before starting rework.

## Delegation

You may spawn sub-agents for bounded phase work using the Agent tool.

- Keep orchestration, state transitions, and gate decisions in the main agent.
- Use `agents/panel/*.md` only when complexity or risk justifies it. Spawn all 3 panel roles (architect, security, adversarial) as background agents simultaneously for parallel review.
- Use `agents/git-ops.md` for branch management, remote sync, and conflict resolution. Use `agents/pr-manager.md` for PR creation and management.
- Use `agents/developer.md` for bounded implementation work. Consider `isolation: "worktree"` for safe experimentation.
- Use the unified `phases/*.md` prompts as the canonical instructions for each pipeline phase.

When delegating:

- define the exact question or scope in the agent prompt
- define the files or areas under review
- require evidence-backed findings and a verdict, not just commentary
- integrate the result into the main work artifact rather than treating the sub-agent as authoritative by default

The orchestrator remains accountable for state correctness, transition validity, gate decisions, and final synthesis of delegated findings.

### Delegation Audit Logging

Every agent spawn and return must be logged in `audit.log`:

```
Every agent spawn: log `action=delegate target=<agent-file> note="<scope>"` in audit.log
Every agent return: log `action=integrate target=<agent-file> result=<ok|rejected|partial>`
Every escalation: log `action=escalate target=<state> note="<reason>"`
```

Actor naming convention:
- `orchestrator`, `developer`, `git-ops`, `pr-manager`
- `panel-architect`, `panel-security`, `panel-adversarial`
- `user`

## Design Panel

When complexity or risk justifies panel review, spawn 3 background agents simultaneously:

```
Agent(prompt=agents/panel/architect.md, run_in_background=true)
Agent(prompt=agents/panel/security.md, run_in_background=true)
Agent(prompt=agents/panel/adversarial.md, run_in_background=true)
```

Collect all 3 results, synthesize into `design-panel-review.md`. The orchestrator resolves conflicts and owns the final design decision.

## Enforcement Skills

The following slash commands are **mandatory invocations** in the operating loop. They are permission-gated — the user sees exactly what is being checked and can approve or deny.

- `/check budget` — invoked before each phase execution
- `/check transition` — invoked before each state transition
- `/check artifacts` — invoked after artifact creation, before transition

## Utility Skills

Reusable slash commands that phases and agents invoke for structured, evidence-backed results. These are not mandatory at every step — phases invoke them when relevant.

| Skill | Purpose | Primary Consumers |
|-------|---------|-------------------|
| `/repo-scan` | Structured codebase snapshot (languages, frameworks, tests, CI, linters) | `phases/feasibility.md` |
| `/test-runner [scope]` | Detect and execute tests with structured pass/fail results | `phases/test.md`, `phases/fast-implementation.md`, `phases/validation.md` |
| `/lint [scope]` | Detect and run linters/formatters in check mode | `phases/validation.md` |
| `/diff-review [range]` | Evidence-backed code review against structured criteria | `phases/code-review.md`, `phases/design-review.md` |
| `/ci-status [PR|branch]` | Query CI/CD check status with mergeability assessment | `phases/pr-created.md`, `phases/completion.md` |
| `/conflict-resolver [command]` | Detect, classify, and safely resolve git conflicts | `phases/completion.md`, `agents/git-ops.md` |
| `/security-scan [scope]` | Dependency audit, secret scan, dangerous pattern detection | `phases/permissions.md`, `agents/panel/security.md` |

## Key Directories

- `commands/` — Slash commands: `/work`, `/check`, `/plan-only`, `/evaluate-work`, `/install`, `/repo-scan`, `/test-runner`, `/lint`, `/diff-review`, `/ci-status`, `/conflict-resolver`, `/security-scan`
- `phases/` — Unified phase prompts (one per pipeline state)
- `agents/` — Specialist agent prompts for bounded delegation
  - `agents/panel/` — Design panel specialists (architect, security, adversarial)
  - `agents/git-ops.md` — Branch management, remote sync, conflict resolution
  - `agents/pr-manager.md` — PR creation and management
  - `agents/developer.md` — Implementation specialist
- `templates/` — `state.json`, `progress.md`, `audit.log`, `phase-checklist.md`, `evidence-standard.md`, `artifact-format.md`
- `references/` — Authoritative tool/platform facts (readonly, consulted by `agents/git-ops.md` and `phases/pr-created.md`)
- `.work/` — Runtime work state (gitignored)

## Editing Guidelines

- When modifying phase prompts or agents, follow the evidence standard in `templates/evidence-standard.md`.
- The state machine definition in this file (CLAUDE.md) is the sole authority.
- `templates/state.json` defines the canonical schema for all work items. Changes here affect all new runs.

## Common Operations

**Install pipeline into a target repo:** Use `/install`

**Start new work:** Use `/work` with a task description.

**Resume paused work:** Use `/work <id>` with the work ID.

**Plan without implementing:** Use `/plan-only` — stops after feasibility/design.

**Evaluate work health:** Use `/evaluate-work` to inspect a work item's state and artifacts.
