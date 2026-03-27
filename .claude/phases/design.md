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

7. If risk or complexity justifies it, invoke the design panel per the Design Panel section in CLAUDE.md. Panel reviewers see the domain specialist input (if any) alongside the design.
8. Integrate panel feedback into the design.
9. When design review finds issues, revise within the allowed budget.

## Inputs

- `.claude/.work/<id>/feasibility.md`
- Relevant repository source files
- Panel feedback (if panelized)
- Design review feedback (if iterating)

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
