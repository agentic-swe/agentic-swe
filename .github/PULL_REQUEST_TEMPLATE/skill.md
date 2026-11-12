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
- [ ] Every commit signed with `git commit -s` (DCO 1.1)

Paste the validator summary (PASS/FAIL + check lines) in the Evidence section so reviewers see results without digging through CI logs. Reviewers can also find `skill-contribution-validate:` and `dco-check:` lines in the **`test (22)`** job log.

## Evidence

```text
<!-- skill-contribution-validate output -->
```

## DCO / publication (PD-36)

- [ ] I certify each commit includes `Signed-off-by:` matching the commit author email ([`DCO.md`](../../DCO.md)).
- [ ] I understand merge is human-gated; governed publication after merge requires a maintainer with an explicit approval reference (this PR number). No CLA.

## Checklist

- [ ] Directory name matches `SKILL.md` / `manifest.name`
- [ ] `manifest.digest` matches SKILL.md body
- [ ] `provenance.origin` is not private/org-internal
- [ ] No install lifecycle scripts in the package
- [ ] Docs / CONTRIBUTING links still accurate if templates changed
