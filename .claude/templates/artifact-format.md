# Artifact Format

Cite this template when writing phase artifacts to ensure consistent structure.

## Standard Structure

```markdown
# <Phase Name>

## Inputs
- what was read or received

## Findings
- observations, analysis, and evidence-backed conclusions
- follow `.claude/templates/evidence-standard.md` for evidence quality

## Verdict
- clear decision: approved, rejected, blocked, simple, complex, etc.
- confidence level when applicable

## Evidence Basis
- specific files, commands, outputs, or documentation that support the verdict

## Recommended Next State
- the state transition this artifact supports
- any conditions or caveats
```

## Rules

- every artifact must have a verdict — commentary without a decision is not sufficient
- evidence basis must reference concrete sources, not general reasoning
- recommended next state must be a valid transition per the state machine in CLAUDE.md
