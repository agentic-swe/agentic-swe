# Skill contribution workflow (AE-028a / AE-028b)

External fork-PR submission, DCO 1.1 sign-off, automated validation, human-gated merge, and governed publication (PD-36). AI-assisted review stays optional and off by default (PD-9: no paid LLM).

## Status (PD-36)

| Capability | Status |
|---|---|
| Issue / PR templates for skill submission | Available |
| Local + CI validation (manifest, digest, contract tests) | Available (`npm run verify` / `npm test`) |
| DCO 1.1 (`Signed-off-by` on each commit) | Required — attestation (not crypto); [`DCO.md`](../DCO.md); CI `dco-check --require-commits` on PR ranges; merge queue N/A |
| External contributor → governed skill publish | Available — human approval record required; no silent private→public (§16) |

## End-to-end path

1. Fork → clone → branch.
2. Add skill package (`SKILL.md` + `manifest.json` + optional `contract.test.js`).
3. Commit with `git commit -s` (DCO trailer must match author email — attestation, not a cryptographic signature).
4. Open PR with [`.github/PULL_REQUEST_TEMPLATE/skill.md`](../.github/PULL_REQUEST_TEMPLATE/skill.md).
5. CI (`test (22)`): verify (contribution self-check) + tests + **DCO check** (`--require-commits`) on `base_sha..head_sha` (commits already on `main` are not re-checked; empty ranges fail closed). Merge Queue is not enabled, so there is no `merge_group` DCO pass.
6. Human review on GitHub; optional worklog receipt.
7. Maintainer squash-merge under FD-B.
8. Maintainer runs governed publish with `--actor` + `--approval-ref` (merged PR number) and matching digest.

## Templates (linked)

| Template | Path |
|---|---|
| Contributing (skills + DCO) | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| DCO 1.1 text | [`DCO.md`](../DCO.md) |
| Skill submission issue | [`.github/ISSUE_TEMPLATE/skill_submission.md`](../.github/ISSUE_TEMPLATE/skill_submission.md) |
| Skill pull request | [`.github/PULL_REQUEST_TEMPLATE/skill.md`](../.github/PULL_REQUEST_TEMPLATE/skill.md) |
| Default PR template | [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) |

When opening a skill PR on GitHub, choose the **skill** PR template (or append `?template=skill.md` to the compare URL).

## Package requirements

A contribution directory must contain:

1. **`SKILL.md`** — YAML frontmatter with `name` matching the directory name (`^[a-z0-9-]{1,64}$`).
2. **`manifest.json`** — ADR-010 [`schemas/skill-manifest.schema.json`](../schemas/skill-manifest.schema.json). Required fields include name, version, description, inputs, outputs, dependencies, permissions, runtime, compatibility, validation, provenance, maintainer.
3. **`manifest.digest`** — sha256 hex of the SKILL.md **body** (after frontmatter). Blank or missing digests fail closed. Body changes without updating the digest fail `DIGEST_MISMATCH`.
4. **`contract.test.js`** (optional) — when present, must pass under `node --test`.

Banned: `postinstall.js` / `install.js` / `preinstall.js`, and `package.json` with `scripts` (same supply-chain rule as registry install).

For external publication, set `provenance.origin` to a public-safe value such as `third-party`. Origins that mark private/org knowledge (`private`, `org`, `org-private`, `internal`, `confidential`) are **refused** at publish time (§16).

### Compute a digest

```bash
node -e "
const fs = require('fs');
const { digestSkillBody } = require('./scripts/lib/skills/skill-integrity.cjs');
console.log(digestSkillBody(fs.readFileSync('path/to/SKILL.md', 'utf8')));
"
```

Put the hex string in `manifest.json` as `"digest"`.

## Validation CLI

```bash
# One or more contribution directories
node scripts/skill-contribution-validate.cjs path/to/my-skill

# Machine-readable
node scripts/skill-contribution-validate.cjs --json path/to/my-skill

# CI self-check: good fixture passes; deliberately broken fixtures fail
node scripts/skill-contribution-validate.cjs --self-check
```

`npm run verify` runs `--self-check` so the required GitHub check **`test (22)`** shows pass/fail lines for each fixture (`skill-contribution-validate: PASS|FAIL …` plus per-check rows). Unit coverage lives in `test/skill-contribution-validate.test.js` (also under `npm test`).

## DCO CLI

```bash
# Against the PR base (CI uses pull_request.base.sha..head.sha)
node scripts/dco-check.cjs <base>..<head>

# Machine-readable
node scripts/dco-check.cjs --json <base>..<head>
```

Fails if any non-merge commit lacks a `Signed-off-by:` trailer whose email matches that commit's author email (case-insensitive). Output lines start with `dco-check: PASS|FAIL`.

## Governed publication (maintainer)

```bash
node scripts/skill-external-publish.cjs \
  --registry /path/to/local-registry \
  --source path/to/my-skill \
  --actor maintainer:<id> \
  --approval-ref PR#123 \
  --expected-digest <sha256>
```

| Gate | Code when refused |
|---|---|
| Blank / missing actor | `ACTOR_REQUIRED` |
| Blank / missing approval reference | `APPROVAL_REQUIRED` |
| Blank package digest | `DIGEST_MISSING` |
| `--expected-digest` blank | `DIGEST_EXPECTED_BLANK` |
| Digest mismatch | `DIGEST_MISMATCH` |
| Private/org `provenance.origin` | `PRIVATE_PROVENANCE_FORBIDDEN` |

Success records the publish in the local registry audit log with `approval_ref`, immutable version + digest, and tag ref `skill/<name>/v<semver>` (PD-30). This CLI does **not** push remotes or create GitHub Releases.

## Fixtures

Under `test/fixtures/skill-contribution/`:

- `good/contrib-good-example` — must pass validation
- `broken-digest`, `broken-manifest`, `blank-digest`, `corrupt-manifest`, `missing-skill-md`, `broken-contract` — must fail

Under `test/fixtures/skill-external-contribution/`:

- `good/contrib-external-example` — third-party origin; used by the offline dry-run path
- Commit-message fixtures for DCO unit tests (signed / unsigned / email mismatch)

## Reviewer notes — reading CI

1. Open the PR check **`test (22)`** → job log.
2. **Contribution validator:** search for `skill-contribution-validate:` (`PASS`/`FAIL` + per-check rows). Also emitted during `npm run verify`.
3. **DCO:** search for `dco-check:` (`PASS`/`FAIL`, checked/skipped counts, failing SHAs, including `DCO_EMPTY_RANGE`). Only runs on `pull_request` events (`--require-commits`); merge queue is not enabled.
4. Record the decision with a **GitHub review** (Approve / Request changes). An optional worklog receipt may link the PR; it does not replace the review.
5. Merge still follows FD-B / CODEOWNERS on `main`. Publication after merge is a separate maintainer step with `--approval-ref`.
