# Evaluation rubric (reference)

Used by **self-review** and optionally **completion** / **evaluate-work** for consistent scoring. Dimensions align with `${CLAUDE_PLUGIN_ROOT}/phases/self-review.md` (1–3 scale).

| Dimension | 1 | 2 | 3 |
|-----------|---|---|---|
| Correctness | Wrong or incomplete behavior | Happy path correct | Edge cases handled |
| Safety | Unsafe failure modes | Major paths covered | Defensive throughout |
| Test adequacy | Missing or trivial | Happy path tested | Edge + error paths |
| Design conformance | Large deviation | Minor, documented | Faithful |
| Complexity | Overbuilt | Acceptable | Simplest viable |

**Work-item metrics (optional):** Under `.worklogs/<id>/`, you may add `metrics-summary.md` with dimension scores and notes for cross-run tracking. Not required for state transitions.
