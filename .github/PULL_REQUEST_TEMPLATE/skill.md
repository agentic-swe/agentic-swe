## Skill contribution

<!-- Which skill directory/directories? -->

## Problem

<!-- Why add or change this skill? -->

## What changed

<!-- Manifest fields, body, contract tests. -->

## Validation

- [ ] `node scripts/skill-contribution-validate.cjs <skill-dir>` exits 0
- [ ] `npm run verify` (includes skill-contribution self-check)
- [ ] `npm test`

Paste the validator summary (PASS/FAIL + check lines) in the Evidence section so reviewers see results without digging through CI logs.

## Evidence

```text
<!-- skill-contribution-validate output -->
```

## PD-6 / publication

- [ ] I understand this PR is **validation + review only**. External skill publication waits on PD-6 (AE-028b deferred). No CLA/DCO/publish step is part of this workflow.

## Checklist

- [ ] Directory name matches `SKILL.md` / `manifest.name`
- [ ] `manifest.digest` matches SKILL.md body
- [ ] No install lifecycle scripts in the package
- [ ] Docs / CONTRIBUTING links still accurate if templates changed
