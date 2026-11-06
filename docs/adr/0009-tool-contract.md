# ADR-009 — Tool contract, declared permissions, argv execution, sandbox profiles

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-001, ADR-006, ADR-008, ADR-014

## Context

`scripts/lib/work-engine/acceptance.cjs` already models the contract direction: argv, `shell: false`, fail-closed metacharacter checks, and a timeout. Review found four problems with the proposed wording:

- "Sandbox profiles" had no definition and no M2 acceptance item.
- Argv execution is not a sandbox. Allow-listed binaries can still run arbitrary code (`git -c alias.x='!sh'`, `core.hooksPath`, repo hooks, `node -e`, and `npm test` / `npm run` executing agent-editable scripts).
- In in-host mode, the host's native shell and edit tools never go through the runner.
- Permission vocabularies and journals overlap: `Permission` lacked `npm.publish`, which `PRIVILEGED_ACTIONS` has, and `github-calls.jsonl` is a second hash chain.

`shell: true` survives in `descent/replay.cjs` and `bench/score-dimension.cjs`, and `execSync` string-building survives in several more files. Children inherit the full environment, including `GITHUB_TOKEN`.

## Decision

Every tool the pack executes is a `Tool` with a schema-valid `ToolManifest`. Execution is argv-only (`shell: false`) and uses `acceptance.cjs`'s metacharacter and allowlist rules as the reference. Children start from an empty environment plus an allow-list, and a secret enters a child only via a declared `secrets.read:<name>` granted by the policy engine. Its value is registered with the redactor.

**Argv is a hygiene control, not a sandbox.** Each allow-list entry fixes the binary and an argument schema. Code-execution and config-injection forms are rejected: `git -c`, `core.hooksPath`, `alias.*`, `--upload-pack`, `node -e/--eval`, `npx`. Git runs with system and global config disabled and hooks disabled. Entries that execute repository-defined scripts (`npm test`, `npm run`) declare `proc.exec:arbitrary-code`, which the policy engine classifies high-risk.

**Sandbox profile (M2):** a declarative per-manifest envelope that the runner enforces before spawn: cwd root, `fs.write` globs, env allow-list, net hosts, exec allow-list ids, timeout, output cap. It is not OS isolation. OS or container isolation is deferred to open question M2-Q6.

**Permissions:** `Permission` includes `PRIVILEGED_ACTIONS` (`github.branch.push`, `github.pr.write`, `npm.publish`). Privileged permissions need a `work authorize` grant, which the ADR-006 policy engine checks against the concrete argv, host, or path, never the manifest alone. Any permission used but not declared is denied. `fs.write` globs are matched after `realpath` against a pinned root. `.worklogs/**`, `.git/hooks/**`, `.git/config`, policy files, and manifests are always denied. `net:<host>` is enforced per request, including redirects, by HTTP connectors; subprocess egress is reported as unenforced in M2.

**Registry:** manifests are policy-class files. The registry digest is pinned outside the agent's write scope, and a mismatch fails closed. **Any tool call that does not resolve to a registered, digest-matched manifest is denied.** There is no fallback path.

**Results:** `ToolResult` adds `pending_approval`, `tool_id`, `tool_version`, `idempotency_key`, `duration_ms`, `policy_decision_ref`, a sha256 per output ref, `partial`, and `effects: none|applied|unknown`. A timeout on a tool with `side_effects ≠ none` yields `effects: unknown`, which is never auto-retried. Remote non-idempotent tools reconcile via a read before any retry and journal `tool.reconciled`. A local idempotency key is not remote idempotency. Tool events go into `journal.jsonl`; `github-calls.jsonl` is frozen as verified read-only legacy.

**Migration:** typed-actions `RUN` gains `argv[]` and the string `command` is deprecated. Every `shell: true` / `execSync` under `scripts/` moves to the runner: `descent/replay.cjs`, `bench/score-dimension.cjs`, `sync/git-sync.cjs`, `scope/diff-scope-check.cjs`, `memory/style-profile.cjs`, `fleet-submit.cjs`, `seed-memory-corpus.cjs`. (`cross-model/probe.cjs` was retired by AE-019a in favor of `scripts/lib/model-gateway/`.) A CI lint blocks new ones.

**Applicability (ADR-001):** in hosted mode, enforced for every runner-dispatched call. In in-host mode, enforced only for pack-executed tools; host-native tools stay cooperative and are evaluated through the pre-tool hook mapping only.

## Consequences

- AE-021a/b carry the `effects` / `partial` / `pending_approval` fields, reconcile-before-retry, a digest-pinned registry with default-deny, empty-env children, and code-execution flag rejection.
- The eight `shell: true` / `execSync` sites listed above are ported, and a CI lint keeps new ones out.

## Alternatives

- Per-call containers: deferred to M2-Q6.
- Host-native tools only: rejected, because there is no contract.
