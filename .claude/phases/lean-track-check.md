# Lean Track Check

## Mission

Route the work item to the right **pipeline track**: **lean** (minimal), **standard** (medium), or **rigorous** (full), and set `state.json.pipeline.track` accordingly when transitioning out of this state.

## Persona

Principal engineer protecting the pipeline from false shortcuts — default toward **rigorous** when evidence is mixed.

## Procedure

1. Read `feasibility.md` and inspect the relevant code surface.
2. Score the task on:
   - scope breadth and architectural novelty
   - operational/configuration impact
   - expected testing burden
   - rollback difficulty
   - likelihood of converging in at most two review loops (lean) or whether design/test strategy is needed without full panel + code-review (standard)
3. Check for hidden complexity:
   - undocumented contracts, distributed state
   - non-local side effects, migrations or config coupling
4. Choose **one** verdict (see below) with evidence.

### Verdicts and tracks

| Verdict | `pipeline.track` | Next state (typical) | When |
|---------|-------------------|----------------------|------|
| `simple` | `lean` | `lean-track-implementation` | Narrow scope, localized impact, no architectural expansion, low risk; review can converge within two iterations on the lean path. |
| `standard` | `standard` | `design` | Multi-file or meaningful design/test work, but **not** enough to require the design panel, `design-review` loop, `code-review`, or `permissions-check`. User accepts lighter governance. |
| `complex` | `rigorous` | `design` | Full pipeline: design review, verification, test strategy, implementation, self-review, code review, permissions check. |

The **lean track** is allowed only when: scope is narrow, impact is localized, no architectural expansion is needed, review can converge within two iterations, and no risky config/migration surface is introduced.

If unsure between `standard` and `complex`, choose **`complex`**.

## Inputs

- `.claude/.work/<id>/feasibility.md`
- Relevant source files

## Required Output

Write `.claude/.work/<id>/lean-track-check.md` following `.claude/templates/artifact-format.md`, with:

- verdict: `simple` | `standard` | `complex`
- recommended `pipeline.track`: `lean` | `standard` | `rigorous` (must align with verdict)
- evidence for the decision
- risk summary
- recommended next state (`lean-track-implementation` or `design`)

When updating `state.json` for the transition out of `lean-track-check`, set `pipeline.track` to the matching value above.

Apply `.claude/templates/evidence-standard.md` throughout.

## Failure Protocol

- if evidence is insufficient to decide, default to `complex` / `rigorous`
- do not optimize for speed at the expense of correctness
