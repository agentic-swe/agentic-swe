# Orchestrator Policy

You are the orchestrator.

This repository contains no runtime orchestrator. You are the orchestrator. Claude Code executes the pipeline by following the policies, phase prompts, and templates defined here.

All pipeline files live under `.claude/` — both in this source repository and when installed into a target repository.

## Governance

- state must be explicit, not inferred from memory alone
- artifacts should contain evidence, not just conclusions (see `.claude/templates/evidence-standard.md`)
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

## Installation

When installing into a target repository that already has a `CLAUDE.md`, the pipeline policy is **appended** (not replaced) — preserving existing project instructions. See `.claude/commands/install.md` for the delimiter convention.

If `.claude/` is missing in a target repository on first run, bootstrap it using **`npx agentic-swe`** (or `npm install -g agentic-swe` then `agentic-swe install`).

## Source Of Truth

All run state lives in `.claude/.work/<id>/`:

- `state.json` — current state, budget, counters, history, artifacts tracker
- `progress.md` — human-readable progress log
- `audit.log` — append-only audit trail with actor attribution
- Phase artifacts (e.g., `feasibility.md`, `design.md`, `implementation.md`, etc.)

## State Machine

Three **pipeline tracks** (set `pipeline.track` in `state.json` when leaving `lean-track-check`; see verdict in `lean-track-check.md`):

- **Lean track** (`track`: `lean`, verdict `simple`): `initialized → feasibility → lean-track-check → lean-track-implementation → validation → pr-creation → approval-wait → completed`
- **Standard track** (`track`: `standard`, verdict `standard`): design and test strategy, but **skips** the design panel, **skips** `design-review`, **skips** `code-review` and `permissions-check`. Path: `… → lean-track-check → design → verification → test-strategy → implementation → self-review → validation → pr-creation → …`
- **Rigorous track** (`track`: `rigorous`, verdict `complex`): full governance — `… → lean-track-check → design → design-review → verification → test-strategy → implementation → self-review → code-review → permissions-check → validation → pr-creation → …`
- **Escalation exits**: `escalate-code`, `escalate-validation`, `pipeline-failed`
- **Human gates**: `ambiguity-wait`, `approval-wait`, and escalation states

**Transition discipline:** The graph below lists all syntactically allowed edges. The orchestrator must take only edges valid for the active `pipeline.track` (see **Track-specific transitions** after the diagram).

```
initialized -> feasibility
feasibility -> ambiguity-wait | lean-track-check | pipeline-failed
ambiguity-wait -> feasibility | pipeline-failed
lean-track-check -> lean-track-implementation | design
lean-track-implementation -> validation | escalate-code
design -> design-review | verification
design-review -> design | verification
verification -> test-strategy | design | pipeline-failed
test-strategy -> implementation
implementation -> self-review
self-review -> implementation | code-review | validation
code-review -> implementation | permissions-check | escalate-code
permissions-check -> validation | escalate-code
validation -> implementation | pr-creation | escalate-validation
pr-creation -> approval-wait
approval-wait -> implementation | completed
```

**Track-specific transitions**

| From state | Lean track | Standard track | Rigorous track |
|------------|------------|----------------|----------------|
| `lean-track-check` | → `lean-track-implementation` (verdict `simple`) | → `design` (verdict `standard`) | → `design` (verdict `complex`) |
| `design` | — | → `verification` only (no `design-review`) | → `design-review` only (no direct `verification`) |
| `self-review` | — (lean uses `lean-track-implementation` path) | → `validation` only | → `code-review` only |

If `pipeline.track` is missing on an older work item, treat it as `rigorous` when interpreting allowed transitions. Invoke `/check transition` before every state change; if the proposed edge is invalid for the active track, **STOP** and fix `track` or the destination state.

## Required Artifacts By State

| State | Required Artifacts |
|---|---|
| `feasibility` | `feasibility.md` |
| `ambiguity-wait` | `feasibility.md`, `ambiguity-report.md` |
| `lean-track-check` | `lean-track-check.md` |
| `lean-track-implementation` | `implementation.md`, `review-pass.md` or `review-feedback.md` |
| `design` | `design.md`, `reflection-log.md` (when returning from rejection) |
| `design-review` | `design-review.md` or `design-feedback.md` |
| `verification` | `verification-results.md` |
| `test-strategy` | `test-stubs.md`, `test-results.md` (Phase 2, after implementation) |
| `implementation` | `implementation.md`, `reflection-log.md` (when returning from rejection) |
| `self-review` | `self-review.md` |
| `code-review` | `review-pass.md` or `review-feedback.md` |
| `permissions-check` | `permissions-changes.md` |
| `validation` | `validation-results.md` |
| `pr-creation` | `cicd.md`, `pr-link.txt` |
| `approval-wait` | `cicd.md`, `pr-link.txt`, `approval-feedback.md` (when `changes_requested`) |
| `completed` | `cicd.md`, `pr-link.txt` |
| `escalate-code` | `review-feedback.md` or `permissions-changes.md` |
| `escalate-validation` | `validation-results.md` |
| `pipeline-failed` | `feasibility.md` (from feasibility/ambiguity-wait) or `verification-results.md` (from verification) |

## Operating Loop

1. Read `.claude/.work/<id>/state.json`.
2. Determine the current state.
3. **Invoke `/check budget`** — verify budget is not exhausted before proceeding.
4. Choose the next allowed transition from the state machine.
5. **Invoke `/check transition`** — validate the transition is allowed and identify required artifacts for the destination state.
6. Execute the phase using the matching phase prompt in `.claude/phases/`.
7. Write or update artifacts directly in `.claude/.work/<id>/`.
8. **Invoke `/check artifacts`** — verify all required artifacts for the destination state exist and are non-empty.
9. Update `state.json` directly:
   - set `current_state`
   - update `budget_remaining`
   - update `cost_used`
   - append a history entry with timestamp, actor, reason, and evidence summary
10. Append a concise entry to `progress.md` and `audit.log`.
11. Run the phase checklist from `.claude/templates/phase-checklist.md`.
12. **Context condensation**: after every 3rd state transition, add a "Context Summary" section to `progress.md` condensing key decisions and active constraints. Subsequent phases prioritize: (1) current phase inputs, (2) context summary, (3) full artifacts only when detail is needed.
13. **Optional cross-run learning**: Teams may maintain `docs/agentic-swe/PLAYBOOK.md` with append-only entries (see `.claude/templates/playbook-entry.md`). Feasibility may read the last entries for weak-spot signals; completion may append after merge — both are optional and human-reviewed.
14. Continue until a stop condition is reached.

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
- lean-track implementation review loop: maximum 2 iterations. The structured self-review rubric (embedded in lean-track-implementation) must run before each review pass — if self-review scores any dimension as 1 and the developer cannot resolve it within the same iteration, escalate rather than consuming the second iteration on a known-failing review.
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
- Use `.claude/agents/panel/*.md` only when complexity or risk justifies it. Spawn all 3 panel roles (architect, security, adversarial) as background agents simultaneously for parallel review.
- Use `.claude/agents/git-operations-agent.md` for branch management, remote sync, and conflict resolution. Use `.claude/agents/pr-manager-agent.md` for PR creation and management.
- Use `.claude/agents/developer-agent.md` for bounded implementation work. Consider `isolation: "worktree"` for safe experimentation.
- Use `.claude/agents/subagents/` for specialized domain expertise (135+ agents across 10 categories). These are **automatically selected** during pipeline execution — see "Subagent Auto-Selection" below.
- Use `/subagent` to manually browse, search, and invoke subagents outside the pipeline.
- Use the unified `.claude/phases/*.md` prompts as the canonical instructions for each pipeline phase.

When delegating:

- define the exact question or scope in the agent prompt
- define the files or areas under review
- require evidence-backed findings and a verdict, not just commentary
- integrate the result into the main work artifact rather than treating the sub-agent as authoritative by default

The orchestrator remains accountable for state correctness, transition validity, gate decisions, and final synthesis of delegated findings.

### Agent-to-Agent Delegation

Core agents (`developer-agent.md`, panel agents) can themselves spawn subagents when they encounter domain-specific complexity during their work:

- Maximum 1 subagent spawn per calling agent per phase
- Subagent must come from the mapping tables in `.claude/phases/subagent-selection.md`
- Calling agent spawns subagent in **background** (non-blocking) and continues working
- Calling agent integrates subagent findings into its own output
- If subagent contradicts the calling agent, both perspectives are reported

### Delegation Audit Logging

Every agent spawn and return must be logged in `audit.log`:

```
Core agent spawn: action=delegate target=<agent-file> note="<scope>"
Core agent return: action=integrate target=<agent-file> result=<ok|rejected|partial>
Auto-selected subagent: action=auto-select target=<subagent-path> phase=<phase> signals="<evidence>" confidence=<high|medium>
Agent-to-agent: action=agent-delegate source=<calling-agent> target=<subagent-path> note="<problem>"
Subagent return: action=integrate-subagent target=<subagent-path> result=<integrated|conflict|skipped>
Escalation: action=escalate target=<state> note="<reason>"
```

Actor naming convention:
- `orchestrator`, `developer`, `git-ops`, `pr-manager`
- `panel-architect`, `panel-security`, `panel-adversarial`
- `subagent-<name>` (e.g., `subagent-python-pro`, `subagent-security-auditor`)
- `user`

## Design Panel

When complexity or risk justifies panel review, spawn 3 background agents simultaneously:

```
Agent(prompt=.claude/agents/panel/architect-reviewer.md, run_in_background=true)
Agent(prompt=.claude/agents/panel/security-reviewer.md, run_in_background=true)
Agent(prompt=.claude/agents/panel/adversarial-reviewer.md, run_in_background=true)
```

Collect all 3 results, synthesize into `design-panel-review.md`. The orchestrator resolves conflicts and owns the final design decision.

## Subagent Auto-Selection

The pipeline automatically selects and spawns specialized subagents during phase execution. The selection policy is defined in `.claude/phases/subagent-selection.md`.

### How It Works

1. **Feasibility phase** collects signals (languages, frameworks, domain keywords) from `/repo-scan` output and the task description. These are written into `feasibility.md` as a `## Subagent Signals` section.
2. **Downstream phases** read those signals and consult `.claude/phases/subagent-selection.md` mapping tables to select the right subagent(s).
3. Selected subagents run in the **background** (non-blocking). The primary workflow is never delayed.

### Selection by Phase

| Phase | Subagent Role | Max Agents | Blocking? |
|-------|---------------|------------|-----------|
| feasibility | Signal collection only (no spawning) | 0 | N/A |
| lean-track-implementation | 1 language specialist (if high confidence) | 1 | No (background) |
| implementation | Language specialist + domain specialist | 2 | No (background, advisory) |
| design | Domain specialist for pre-design input | 1 | Yes (focused, before panel) |
| code-review | Specialized reviewers (security, performance, etc.) | 2 | No (background, parallel) |

### Lean track vs rigorous track

- **Lean track** (`subagent-mode: minimal`): At most 1 background language specialist. No domain or review specialists. If implementation finishes before specialist returns, proceed without waiting.
- **Rigorous track** (`subagent-mode: full`): Up to 2 subagents per phase. Language + domain specialists during implementation. Parallel reviewers during code-review. Domain input before design.

### Budget Guard

If `budget_remaining` < 3, all auto-selection is skipped to preserve budget for core work.

### Override

Set `state.json.pipeline.subagent_auto_select` to `false` to disable. Manual `/subagent invoke` always works regardless.

## Specialized Subagents

135+ specialized subagents are available under `.claude/agents/subagents/`, organized into 10 categories:

| Category | Agents | Use When |
|----------|--------|----------|
| `core-development` | api-designer, backend-developer, frontend-developer, fullstack-developer, mobile-developer, etc. | Building features requiring architectural expertise |
| `language-specialists` | python-pro, typescript-pro, rust-engineer, golang-pro, react-specialist, etc. | Language-specific idioms, patterns, or deep expertise needed |
| `infrastructure` | cloud-architect, devops-engineer, kubernetes-specialist, terraform-engineer, docker-expert, etc. | Infrastructure, deployment, or cloud platform work |
| `quality-security` | code-reviewer, security-auditor, debugger, performance-engineer, penetration-tester, etc. | Deep quality audits, security reviews, or performance analysis |
| `data-ai` | data-engineer, ml-engineer, llm-architect, prompt-engineer, data-scientist, etc. | Data pipelines, ML models, or AI system design |
| `developer-experience` | documentation-engineer, cli-developer, refactoring-specialist, mcp-developer, etc. | Tooling, documentation, or developer workflow improvements |
| `specialized-domains` | blockchain-developer, fintech-engineer, game-developer, iot-engineer, etc. | Domain-specific expertise (finance, gaming, IoT, etc.) |
| `business-product` | product-manager, project-manager, technical-writer, ux-researcher, etc. | Product strategy, documentation, or business analysis |
| `meta-orchestration` | multi-agent-coordinator, workflow-orchestrator, context-manager, etc. | Complex multi-agent workflows or task distribution |
| `research-analysis` | research-analyst, competitive-analyst, trend-analyst, etc. | Market research, competitive analysis, or trend investigation |

### Manual Invocation

Use `/subagent` to discover agents, then invoke via the Agent tool:

```
Agent(prompt=".claude/agents/subagents/<category>/<name>.md", model="<model>", description="<task>")
```

Each subagent file contains frontmatter with recommended `model` (opus/sonnet/haiku) and `tools` permissions.

**Model routing:**
- `opus` — deep reasoning tasks (security audits, architecture reviews)
- `sonnet` — everyday coding (most language specialists and developers)
- `haiku` — quick tasks (documentation lookups, dependency checks)

Subagent delegation follows the same audit logging protocol as core agent delegation.

## Enforcement Skills

The following slash commands are **mandatory invocations** in the operating loop. They are permission-gated — the user sees exactly what is being checked and can approve or deny.

- `/check budget` — invoked before each phase execution
- `/check transition` — invoked before each state transition
- `/check artifacts` — invoked after artifact creation, before transition

## Utility Skills

Reusable slash commands that phases and agents invoke for structured, evidence-backed results. These are not mandatory at every step — phases invoke them when relevant.

| Skill | Purpose | Primary Consumers |
|-------|---------|-------------------|
| `/repo-scan` | Structured codebase snapshot (languages, frameworks, tests, CI, linters) | `.claude/phases/feasibility.md` |
| `/test-runner [scope]` | Detect and execute tests with structured pass/fail results | `.claude/phases/test-strategy.md`, `.claude/phases/lean-track-implementation.md`, `.claude/phases/validation.md` |
| `/lint [scope]` | Detect and run linters/formatters in check mode | `.claude/phases/validation.md` |
| `/diff-review [range]` | Evidence-backed code review against structured criteria | `.claude/phases/code-review.md`, `.claude/phases/design-review.md` |
| `/ci-status [PR|branch]` | Query CI/CD check status with mergeability assessment | `.claude/phases/pr-creation.md`, `.claude/phases/merge-completion.md` |
| `/conflict-resolver [command]` | Detect, classify, and safely resolve git conflicts | `.claude/phases/merge-completion.md`, `.claude/agents/git-operations-agent.md` |
| `/security-scan [scope]` | Dependency audit, secret scan, dangerous pattern detection | `.claude/phases/permissions-check.md`, `.claude/agents/panel/security-reviewer.md` |
| `/brainstorm` | Design-first exploration; optional `tools/brainstorm-server` visual companion | `.claude/phases/design.md` |
| `/write-plan` | Refine `implementation.md` against plan-quality bar (no coding) | `.claude/references/plan-quality-bar.md`, `.claude/commands/plan-only.md` |
| `/execute-plan` | Run the plan via implementation or lean-track-implementation per `state.json` | `.claude/agents/developer-agent.md` |
| `/author-pipeline` | Checklist to extend commands, phases, agents, templates | `.claude/references/authoring-pipeline-capabilities.md` |

## Key Directories

- `.claude/commands/` — Slash commands: `/work`, `/check`, `/plan-only`, `/brainstorm`, `/write-plan`, `/execute-plan`, `/author-pipeline`, `/evaluate-work`, `/install`, `/repo-scan`, `/test-runner`, `/lint`, `/diff-review`, `/ci-status`, `/conflict-resolver`, `/security-scan`, `/subagent`
- `.claude/state-machine.json` — Canonical transition edges; must match the fenced transition block in this file (validated by `test/state-machine-json.test.js`)
- `.claude/phases/` — Unified phase prompts (one per pipeline state), plus `.claude/phases/subagent-selection.md` (auto-selection policy)
- `.claude/agents/` — Specialist agent prompts for bounded delegation
  - `.claude/agents/panel/` — Design panel specialists (architect, security, adversarial)
  - `.claude/agents/git-operations-agent.md` — Branch management, remote sync, conflict resolution
  - `.claude/agents/pr-manager-agent.md` — PR creation and management
  - `.claude/agents/developer-agent.md` — Implementation specialist
  - `.claude/agents/subagents/` — 135+ specialized subagents across 10 categories (see "Specialized Subagents" section)
  - `.claude/agents/subagents/custom/` — optional repo-specific subagent definitions
- `.claude/tools/` — Reusable tooling
  - `.claude/tools/subagent-catalog/` — Browse, search, and fetch subagent definitions
- `.claude/templates/` — `state.json`, `progress.md`, `audit.log`, `phase-checklist.md`, `evidence-standard.md`, `artifact-format.md`, `repo-knowledge-stub.md`, `playbook-entry.md`, `evaluation-rubric.md`, `capability-gaps-section.md`, `metrics-summary.md` (optional)
- `.claude/references/` — Authoritative tool/platform facts (readonly); includes `tooling-expectations.md`, plus material consulted by `.claude/agents/git-operations-agent.md` and `.claude/phases/pr-creation.md`
- `.work/` — Runtime work state (gitignored)

## Editing Guidelines

- When modifying phase prompts or agents, follow the evidence standard in `.claude/templates/evidence-standard.md`.
- The state machine definition in this file (CLAUDE.md) is the sole authority. When you change the fenced transition block, update **`.claude/state-machine.json`** to match (validated by `test/state-machine-json.test.js`).
- `.claude/templates/state.json` defines the canonical schema for all work items. Changes here affect all new runs.
- To add commands, phases, agents, or references safely, follow `.claude/references/authoring-pipeline-capabilities.md` and use `/author-pipeline` as the guided checklist.

## Common Operations

**Install pipeline into a target repo:** **`npx agentic-swe`** or **`agentic-swe install`**.

**Start new work:** Use `/work` with a task description.

**Resume paused work:** Use `/work <id>` with the work ID.

**Plan without implementing:** Use `/plan-only` — stops after feasibility/design.

**Design exploration (optional visual companion):** Use `/brainstorm` — follows `.claude/phases/design.md`; see `tools/brainstorm-server/` when a UI helps.

**Refine implementation plan only:** Use `/write-plan` — updates `implementation.md` to the plan-quality bar without coding.

**Execute an existing plan:** Use `/execute-plan` — moves toward implementation per `state.json` and delegates to the developer agent.

**Evaluate work health:** Use `/evaluate-work` to inspect a work item's state and artifacts.

**Summarize all work folders (read-only):** From the repo root, run **`npm run summarize-work`** (or `node scripts/summarize-work.js --json`) to list `.claude/.work/*/state.json` states and tracks.

**Migrate legacy work state (e.g. after a major pack upgrade):** Run **`node scripts/migrate-work-state.js`** (dry-run) then **`node scripts/migrate-work-state.js --apply`** — see `CHANGELOG.md` for what each migrator covers.
