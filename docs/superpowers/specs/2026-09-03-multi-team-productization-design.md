# Multi-team, multi-person productization — Design Spec

**Status:** Locked for implementation planning (2026-09-03)
**Authors:** Productization goal (local-first, git-native workspaces)
**Related:** [`docs/specs/memory-graph.md`](../../specs/memory-graph.md), [`docs/PUBLISHING.md`](../../PUBLISHING.md), [`docs/specs/positioning-and-receipt.md`](../../specs/positioning-and-receipt.md), [`skills/fleet/SKILL.md`](../../../skills/fleet/SKILL.md)

---

## 1. Problem

`agentic-swe` is already an installable plugin (`@agentic-swe/agentic-swe`, Claude marketplace, Cursor local plugin) with evaluated skills, a local memory graph, and a fleet ingest pipeline. It is **not yet a team product**.

What works for one maintainer on one laptop:

| Capability | Today | Breaks for N people / M teams |
|---|---|---|
| Install | Plugin dir / `npm i -g` / Cursor symlink | Each person copies tribal env vars; no `whoami` |
| Memory | Personal `~/.agentic-swe` + project SQLite + `work_id=team` chunks | Team chunks are unlabeled events; no member identity; HMAC default `local-dev` |
| Sync | Git branch `agentic-swe-memory` via worktree | No pull/merge CLI; events deleted after export; no ACL |
| Skills | Pack skills + per-repo `.agentic-swe` scaffolds | No versioned skill pull between teammates |
| Fleet | JSON file copy → maintainer ingest | Maintainer is a person, not an org role |
| Work items | `state.json.owner` is a free string (`claude`) | No handoff, watchers, or attested human gates |
| CLI | `path` / `version` / `receipt` / `goal` | Product surface is `npm run` from the pack checkout |

**Non-goal:** Hosted SaaS control plane. Positioning remains customer-owned `.worklogs/` and local SQLite. A cloud runtime would collapse the receipt/audit moat.

## 2. Product thesis

**agentic-swe is a local-first team runtime, not a chat plugin.**

One CLI (`agentic-swe`) is the product. IDEs remain hosts. A **workspace** is a git repo (or a small org of repos) that declares members, roles, and sync policy in `.agentic-swe/workspace.json`. Personal muscle memory never leaves the laptop unless a person explicitly publishes a redacted event. Team muscle memory travels as **signed, redacted events** on a dedicated git branch. Skills travel as **versioned, evaluated packages** referenced by the workspace, not as ad-hoc file copies.

ICP for this slice: **a 4–30 person engineering team** sharing 1–N git repos, already using Claude Code or Cursor, that wants shared SWE rituals without standing up a new SaaS.

## 3. Approaches considered

| Approach | What it is | Trade-off |
|---|---|---|
| **A. Hosted org cloud** | Identity, skill registry, memory sync as a service | Fast invites; kills local-first moat; compliance lift |
| **B. Git-native workspaces (chosen)** | Workspace file + signed events on `agentic-swe-memory` + CLI | Works offline; uses existing git ACLs; slower invites |
| **C. Skills-only marketplace** | npm/git skill packages, no team memory | Easy to ship; does not make multi-person SWE actually shared |

**Decision:** B for v1, with C as the distribution mechanism *inside* B (workspace skill pins). Optional HTTP transport is an adapter behind the same event schema, not a product rewrite.

## 4. Architecture

```
┌──────────────┐     host (Claude/Cursor)     ┌─────────────────┐
│ Person laptop│◄── hooks / slash commands ──►│ agentic-swe CLI │
│ ~/.agentic-swe│                              │  team/skill/sync│
│  personal DB │                              └────────┬────────┘
└──────────────┘                                       │
                                                       ▼
                              ┌────────────────────────────────────┐
                              │ Repo: .agentic-swe/                │
                              │  workspace.json  (members, roles)  │
                              │  memory.sqlite   (gitignored)      │
                              │  procedures.json (local cache)     │
                              │  skills/         (pinned copies)   │
                              │  sync/events/    (outgoing queue)  │
                              └─────────────────┬──────────────────┘
                                                │ git push/pull
                                                ▼
                              branch agentic-swe-memory (events only)
```

### 4.1 Identity

- **Person id** = `actor_id`: stable string `email:<normalized git user.email>` or explicit `AGENTIC_SWE_ACTOR`.
- **Display name** from `git config user.name`.
- No passwords. Trust git remote permissions + HMAC secret stored in `.agentic-swe/sync.secret` (gitignored) or `AGENTIC_SWE_SYNC_SECRET`.
- Default HMAC `local-dev` is **rejected** once a workspace has `members.length >= 2`.

### 4.2 Workspace

`.agentic-swe/workspace.json` (committed):

```json
{
  "schema_version": 1,
  "workspace_id": "emea-enablement",
  "display_name": "EMEA Enablement",
  "members": [
    { "actor_id": "email:ada@example.com", "role": "admin" },
    { "actor_id": "email:bob@example.com", "role": "engineer" }
  ],
  "skill_pins": [
    { "name": "fleet", "version": "1.0.0", "source": "pack" }
  ],
  "sync": {
    "branch": "agentic-swe-memory",
    "require_signed_events": true
  }
}
```

Roles: `admin` | `engineer` | `readonly`.

- `admin`: invite/remove members, rotate sync secret instructions, ingest fleet for the workspace.
- `engineer`: create work, publish team events, pull/push skills that are already pinned.
- `readonly`: memory prime + receipts only.

### 4.3 Memory scopes (must not collapse)

| Scope | Store | Who writes | Who reads |
|---|---|---|---|
| `personal` | `~/.agentic-swe/memory.sqlite` | that person | that person |
| `session` | host transcript distill | that person | that person (optional team publish) |
| `repo` | project sqlite `work_id` = work item | owner + engineers | workspace members after sync |
| `team` | project sqlite `work_id=team` **plus** `actor_id` on typed nodes | engineers via signed events | workspace members |

Prime payload order: personal (small) → team digest → repo graph. Personal style never auto-promotes to team.

### 4.4 Event schema (sync)

Replace unlabeled `{kind,label}` blobs with:

```json
{
  "schema_version": 1,
  "id": "uuid",
  "ts": "ISO-8601",
  "actor_id": "email:ada@example.com",
  "workspace_id": "emea-enablement",
  "kind": "procedure-mined | skill-promoted | work-completed | member-joined",
  "payload": {},
  "redacted": true,
  "sig": "hmac-sha256"
}
```

HMAC covers canonical JSON of all fields except `sig`. Pull merges by `id` (existing `mergeEvents`) then **verify sig** before ingest. Failed sig → skip + counter.

### 4.5 Skills as team packages

- Pack skills stay in the plugin.
- Workspace may pin extra skills under `.agentic-swe/skills/<name>/` with `SKILL.md` frontmatter `version` + `eval_status`.
- `agentic-swe skill pull` copies pinned evaluated skills from the sync branch or a git URL.
- Unevaluated skills are flagged at session start (existing skill-eval path) and **cannot** be pinned for the team.

### 4.6 Multi-person work

Keep `state.json.owner` as the current actor string, but write:

- `actors.owner_id` = `actor_id`
- `actors.watchers[]`
- history entries already have `actor`; require `actor_id` on **new** transitions when workspace is active.

Handoff: `agentic-swe work handoff --work-id X --to email:bob@...` appends history and sets owner. Not a new state-machine edge.

### 4.7 Install / onboarding (the product)

One path for a teammate:

```bash
npm install -g @agentic-swe/agentic-swe
cd <repo>
agentic-swe team join --invite invite.json   # or: team init
agentic-swe doctor
```

`invite.json` is the existing fleet invite **plus** workspace member stub + sync-branch instructions. Cursor/Claude plugin install remains as today (`docs/PUBLISHING.md`); CLI is the team layer.

### 4.8 Fleet vs team

Fleet submissions stay **repo → maintainer pack** evidence for the OSS project.

Team product is **people inside one consumer repo** sharing memory/skills.

Do not mix: a teammate joining `emea-enablement-guide` is not a new independent fleet consumer. Fleet-scale still counts distinct git project roots.

## 5. Error handling

- Missing workspace file → CLI works in **solo mode** (today’s behavior).
- Unknown `actor_id` on publish → error: run `team join` or `team whoami`.
- HMAC mismatch → skip event, `doctor` reports `unsigned_or_forged_events`.
- Skill pin unevaluated → `doctor` blocker, no pull.
- Git not available → queue locally; `sync push` no-ops with reason (already true).

## 6. Testing

All new modules are Node test files under `test/`, no LLM. Fixture: two temp homes + one temp git repo proving A’s team event is primed for B and A’s personal chunk is not.

## 7. Out of scope (v1)

- Hosted accounts, SSO, billing
- Real-time CRDT memory
- Slack/Jira as source of truth (receipts may still link)
- Changing fleet-scale honesty rules
- VS Code/JetBrains native extensions (north-star pillar; separate spec)

## 8. Success criteria

1. Two developers on one repo can `team join`, complete `/work`, and the second session’s `memory-prime` shows the first’s **redacted team** event and not their personal style profile.
2. `agentic-swe` CLI exposes `team`, `sync`, `skill`, `doctor` without requiring a pack git checkout as cwd.
3. `npm test` covers identity, HMAC reject of `local-dev` at ≥2 members, event verify, handoff, skill-pin eval gate.
4. Docs: PUBLISHING + a short “Teams” page describing solo vs workspace.
