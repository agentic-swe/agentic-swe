# Contributing to agentic-swe

Thanks for your interest. This document covers how to propose changes to the **pack repository** (CI, skills, docs, pipeline). Downstream projects that *install* the pack follow their own Git process.

## Before you start

1. Read [`docs/branch-workflow.md`](docs/branch-workflow.md) for branch naming and PR targets (`main` only).
2. Use Node **22+** (`engines.node` in `package.json`).
3. Run **`npm run verify`** and **`npm test`** before every push.
4. Sign every commit with the [Developer Certificate of Origin](DCO.md) (`git commit -s`).

Issue templates: [bug](.github/ISSUE_TEMPLATE/bug_report.md) · [feature](.github/ISSUE_TEMPLATE/feature_request.md) · [skill submission](.github/ISSUE_TEMPLATE/skill_submission.md).  
PR templates: [default](.github/PULL_REQUEST_TEMPLATE.md) · [skill](.github/PULL_REQUEST_TEMPLATE/skill.md).

Full skill contribution guide: [`docs/skill-contribution.md`](docs/skill-contribution.md).

## Developer Certificate of Origin (PD-36)

This project uses **DCO 1.1** (no CLA). By contributing you certify the statements in [`DCO.md`](DCO.md) (also at https://developercertificate.org/).

Sign-off is a **contributor attestation**, not a cryptographic signature: CI
checks that `Signed-off-by:` is present and that its email matches the commit
author. It does not verify keys or prove identity beyond that match.

Sign off each commit so the trailer matches the commit author email:

```bash
git commit -s -m "feat(skills): add my-skill"
# Trailer written by -s:
# Signed-off-by: Your Name <you@example.com>
```

CI runs `node scripts/dco-check.cjs --require-commits` on the PR commit range inside the required **`test (22)`** check. Commits already on `main` are not re-checked. Merge commits are skipped; every other commit (including maintainer/agent commits) must carry a matching `Signed-off-by`. An empty PR range (0 commits checked) fails closed. **Merge Queue is not enabled** on this repo, so DCO is not run on `merge_group` events (documented in [`DCO.md`](DCO.md)).

## Skill contributions (AE-028a / AE-028b)

External contributors submit skills via a **fork → PR** path. Automated validation and DCO run in CI; a human reviews and merges; a maintainer then publishes through the governed path (human approval record required). There is no silent private→public promote (§16).

### End-to-end path

1. **Fork** this repository and clone your fork.
2. **Add** a skill package (layout below) on a topic branch.
3. **Sign off** every commit: `git commit -s`.
4. **Open a PR** to `agentic-swe/agentic-swe` `main` using the [skill PR template](.github/PULL_REQUEST_TEMPLATE/skill.md).
5. **Automated validation** runs in `test (22)`: `npm run verify` (includes skill-contribution self-check) and `npm test`, plus the DCO range check on PR commits.
6. **Human review** on GitHub (Approve / Request changes). Optional worklog receipt is fine; the review decision is the record.
7. **Maintainer merge** (squash-merge under FD-B / ruleset).
8. **Governed publication** (maintainer only): after merge, publish with an explicit approval reference (merged PR number):

```bash
node scripts/skill-external-publish.cjs \
  --registry /path/to/local-registry \
  --source path/to/my-skill \
  --actor maintainer:<id> \
  --approval-ref PR#123 \
  --expected-digest <sha256-from-manifest>
```

Publication refuses blank actor/approval, digest mismatch, and `provenance.origin` values that mark private/org knowledge. Versions are immutable; the tag convention is `skill/<name>/v<semver>` (PD-30). No signing service.

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
# DCO on your branch commits (example vs origin/main):
node scripts/dco-check.cjs origin/main..HEAD
```

See [`docs/skill-contribution.md`](docs/skill-contribution.md) for field requirements, digest computation, reviewer CI tips, and publication gates.

## Code contributions

- Prefer small, reviewable PRs with tests that fail without the change.
- Respect `config/layers.json` (zero dependency cycles; no `service → runtime`).
- No `shell: true`; child processes use argv + minimal env patterns already in the pack.
- Do not commit `.worklogs/`, `bench/results/*.json`, or `test/_tmp-*`.
- Always `git commit -s` (DCO).

## License

Contributions are under the [MIT](LICENSE) license of this repository. Skill contribution legal terms for external authors are the DCO 1.1 (PD-36); no CLA.
