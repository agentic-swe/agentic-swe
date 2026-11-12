# Contributing to agentic-swe

Thanks for your interest. This document covers how to propose changes to the **pack repository** (CI, skills, docs, pipeline). Downstream projects that *install* the pack follow their own Git process.

## Before you start

1. Read [`docs/branch-workflow.md`](docs/branch-workflow.md) for branch naming and PR targets (`main` only).
2. Use Node **22+** (`engines.node` in `package.json`).
3. Run **`npm run verify`** and **`npm test`** before every push.

Issue templates: [bug](.github/ISSUE_TEMPLATE/bug_report.md) · [feature](.github/ISSUE_TEMPLATE/feature_request.md) · [skill submission](.github/ISSUE_TEMPLATE/skill_submission.md).  
PR templates: [default](.github/PULL_REQUEST_TEMPLATE.md) · [skill](.github/PULL_REQUEST_TEMPLATE/skill.md).

Full skill contribution guide: [`docs/skill-contribution.md`](docs/skill-contribution.md).

## Skill contributions (AE-028a)

You may prepare and validate a skill package locally and open a PR that adds or updates skills. Automated validation (manifest schema, content digest, optional contract tests) runs in CI via `npm run verify` / `npm test`.

**External publication of third-party skills is not open yet.** Publishing contributor skills into a public registry / release channel waits on founder decision **PD-6** (DCO vs CLA; employer IP). Until then:

- Do **not** expect a CLA, DCO bot, or external publish path in this repository.
- Maintainer-only first-party promotion inside the pack remains the governed path.
- Validation results are visible in the required CI check **`test (22)`** (verify + test output).

### Package layout

```text
my-skill/
  SKILL.md           # required — frontmatter name must match directory
  manifest.json      # required — ADR-010 schema; digest required
  contract.test.js   # optional — node:test; must exit 0 when present
```

### Validate locally

```bash
node scripts/skill-contribution-validate.cjs path/to/my-skill
# Fixture self-check (also part of npm run verify):
node scripts/skill-contribution-validate.cjs --self-check
```

See [`docs/skill-contribution.md`](docs/skill-contribution.md) for field requirements, digest computation, and the PD-6 notice.

## Code contributions

- Prefer small, reviewable PRs with tests that fail without the change.
- Respect `config/layers.json` (zero dependency cycles; no `service → runtime`).
- No `shell: true`; child processes use argv + minimal env patterns already in the pack.
- Do not commit `.worklogs/`, `bench/results/*.json`, or `test/_tmp-*`.

## License

Contributions are under the [MIT](LICENSE) license of this repository. Skill **publication** legal terms for external authors remain deferred (PD-6); submitting a PR does not open an external publication channel.
