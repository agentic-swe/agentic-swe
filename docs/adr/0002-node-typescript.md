# ADR-002 — Node.js + TypeScript; incremental migration of existing CJS

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-009, ADR-015

## Context

About 35k lines of CommonJS already exist, and every host hook runs `node`. Hosts run `scripts/*.cjs` straight from the git tree: the Claude marketplace entry uses `source: "./"`, hooks are declared in `hooks/hooks.json`, and `install.sh` installs with `--omit=dev --ignore-scripts`, so no build step ever runs on a user machine. The repository has no `tsconfig`, no `.ts` file, and no `typescript` dependency. The policy hook that runs before each tool call has a 10 s timeout, so a runtime transpiler on that path could turn into a deny or a crash. `engines.node` said `>=18`, CI tested only Node 20 and 22, and Node 20 reached upstream end-of-life on 2026-04-30.

## Decision

Node.js is the implementation runtime.

**Supported floor:** Node 22 LTS; `engines.node` is `>=22`. CI tests Node 22 only. Adding another line (for example Node 24) is a separate change that also adds its required status check. A line is dropped within one minor release of its upstream end-of-life.

New modules for AE-019..AE-023 may be authored in TypeScript restricted to erasable syntax (no enums, namespaces, or decorators). A pinned `tsc` compiles them to CommonJS `.cjs`. **Only compiled JavaScript executes.** No TypeScript loader (`ts-node`, `tsx`, `--experimental-strip-types`) appears on any hook, CLI, `bin`, or runtime path.

**Compiled output is committed**, and CI fails if a fresh compile differs from the committed output. Git-sourced and npm-sourced installs therefore run identical, reviewed JavaScript without a build. No TypeScript exists in the repository at acceptance, so there is nothing to compile yet: the fresh-build comparison check and `tsc --noEmit` in `npm run verify` land in the same PR that introduces the first TypeScript source, and that PR may not merge without them.

Existing `.cjs` stays authoritative and may gain `// @ts-check` + JSDoc. Converting an existing file is a dedicated PR that changes no behavior and preserves the file's path and export shape. Host entry points keep their paths. Tests stay `*.test.js` and run against compiled output. Build-time dependencies are limited to pinned `typescript` and `@types/node`, and the CI audit covers dev dependencies once they exist.

This ADR does not decide module location (ADR-015). Node provides no in-process sandbox: tool execution follows ADR-009, and `vm`, `eval`, and dynamic `require` of agent-supplied paths are forbidden.

## Consequences

- Node 20 is no longer supported or tested.
- `node:sqlite` (Node ≥ 22.5) becomes available, but ADR-004 still excludes SQLite in M2.
- Every TypeScript PR carries both the source and its compiled `.cjs`; reviewers review both.

## Alternatives

- Go, Rust, or Python: rejected, because they would rewrite ~35k LOC and host hooks run Node.
- Plain JS + JSDoc `checkJs` only: kept as the fallback.
- Compiled output built in `prepack` instead of committed: rejected, because git-sourced installs would not work.

## Rollback

Delete the TypeScript sources and keep the compiled `.cjs`; runtime behavior does not change.
