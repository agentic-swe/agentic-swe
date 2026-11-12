---
name: Skill submission
about: Propose a new or updated skill package (validation only; no external publish yet)
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

## Permissions / kind

<!-- prompt/phase/docs may use permissions: []. Execution kinds need explicit non-empty permissions. -->

## PD-6 notice

External publication of third-party skills is **deferred** until founder decision PD-6 (DCO vs CLA; employer IP). Opening this issue / a follow-up PR runs **validation only** — it does not publish to a public skill registry.

## Links

- Guide: [`docs/skill-contribution.md`](../../docs/skill-contribution.md)
- Contributing: [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
