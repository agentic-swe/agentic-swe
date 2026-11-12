---
name: Skill submission
about: Propose a new or updated skill package (fork PR + DCO; governed publish after merge)
labels: enhancement
---

## Skill name

<!-- Directory / manifest name: ^[a-z0-9-]{1,64}$ -->

## Summary

<!-- What does this skill do? Who is it for? -->

## Package checklist

- [ ] `SKILL.md` with frontmatter `name` matching the directory
- [ ] `manifest.json` validates against `schemas/skill-manifest.schema.json`
- [ ] `manifest.digest` is sha256 of the SKILL.md body and is up to date
- [ ] Optional `contract.test.js` passes under `node --test`
- [ ] Ran `node scripts/skill-contribution-validate.cjs <path>` locally (exit 0)
- [ ] Commits will be signed with `git commit -s` (DCO 1.1)

## Permissions / kind

<!-- prompt/phase/docs may use permissions: []. Execution kinds need explicit non-empty permissions. -->

## DCO (PD-36)

External contributions use the [Developer Certificate of Origin](../../DCO.md) (no CLA). Opening this issue does not publish; open a fork PR with signed-off commits. After human review and merge, a maintainer publishes with an explicit approval reference.

## Links

- Guide: [`docs/skill-contribution.md`](../../docs/skill-contribution.md)
- Contributing: [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
