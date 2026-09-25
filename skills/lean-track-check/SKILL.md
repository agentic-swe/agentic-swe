---
name: lean-track-check
description: "Pipeline phase skill for state `lean-track-check`. Use when current_state is lean-track-check."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-state-machine"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/lean-track-check.md"
---

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
4. Run the advisory Jev track hint. It writes `pipeline.jev_track` and leaves `pipeline.track` unchanged. See `${CLAUDE_PLUGIN_ROOT}/references/jev.md`.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/jev-track-hint.cjs --project-root <repo> --plugin-root ${CLAUDE_PLUGIN_ROOT}
```

5. Choose **one** verdict (see below) with evidence. Read `pipeline.jev_track` beside the Adaptive Track Router field `pipeline.track_recommendation`. When `jev_track.skipped` is set (`disabled`, `missing_key`, `timeout`, `http_error`, `invalid_response`, or `low_confidence`), choose the track from this phase heuristic and ATR. When Jev, ATR, and the heuristic disagree, record the disagreement and any `caution` in `lean-track-check.md`.

### Verdicts and tracks

| Verdict | `pipeline.track` | Next state (typical) | When |
|---------|-------------------|----------------------|------|
| `simple` | `lean` | `lean-track-implementation` | Narrow scope, localized impact, no architectural expansion, low risk; review can converge within two iterations on the lean path. |
| `standard` | `standard` | `design` | Multi-file or meaningful design/test work, but **not** enough to require the design panel, `design-review` loop, `code-review`, or `permissions-check`. User accepts lighter governance. |
| `complex` | `rigorous` | `design` | Full pipeline: design review, verification, test strategy, implementation, self-review, code review, permissions check. |

The **lean track** is allowed only when: scope is narrow, impact is localized, no architectural expansion is needed, review can converge within two iterations, and no risky config/migration surface is introduced.

If unsure between `standard` and `complex`, choose **`complex`**.

## Inputs

- `.worklogs/<id>/feasibility.md`
- Relevant source files

## Required Output

Write `.worklogs/<id>/lean-track-check.md` following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, with:

- verdict: `simple` | `standard` | `complex`
- recommended `pipeline.track`: `lean` | `standard` | `rigorous` (must align with verdict)
- evidence for the decision
- risk summary
- recommended next state (`lean-track-implementation` or `design`)

When updating `state.json` for the transition out of `lean-track-check`, set `pipeline.track` to the matching value above.

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This is clearly simple — lean track." | Familiarity with a problem space does not mean the implementation is simple. Check for hidden dependencies, test burden, and rollback difficulty. |
| "Standard is good enough — rigorous is overkill." | If the task touches security, data migration, or public APIs, rigorous track catches issues that standard skips (design-review, code-review, permissions-check). |
| "We can always upgrade the track later." | Track upgrades mid-pipeline waste work already done under the lighter track's assumptions. Get it right here. |

## Red Flags

- Verdict is "simple" but the task touches more than 3 modules or requires database schema changes.
- No complexity score or rationale provided — just a bare verdict.
- ATR recommendation disagrees with the heuristic and the disagreement is not documented.
- `pipeline.jev_track.caution` is set, or Jev disagrees with ATR or the heuristic, and `lean-track-check.md` does not record it.
- Track set to lean for a task in a security-sensitive directory when policy rules require rigorous.

## Failure Protocol

- if evidence is insufficient to decide, default to `complex` / `rigorous`
- do not optimize for speed at the expense of correctness
