# Control-plane adoption

**Status:** Revised for the landed Jev advisory; ready for review
**Date:** 2026-09-26

This design adds a native security and installation control plane to Agentic SWE, then sequences the remaining capability work behind it. The implementation is clean-room: concepts are expressed in Agentic SWE's own architecture, commands, and evidence model. No upstream source, skill text, or branding is copied.

## Locked decisions

| Decision | Choice |
|---|---|
| Architecture | Native modules behind the existing `agentic-swe` CLI |
| Adoption method | Clean-room reimplementation |
| Skill catalog | Selective capabilities, with `core` remaining the current portable pack |
| Security gate | Critical findings block setup; lower severities warn; `--accept-risk "<reason>"` records a receipt |
| Existing installs | Adopt only files whose SHA-256 matches the shipped pack; preserve every modified or unknown file |
| Delivery order | Security and lifecycle, then profiles, then context and host reporting, then memory trust |
| Jev boundary | Jev stays a fail-open advisory signal. It cannot block, clear, or override the deterministic security gate |

## Goal

A user can install, inspect, repair, update, and remove Agentic SWE without losing unrelated files or Jev, memory, and routing overrides. Setup refuses to write when the agent execution surface contains a critical risk, and every acceptance of such a risk is recorded. Later profiles, context reports, and memory promotion use the same installation inventory. The landed Jev advisory in `references/jev.md` remains a separate fail-open classifier for track, model-tier, and shortlist hints.

## Slice 1 — Security preflight and install lifecycle

### Architecture

`bin/agentic-swe.cjs` remains the only command entry point. Two libraries sit behind it:

- `scripts/lib/agent-surface/` scans policies, hooks, MCP configuration, permissions, agents, skills, and secrets.
- `scripts/lib/install-state/` records exactly which files an installation owns.

`setup` builds its plan, scans the existing destination and planned writes, and writes files only after the gate passes. `doctor` reports manifest presence, hash drift, the latest scan result, and whether the Jev advisory is disabled, missing its key, or ready. Doctor never calls TypeSafe and never prints `TYPESAFE_API_KEY`.

## Coordination with the Jev advisory

Jev already ships in `scripts/lib/jev/`, `config/jev.default.json`, `scripts/jev-track-hint.cjs`, and `references/jev.md`. Its three seams advise track selection, model tier, and shortlist order. Missing, failed, and low-confidence results fall back to the local routers. This control plane does not edit those seams.

| Surface | Rule |
|---|---|
| Shipped Jev files | `core` owns them because they belong to the portable pack, including `config/jev.default.json`, `scripts/lib/jev/`, `scripts/jev-track-hint.cjs`, and `references/jev.md` |
| `.agentic-swe/jev.json` | User override. Setup, repair, update, and uninstall preserve it |
| `TYPESAFE_API_KEY` | A literal key in a scanned file is `secret-hardcoded`. A missing key is the existing fail-open state, not a finding |
| Security gate | Deterministic and fail-closed for critical findings. Jev cannot downgrade or accept a finding |
| Scan and setup | They do not send file contents, findings, or receipts to the Jev endpoint |
| Memory | `actor=jev` audit lines and `pipeline.jev_track` remain advisory evidence. Memory promotion cannot turn them into replayable procedures |

### Scanner

`scanSurfaces({ roots, plannedWrites })` returns `{ findings, summary }`. It is deterministic and makes no model call. Every finding has:

| Field | Meaning |
|---|---|
| `id` | Stable finding identifier |
| `rule` | Stable rule identifier |
| `severity` | `critical`, `high`, `medium`, or `low` |
| `path` | Repository-relative or destination-relative path |
| `line` | 1-based line number |
| `evidence` | Short excerpt supporting the finding |
| `message` | Operator-facing explanation |

Critical rules, all of which block setup:

| Rule | Condition |
|---|---|
| `secret-hardcoded` | High-confidence credential or private-key material in a policy, hook, MCP, agent, skill, or Jev config file |
| `permission-unrestricted-shell` | An allow rule grants unrestricted shell execution |
| `hook-command-injection` | A hook interpolates untrusted tool input into a shell command |
| `policy-auto-run-unsafe` | Instructions direct the agent to bypass permission prompts or automatically run destructive commands |

High, medium, and low findings are included in the result and do not block setup. The initial non-blocking set is:

| Severity | Rule | Condition |
|---|---|---|
| High | `permission-missing-deny` | Permissions define broad allows without a deny boundary |
| High | `mcp-autoinstall` | An MCP server launches through an unpinned automatic package install |
| Medium | `hook-hidden-failure` | A hook suppresses command failure output |
| Low | `mcp-missing-description` | A configured MCP server has no description |

The scanner reads planned content before it is written, so a critical planned file blocks the transaction with no destination changes.

### Install state

Each destination has one manifest, `<destination>/install-state.json`. A repository destination is `<repo>/.agentic-swe/`, so its manifest is `<repo>/.agentic-swe/install-state.json`. A Cursor destination is `~/.cursor/plugins/local/agentic-swe/`, so its manifest is directly inside that plugin directory. The manifest schema is:

```json
{
  "schema_version": 1,
  "installer_version": "3.3.1",
  "host": "cursor",
  "profile": "core",
  "files": [{ "path": "commands/work.md", "sha256": "<hex>" }],
  "edits": [],
  "external_registrations": [],
  "last_scan": {
    "status": "clean",
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "receipt": null
  }
}
```

`path` is relative to the destination. The manifest, `install-receipts/`, `node_modules/`, and `.git/` are installer or generated data and are excluded from ownership classification. Runtime state is also excluded and always preserved. These paths are relative to the install destination, which is `<repo>/.agentic-swe/` for a repository:

- `jev.json`
- `memory.sqlite`, `memory.sqlite-shm`, and `memory.sqlite-wal`
- `procedures.json`
- `catalog.json` and `catalog-embeddings.json`
- `model-routing.json`
- `skills/` created for the project

`core` is the current portable pack discovered from the shipped entries. It includes the Jev files already in the pack. It does not freeze a file list that would drop later pack additions.

A Claude Code native plugin registration is recorded as an external registration because its cache is owned by Claude Code. A newly created `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `opencode.json` is a fully owned file. An existing file that setup updates is recorded in `edits`, not `files`:

| Edit type | Uninstall behavior |
|---|---|
| `policy-append` | Remove the appended policy only when the bytes after the existing begin marker still exactly match the shipped policy |
| `json-plugin-entry` | Remove the object whose `name` and `entry` exactly match the recorded OpenCode entry |
| `gitignore-line` | Remove one exact `.worklogs/` line |

If the current file no longer contains that exact edit, uninstall preserves the file and reports it. The manifest also records external registrations as `{ "host": "claude-code", "id": "agentic-swe@agentic-swe-catalog" }`; uninstall prints the host-native removal command and does not delete the host cache.

### Commands

| Command | Behavior |
|---|---|
| `agentic-swe scan [--target <repo>] [--json]` | Scan a destination and print findings |
| `agentic-swe setup` | Plan, scan, write, then record the manifest |
| `agentic-swe list-installed [--target <repo>] [--json]` | Show owned, drifted, and preserved files |
| `agentic-swe repair [--target <repo>] [--dry-run]` | Restore drifted owned files and adopt exact hash matches |
| `agentic-swe update [--target <repo>] [--dry-run]` | Replace owned files from the current pack and record new hashes |
| `agentic-swe uninstall [--target <repo>] [--dry-run]` | Remove owned files whose current hash matches the manifest |
| `agentic-swe doctor` | Add manifest, drift, last-scan, and Jev readiness checks to the existing doctor output |

`setup --accept-risk "<reason>"` is valid only when the reason is non-empty. It writes `<destination>/install-receipts/<timestamp>.json` containing the timestamp, command, reason, and critical finding IDs, paths, rules, and evidence. For a repository install, that path is `<repo>/.agentic-swe/install-receipts/<timestamp>.json`. The manifest's `last_scan.receipt` points to that file and its status is `accepted-risk`.

### Data flow

1. Resolve the target and hosts, then build the `core` file plan. `--dry-run` prints the plan and returns.
2. Scan the existing destination and every planned write.
3. Stop before the first write when a critical finding has not been accepted.
4. Write planned files while recording only files created by this transaction.
5. Write the manifest last.
6. `list-installed` and `doctor` recalculate hashes and classify files as `current`, `drifted`, or `preserved`.
7. `repair` adopts an unmanaged file only when its hash equals the shipped pack, restores drifted owned files, and preserves everything else.
8. `update` refreshes owned files and their hashes.
9. `uninstall` deletes an owned file only when its current hash matches the manifest.

### Error handling

- Invalid input, an unsupported host, an empty risk reason, or a corrupt manifest exits non-zero before writes.
- A copy or dependency-install failure deletes only files created by the current transaction and leaves the destination without a new manifest.
- A manifest write failure rolls back that same transaction.
- Repair reports an individual unreadable file and continues with the remaining files.
- Uninstall preserves a drifted owned file. It removes the manifest only after every hash-matching owned file has been removed.
- Doctor exits non-zero for a missing required destination or corrupt manifest. Drift and lower-severity findings stay visible as advisory results.
- The existing repository-root and Cursor checkout protections remain in force.

### Slice 1 tests

Use `node:test` and temporary directories. Tests must not call a model, install packages, or write outside their temporary directory.

- Scanner: one clean fixture and one fixture for each critical rule; non-blocking behavior for high, medium, and low findings.
- Setup: a critical finding prevents all planned writes; a valid risk acceptance writes the installation and receipt; an empty reason exits non-zero; a failed copy rolls back only transaction-created files.
- Install state: manifest creation, drift, exact-hash adoption, preservation of modified and unknown files, repair, update, and uninstall.
- Legacy destination: adopt hash-identical files and preserve every other file.
- Commands: `scan`, `list-installed`, `repair`, `update`, `uninstall`, and doctor manifest checks, including `--dry-run` and `--json`.
- Existing setup safeguards: non-root repository refusal and refusal to replace a Cursor plugin checkout.
- Jev coordination: a literal API key in `.agentic-swe/jev.json` is critical; a missing key is clean; setup and uninstall preserve `jev.json`; doctor reports Jev readiness without calling TypeSafe or printing the key.

## Slice 2 — Profiles and selective capabilities

Add `scripts/lib/install-state/profiles.cjs` and `config/capability-profiles.json`. `resolveProfile(profileId)` returns the file list used by setup.

| Profile | Contents |
|---|---|
| `minimal` | Policy, state machine, work commands, phases, work engine, schemas, templates, and session-start hook. Jev is omitted because its absence already falls back to local routers |
| `core` | Current portable pack, including shipped Jev files; remains the default |
| `full` | `core` plus capabilities explicitly listed in the config |

`setup --profile <name>` selects the list. `setup --with capability:<id>` adds one configured capability to `minimal` or `core`. The first configured capabilities are the security scanner, context budget, and memory-trust commands built by these slices. Unknown profile or capability IDs exit non-zero before writes. Tests verify the exact file list, rejection of unknown IDs, and the guarantee that `core` preserves the current pack.

## Slice 3 — Context budget and host parity

`agentic-swe context-budget --target <repo> [--json]` reads the selected profile inventory and reports estimated tokens for policy files, agent description frontmatter, skills, MCP tool schemas, and the fixed Jev session-hint text. The command uses a documented estimator: prose at words × 1.3 and each MCP tool schema at 500 tokens. Jev's capped task text is reported separately and is not added to the always-loaded total. Its output names the total, the per-component totals, and the three largest savings opportunities. `AGENTIC_SWE_JEV=0` may appear as a savings opportunity; it is not a security finding.

`agentic-swe host-parity [--json]` reports each supported host as `stable`, `partial`, or `instruction-only` from the capabilities setup actually configures. Doctor includes the summary. Tests use fixed fixtures so estimates and host statuses are deterministic.

## Slice 4 — Memory trust

Extend memory and procedure records with `source`, `scope`, `confidence`, `last_confirmed`, and `external`. Confidence decays when a record is not reobserved within its configured window. This confidence is independent of Jev's `choice_confidence_min`. Memory or procedures acquired from an external import start in quarantine and cannot be replayed. Audit records with `actor=jev` and `pipeline.jev_track` stay advisory evidence and are ineligible for procedure promotion. Promotion of eligible memory requires two independent confirmations or an explicit human approval, recorded in the existing evidence trail. Tests cover decay, quarantine, rejection of quarantined replay, rejection of Jev-derived promotion, and both human promotion paths.

## Sequencing and success criteria

Implement the slices in order. A slice is complete when its tests pass and its command behavior matches this specification. Slice 1 must land before profile selection changes any installation contents. Slice 1 also leaves the landed Jev client, track hint, model-tier hint, catalog rerank, skill-route hint, and `lean-track-check` phase unchanged.

The work is successful when:

- Critical agent-surface risks block a new installation unless a receipt records the acceptance reason.
- Repair, update, and uninstall act only on provably owned files.
- A legacy installation adopts exact matches and preserves user changes.
- `core` remains backward compatible.
- Context and host reports are generated from the installation inventory.
- External memory cannot influence replay before promotion.

## Out of scope

- Copying or vendoring upstream skills, hooks, or scanner source.
- Loading the full specialist catalog into every session.
- A continuous before-tool hook runtime as the primary enforcement layer.
- Cryptographic signing of installation receipts.
- Automatic cloud upload of scan results or diagnostics.
- Sending setup plans, findings, or receipts to the Jev endpoint.
- Using Jev to select a track, accept a security finding, or replace the deterministic scanner.
