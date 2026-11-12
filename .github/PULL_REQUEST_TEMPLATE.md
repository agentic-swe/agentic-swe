## Problem

<!-- What broke or what's missing? Be specific. -->

## What changed

<!-- 1-3 sentences describing the change. -->

## Scope

- [ ] Core pipeline (phases, agents, commands, templates)
- [ ] Subagent definitions
- [ ] Skill contribution (use [skill PR template](PULL_REQUEST_TEMPLATE/skill.md); see [docs/skill-contribution.md](../docs/skill-contribution.md))
- [ ] Documentation only
- [ ] Tests only
- [ ] Other: <!-- describe -->

<!-- Skill PRs: external publication waits on PD-6 — validation only until then. -->

## Testing done

<!-- Which phases/commands were affected? How did you verify? -->
- [ ] Ran `npm test` (static + CLI tests pass)
- [ ] Manually tested affected phases
- [ ] Verified cross-references resolve (`test/references-integrity.test.js`)

## Evidence

<!-- If modifying phase prompts or agents: show before/after behavior per evidence-standard.md -->

## Checklist

- [ ] I have reviewed my own changes
- [ ] No new linter warnings introduced
- [ ] Documentation updated if needed
