# Skill contribution workflow (AE-028a)

Templates + automated validation for skill packages. **This is not an external publication path.**

## Status (PD-6 / PD-32)

| Capability | Status |
|---|---|
| Issue / PR templates for skill submission | Available |
| Local + CI validation (manifest, digest, contract tests) | Available (`npm run verify` / `npm test`) |
| External contributor → public skill publish | **Deferred** until founder decision **PD-6** (DCO vs CLA; employer IP). Tracked as AE-028b / PD-32. |

There is **no** CLA text, DCO bot, or automated publish-to-registry step in this milestone. Do not treat a green validation check as authorization to publish third-party skills.

## Templates (linked)

| Template | Path |
|---|---|
| Contributing (skills section) | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
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

## Fixtures

Under `test/fixtures/skill-contribution/`:

- `good/contrib-good-example` — must pass
- `broken-digest`, `broken-manifest`, `blank-digest`, `corrupt-manifest`, `missing-skill-md`, `broken-contract` — must fail

## Reviewer notes

- Validation visibility = CI log output from verify/test (no separate required check).
- Merge still follows FD-B / CODEOWNERS on `main`.
- First-party maintainer promotion inside the pack is separate from external publication (see ADR-010).
