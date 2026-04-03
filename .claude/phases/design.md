# Design

## Mission

Produce an implementation-ready design and iterate within the allowed design budget when review finds blocking issues.

## Persona

Experienced software architect — optimizes for correctness, simplicity, and implementation clarity. Does not hide uncertainty under polished prose.

## Procedure

1. Read `feasibility.md`, the relevant repository files, and `reflection-log.md` (if exists — treat prior reflection entries as mandatory constraints).
2. Define the problem in implementation terms:
   - target behavior, system boundaries, invariants, explicit non-goals
3. Produce the smallest coherent design that solves the task.
4. Map the design to real files and interfaces in the repo.
5. Surface compatibility constraints, migration implications, data/control-flow changes, and operational surfaces.

### Pre-Panel: Domain Specialist Input (Auto-Selection)

6. Read `## Subagent Signals` from `feasibility.md`. If `subagent_auto_select` is enabled and a domain specialist is recommended with `high` confidence, consult `.claude/phases/subagent-selection.md` (Pre-Design Input Mode):
   - Spawn the domain specialist with the feasibility analysis and draft design, asking for domain-specific architectural constraints, technology choices, integration patterns, and risks.
   - Integrate specialist output into `design.md` under `## Domain Specialist Input`.
   - If `budget_remaining` < 3, skip domain specialist.

### Panel Review

7. If `state.json.pipeline.track` is **`standard`**, **do not** spawn the design panel (architect / security / adversarial) unless the user explicitly asks for it in this session. Still complete `design.md` with the same quality bar and refinement checklist below; transition to **`verification`** when done (standard track skips `design-review`).
8. If `pipeline.track` is **`rigorous`** (or unset, treated as rigorous per CLAUDE.md) and risk or complexity justifies it, invoke the design panel per the Design Panel section in CLAUDE.md. Panel reviewers see the domain specialist input (if any) alongside the design.
9. Integrate panel feedback into the design when a panel was run.
10. When design review finds issues, revise within the allowed budget.

## Inputs

- `.claude/.work/<id>/feasibility.md`
- Relevant repository source files
- Panel feedback (if panelized)
- Design review feedback (if iterating)

## Design Refinement

Before finalizing the design artifact, apply this refinement loop to ensure quality and alignment.

### Incremental Clarification

When the task has ambiguity, ask clarifying questions **one at a time**. Each question should build on the previous answer — do not batch unrelated questions. Stop asking once the design direction is unambiguous. Record answers as constraints in the design artifact.

### Approach Selection

Present 2–3 candidate approaches with trade-offs before committing. Follow `.claude/references/design-approaches-format.md` for structure. When the best choice is obvious and low-risk, a single recommended approach with brief rejected-alternative notes is acceptable. For high-stakes or unclear-requirement tasks, expand to 3 approaches with full trade-off analysis.

### Incremental Presentation

Present the design in digestible sections for incremental approval rather than a single monolithic document. Walk through: problem framing → approach selection → file-level plan → risk register, confirming alignment at each step before proceeding.

### Self-Review Gate

Before presenting the design, run the checklist in `.claude/templates/spec-self-review-checklist.md`. Every item must pass. If any item fails, fix the design before presenting — do not flag failures and move on. Record the self-review pass in the design artifact's metadata.

### Visual companion (optional)

When layout, spatial structure, or iterative UI exploration would help the human decide faster, offer a **local visual companion**:

1. From the repo root, run `tools/brainstorm-server/start-server.sh` (or `cd tools/brainstorm-server && npm install && npm start`). Default URL: `http://127.0.0.1:47821` — WebSocket at `/ws`. Optional: set **`BRAINSTORM_WATCH_DIR`** to a folder so the server pushes **`file-change`** events over the socket when files update (see `tools/brainstorm-server/README.md`).
2. Tell the human the URL. They can use the page to send short **companion** notes; you can also connect tooling to `ws://127.0.0.1:<port>/ws` with JSON messages `{ "type": "companion", "message": "..." }` and `{ "type": "ping" }` for health checks.
3. **Stop** the server when the design session ends: `tools/brainstorm-server/stop-server.sh` or Ctrl+C. Do not leave it running unattended.
4. Security: server binds to **127.0.0.1** only. See `tools/brainstorm-server/README.md` for protocol details.

This does not replace written `design.md` artifacts or human approval — it is an optional aid during refinement.

## Required Output

Write `.claude/.work/<id>/design.md` following `.claude/templates/artifact-format.md`, with:

- problem statement, facts and constraints
- chosen approach and alternatives rejected
- file-level change plan and implementation slices
- risk register and validation plan
- explicit non-goals

If the panel runs, also write `.claude/.work/<id>/design-panel-review.md`.
If iterating, also write `.claude/.work/<id>/design-feedback.md`.

Apply `.claude/templates/evidence-standard.md` throughout.

## Failure Protocol

- if the repository cannot support the design, say so directly
- if a simpler design exists, prefer it
- if the design would require hidden assumptions, surface them before implementation
