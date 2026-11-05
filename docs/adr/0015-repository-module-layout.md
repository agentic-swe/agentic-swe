# ADR-015 — Repository and module layout

- **Status:** Accepted (decision text replaced from the RFC proposal; the one-repo choice is kept)
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-002, ADR-016

## Context

The RFC proposed a monorepo with `packages/@autoeng/*` and enterprise modules in a separate private repository. Review found:

- The RFC assumed M1 would turn `scripts/lib/work-engine/*` into a facade over a kernel package. It did not: there is no `packages/`, no `workspaces` field, and no `@autoeng` reference in the code.
- Workspaces resolve through `node_modules` symlinks that git-sourced plugin installs (`source: "./"`) never create, and the root `files` list omits `packages/`. Extraction would be an unplanned migration of about 30 lib dirs and 146 tests competing with AE-019..AE-023.
- The `@autoeng` npm scope is unverified, which creates a dependency-confusion risk; the unscoped `agentic-swe` npm name already belongs to another publisher.
- "Enterprise in a separate private repo" presumes an open-core model and a brand name that are still open founder and counsel decisions.
- A `runtime` module name would collide with the existing `scripts/lib/runtime/` host adapters.

The founder deferred the `@autoeng` npm scope.

## Decision

**Decision 1 (repository):** AutoEng runtime code stays in `agentic-swe/agentic-swe`. A repo rename is revisited at M6, after trademark clearance.

**Decision 2 (layout for M2):** New M2 modules (AE-019..AE-023) are built in place under `scripts/lib/<module>/` as CommonJS (language per ADR-002). Each module exposes one `index.cjs` facade, and cross-module imports go only through facades, enforced by the ADR-016 layering lint. No npm workspaces and no `packages/` directory in M2. The hosted runtime module is named so it does not collide with the existing `scripts/lib/runtime/` host adapters. **Rationale:** M1 did not create the RFC facade, and the marketplace `source: "./"`, `install.sh`, and the `files` list all assume one package resolved from root `node_modules`.

**Decision 3 (future extraction):** extracting code into workspace packages is a separate ADR and work item. Entry criteria:

- a verified npm scope (`@autoeng` registered by the founder with 2FA, or the existing `@agentic-swe` scope)
- a chosen resolution model (relative in-repo paths with `packages/` in `files`, or published and pinned packages; never registry resolution from a git install)
- CI checks for `npm pack` contents, `--plugin-dir` load, and `install.sh` install
- trusted publishing with provenance from a protected tag workflow
- explicit `files` per package and CODEOWNERS entries for security-critical packages

**`@autoeng` npm scope: deferred.** No `@autoeng/*` name appears in any published or committed manifest until the scope is verified under the brand decision.

**Not decided here:** package scope and brand naming (trademark clearance), and whether proprietary or enterprise modules exist or where they live (open-core decision, founder + counsel). This ADR does not presume any open-core option.

## Consequences

- M2 code lives under `scripts/lib/<module>/` with an `index.cjs` facade per module.
- When workspaces are adopted later, the private repo (if any) gets a ruleset, secret scanning, and push protection before its first commit, depends one way on the public packages, and public CI holds no enterprise secrets.

## Alternatives

- `packages/@autoeng/*` workspaces in M2: rejected for M2 (breaks git-sourced installs; scope unverified).
