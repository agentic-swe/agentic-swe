# Design Approaches Format

How to present candidate design approaches with trade-offs during the design phase.

## When to Present Multiple Approaches

- **3 approaches**: High-stakes decisions, unclear requirements, or multiple viable architectures with materially different trade-offs.
- **2 approaches**: Moderate uncertainty — one strong candidate but a reasonable alternative worth considering.
- **1 approach with rejected-alternative notes**: Obvious best choice with low risk. Briefly note why alternatives were dismissed.

Do not manufacture options for the sake of appearing thorough. If only one approach makes sense, say so and explain why.

## Structure Per Approach

Use this skeleton for each candidate:

```markdown
### Approach N: <Descriptive Name>

**Description**: 2–4 sentences explaining the approach, its architecture, and how it solves the problem.

**Pros**:
- <concrete benefit with evidence or reasoning>
- <concrete benefit>

**Cons**:
- <concrete drawback with severity: minor | moderate | significant>
- <concrete drawback>

**Fits best when**: <conditions under which this approach wins>
```

## Recommendation Section

After presenting all approaches, add a recommendation:

```markdown
### Recommendation

**Selected**: Approach N — <name>

**Rationale**: Ground the recommendation in evidence from the repository, feasibility analysis, or task constraints. Cite specific facts (existing patterns, dependency compatibility, performance requirements) rather than subjective preference.

**Key risk of this choice**: <the most important trade-off accepted>

**Mitigation**: <how the risk is managed>
```

## Framing Guidelines

- Lead with facts, not opinions. "The codebase already uses pattern X in 4 modules" beats "I think pattern X is better."
- Quantify when possible — lines changed, dependencies added, performance impact.
- Be honest about uncertainty. If two approaches are genuinely close, say so.
- The recommendation should be reversible — note what would trigger reconsideration.
- If the human selects a non-recommended approach, proceed without friction. Record the decision and rationale.
