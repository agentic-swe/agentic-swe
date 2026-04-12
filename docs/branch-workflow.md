# Branch workflow (this repository)

## Scope (read first)

- This document is **only for people and agents working on the agentic-swe pack repository itself** (this GitHub project: CI, `main`, rulesets).
- It is **not** a requirement for **downstream projects** that install or use the **agentic-swe Claude Code plugin**. Those repos follow their own Git process; the Hypervisor pipeline in **`CLAUDE.md`** is about **how to run work items**, not about mandating branch names in every consumer repo.

## Agents: staging and commits

**Do not run `git add` or otherwise stage changes until the user has confirmed** what should be staged (file list or intent) in the current conversation, unless they have **explicitly** asked you to stage or commit in this session.

---

Use the workflow below for **any code or config change** in **this** **agentic-swe** repo on GitHub. **Topic branches** (for example **`feature/*`**, **`bugfix/*`**, **`chore/*`**, **`hotfix/*`**, **`dependabot/*`**) may open **pull requests directly into `main`**. There is **no** separate **`uat`** staging branch in this flow.

## Branch from `main` (normal work)

For **feature**, **bugfix**, **bug-fix**, and **chore** work, create the topic branch from **`origin/main`** (or rebase onto it before opening a PR) so the PR is easy to review and merge.

- **`hotfix/*`** also branches from **`main`** and targets **`main`** when the fix is urgent.

## Branch roles

| Kind | Pattern | Purpose |
|------|---------|---------|
| Release | `main` | Production-ready; **no direct pushes** — merge via PR only. |
| Feature | `feature/<short-kebab-topic>` | New capability. |
| Bugfix | `bugfix/<short-kebab-topic>` or `bug-fix/<short-kebab-topic>` | Defect fixes. |
| Hotfix | `hotfix/<short-kebab-topic>` | Urgent fix; PR to **`main`**. Still run tests before push. |
| Maintenance | `chore/<short-kebab-topic>` | Tooling, CI, docs batches. |

Avoid ad-hoc branch names (`dev`, `temp`, …) unless they use an allowed prefix above.

## Standard flow

1. `git fetch origin`. Branch from **`origin/main`**:

   `git checkout -b feature/my-change origin/main` (or `bugfix/…`, `chore/…`).

2. Implement and commit on the topic branch.

3. Before **every** push (repo root): **`npm test`**. If you touched **`site/`** (or site tooling): also **`npm run lint --prefix site`** and **`npm run build --prefix site`**.

4. Push and open a PR into **`main`**:

   `gh pr create --base main --head <your-branch> --title "…" --body "…"`

## Hotfix flow

1. Branch from **`main`**: `git checkout -b hotfix/critical-fix origin/main`
2. Fix, test (`npm test`, plus site checks if applicable), push.
3. PR to **`main`**: `gh pr create --base main --head hotfix/critical-fix …`

## Who may merge into `main`

**GitHub does not read this markdown file.** To ensure **only `@surajSFDC`** can merge PRs into **`main`**, configure the **repository on GitHub**:

1. **Collaborators and permissions** — Grant **Write** (or **Maintain** / **Admin** only as needed) **only** to **`surajSFDC`**. Users without **Write** cannot merge pull requests.
2. **Branch protection / rulesets on `main`** — Keep **Require a pull request before merging**, required status checks (**`test (20)`**, **`test (22)`**, **`main-merge-source`**, …), and **Require review from Code Owners** if you use **[`.github/CODEOWNERS`](../.github/CODEOWNERS)** (this repo uses `* @surajSFDC` so reviews route to the owner).
3. **Optional** — Restrict who can dismiss reviews or push to **`main`** in the same ruleset.

The workflow **[`.github/workflows/main-merge-source.yml`](../.github/workflows/main-merge-source.yml)** is a **required check** that records the PR head; it **does not** block any head branch. Merge control is **access control + branch rules** in GitHub.

## Maintainer hygiene (this repo)

- **Git author:** personal project — use **Suraj Gupta** / **`10187486+surajSFDC@users.noreply.github.com`** (or another email verified on **surajSFDC**). Set with `git config` for this repo only; do not use a corporate identity for commits here.
- **npm:** run from repo root so **[`.npmrc`](../.npmrc)** applies (`registry=https://registry.npmjs.org/`).

## GitHub rulesets

| Branch | Notes |
|--------|--------|
| `main` | [Rules](https://github.com/surajSFDC/agentic-swe/rules): PR required, code owners as configured, CI **`test (20)`** / **`test (22)`**, **`main-merge-source`**, no force-push. Adjust **who has merge rights** in repo settings as above. |

## Hypervisor pipeline (plugin) vs this Git workflow

- **`CLAUDE.md`** describes the **Hypervisor** state machine, phases, and artifacts when the pack runs **inside some project** (plugin installed). That is **orthogonal** to the **branch / PR rules above**, which exist **only** to govern **this repository’s** GitHub lifecycle.
- Per-work state in a **target** project may live under **`.worklogs/<id>/`** or **`.claude/.work/<id>/`** depending on install; that is **not** the same as “use a `uat` branch” — the latter is **not** used for this repo anymore.
