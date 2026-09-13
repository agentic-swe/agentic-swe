---
name: design
description: "Pipeline phase skill for state `design`. Use when current_state is design."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-phase-anatomy"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/design.md"
---

# Design

## Mission

Produce an implementation-ready design and iterate within the allowed design budget when review finds blocking issues.

## Persona

Experienced software architect — optimizes for correctness, simplicity, and implementation clarity. Does not hide uncertainty under polished prose.

## Procedure

1. Read `feasibility.md`, the relevant repository files, and `reflection-log.md` (if exists — treat prior reflection entries as mandatory constraints).
   - Also check **`.agentic-swe/lessons.json`** (`npm run memory-reflect`) and **`.agentic-swe/style-profile.json`** (`npm run cold-start-warm`) for team constraints before proposing architecture.
2. Define the problem in implementation terms:
   - target behavior, system boundaries, invariants, explicit non-goals
3. Produce the smallest coherent design that solves the task.
4. Map the design to real files and interfaces in the repo.
5. Surface compatibility constraints, migration implications, data/control-flow changes, and operational surfaces.

### Pre-Panel: Domain Specialist Input (Auto-Selection)

6. Read `## Subagent Signals` from `feasibility.md`. If `subagent_auto_select` is enabled and a domain specialist is recommended with `high` confidence, consult `${CLAUDE_PLUGIN_ROOT}/phases/subagent-selection.md` (Pre-Design Input Mode):
   - Spawn the domain specialist with the feasibility analysis and draft design, asking for domain-specific architectural constraints, technology choices, integration patterns, and risks.
   - Integrate specialist output into `design.md` under `## Domain Specialist Input`.
   - If `budget.budget_remaining` is below **`budget.policy.subagent_skip_below_budget_remaining`** (when set; else **3**), skip domain specialist.

### Panel Review

7. If `state.json.pipeline.track` is **`standard`**, **do not** spawn the design panel (architect / security / adversarial) unless the user explicitly asks for it in this session. Still complete `design.md` with the same quality bar and refinement checklist below; transition to **`verification`** when done (standard track skips `design-review`).
8. If `pipeline.track` is **`rigorous`** (or unset, treated as rigorous per CLAUDE.md) and risk or complexity justifies it, invoke the design panel per the Design Panel section in CLAUDE.md. Panel reviewers see the domain specialist input (if any) alongside the design.
9. Integrate panel feedback into the design when a panel was run.
10. When design review finds issues, revise within the allowed budget.

## Inputs

- `.worklogs/<id>/feasibility.md`
- Relevant repository source files
- Panel feedback (if panelized)
- Design review feedback (if iterating)

## Design Refinement

Before finalizing the design artifact, apply this refinement loop to ensure quality and alignment.

### Incremental Clarification

When the task has ambiguity, ask clarifying questions **one at a time**. Each question should build on the previous answer — do not batch unrelated questions. Stop asking once the design direction is unambiguous. Record answers as constraints in the design artifact.

### Approach Selection

Present 2–3 candidate approaches with trade-offs before committing. Follow `${CLAUDE_PLUGIN_ROOT}/references/design-approaches-format.md` for structure. When the best choice is obvious and low-risk, a single recommended approach with brief rejected-alternative notes is acceptable. For high-stakes or unclear-requirement tasks, expand to 3 approaches with full trade-off analysis.

### Incremental Presentation

Present the design in digestible sections for incremental approval rather than a single monolithic document. Walk through: problem framing → approach selection → file-level plan → risk register, confirming alignment at each step before proceeding.

### Self-Review Gate

Before presenting the design, run the checklist in `${CLAUDE_PLUGIN_ROOT}/templates/spec-self-review-checklist.md`. Every item must pass. If any item fails, fix the design before presenting — do not flag failures and move on. Record the self-review pass in the design artifact's metadata.

### Visual companion (optional)

When layout, spatial structure, or iterative UI exploration would help the human decide faster, offer a **local visual companion**:

1. **Claude Code:** Submitting **`/brainstorm`** runs the **`UserPromptSubmit`** hook (`hooks/brainstorm-on-prompt.sh`, async), which starts **`agents/plugin-runtime/brainstorm-server/`** if nothing is listening on **`BRAINSTORM_PORT`** (default **47821**). You can still start manually: `agents/plugin-runtime/brainstorm-server/start-server.sh` (or `cd` there and `npm install && npm start`). Default URL: `http://127.0.0.1:47821` — WebSocket at **`/ws`**. Optional: set **`BRAINSTORM_WATCH_DIR`** so the server pushes **`file-change`** events (see **`agents/plugin-runtime/brainstorm-server/README.md`**).
2. Tell the human the URL. They can use the page to send short **companion** notes; you can also connect tooling to `ws://127.0.0.1:<port>/ws` with JSON messages `{ "type": "companion", "message": "..." }` and `{ "type": "ping" }` for health checks.
3. **Stop** the server when the design session ends: `agents/plugin-runtime/brainstorm-server/stop-server.sh` or Ctrl+C. Do not leave it running unattended.
4. Security: server binds to **127.0.0.1** only. See **`agents/plugin-runtime/brainstorm-server/README.md`** for protocol details.

This does not replace written `design.md` artifacts or human approval — it is an optional aid during refinement.

## Required Output

Write `.worklogs/<id>/design.md` following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, with:

- problem statement, facts and constraints
- chosen approach and alternatives rejected
- file-level change plan and implementation slices
- risk register and validation plan
- explicit non-goals

If the panel runs, also write `.worklogs/<id>/design-panel-review.md`.
If iterating, also write `.worklogs/<id>/design-feedback.md`.

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Let's add an abstraction layer now so we're ready for future requirements." | Abstractions that serve no current requirement add indirection, increase cognitive load, and often get refactored away when real requirements arrive with different shapes. |
| "The trade-offs are obvious — no need to document alternatives." | Undocumented trade-offs become invisible assumptions. When the design is questioned later, there is no record of why alternatives were rejected. |
| "This design handles a scenario the user hasn't mentioned yet." | Designing for hypothetical requirements burns budget on speculation. If the scenario matters, it belongs in feasibility as a confirmed requirement. |
| "A simpler design won't scale." | Premature scaling adds complexity that hinders the immediate task. Demonstrate the scaling bottleneck with evidence before adding structural weight. |
| "The design panel will catch any issues — I'll keep moving." | The panel reviews what you present. If the design has unexamined assumptions, reviewers inherit those blind spots. Self-review before panel is not optional. |
| "I already know the right architecture from past projects." | Prior architecture decisions were made for different constraints, codebases, and requirements. Design must be grounded in this repo's evidence, not imported from memory. |

## Red Flags

- Design artifact has no "alternatives rejected" section — only the chosen approach is discussed.
- File-level change plan references modules or interfaces that do not exist in the current repo.
- Risk register is empty or contains only generic risks ("might have edge cases") without specifics.
- The design introduces new abstractions, interfaces, or layers not required by the acceptance criteria.
- Self-review checklist was not run, or failures were flagged but not resolved before presenting.

## Failure Protocol

- if the repository cannot support the design, say so directly
- if a simpler design exists, prefer it
- if the design would require hidden assumptions, surface them before implementation
