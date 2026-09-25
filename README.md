<h1 align="center">Agentic SWE</h1>

<p align="center"><strong>Claude codes your PRs. You review the receipt. Then merge.</strong></p>

<p align="center">
  <a href="https://github.com/agentic-swe/agentic-swe/actions/workflows/ci.yml"><img src="https://github.com/agentic-swe/agentic-swe/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node" /></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-3.3.1-orange.svg" alt="Version" /></a>
  <!-- catalog-counts:start kind=badge-line -->
  <a href="#subagents"><img src="https://img.shields.io/badge/subagents-138%2B-purple.svg" alt="Agents" /></a>
<!-- catalog-counts:end -->
  <a href="https://agentic-swe.github.io/agentic-swe-site/"><img src="https://img.shields.io/badge/docs-site-informational.svg" alt="Docs site" /></a>
</p>

An open-source autonomous SWE pipeline that runs in your editor or CI, writes every decision into your repo, and gives you a shareable audit trail of what the AI did and why.

**What you get:**

- **Structured PRs** — Claude works through a state machine (lean / standard / rigorous), not one mega-prompt
- **Cost-attributed decisions** — every phase has a dollar amount and an artifact in `.worklogs/<id>/`
- **Audit trail** — `/receipt` renders a shareable summary suitable for a PR description, Slack, or a compliance ticket

## Quickstart

```bash
curl -fsSL https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/install.sh | bash
agentic-swe setup
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/install.ps1 | iex
agentic-swe setup
```

Then in Claude Code:

```text
/work Add retry logic to the API client
# ...pipeline runs, opens a PR...
/receipt
```

→ See [Install & first run](#install--first-run) for Cursor, Codex, OpenCode, Gemini CLI, and Claude Code plugin marketplace alternatives.

## What `/receipt` looks like

`/receipt` reads `.worklogs/<id>/` and renders the work item as markdown. Sample from `test/fixtures/receipt/lean-happy/`:

```markdown
# /work add-retry-logic — Add retry logic to the API client

| Field | Value |
|---|---|
| Work ID | add-retry-logic |
| Track | lean |
| Status | completed |
| Duration | 47 min |
| Cost | $1.84 |
| PR | https://github.com/example/repo/pull/142 |

## Decisions made (6)

1. **feasibility → lean-track-check** ($0.08) — lean signal → feasibility.md#L1-L20
2. **lean-track-check → lean-track-implementation** ($0.04) — verdict: simple
3. **lean-track-implementation → validation** ($1.33) — implementation complete → implementation.md
4. **validation → pr-creation** ($0.21) — tests green
5. **pr-creation → approval-wait** ($0.18) — PR opened
6. **approval-wait → completed** ($0.00) — approved by suraj

## Human gates respected (1)

- `approval-wait` resolved by user at 2026-05-17T14:47:00Z — approved by suraj

## Loop counters

- `self_review_iter`: 0
- `doubt_cycles`: 1
- `code_review_iter`: 0

## Verifiable references

- All artifacts: `test/fixtures/receipt/lean-happy/`
- Audit log: `test/fixtures/receipt/lean-happy/audit.log` (9 entries)
```

Every line above is computed from `.worklogs/<id>/` — no LLM summary, no hallucinated PRs. Reproduce locally:

```bash
node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy
```

**Docs:** [agentic-swe.github.io/agentic-swe-site](https://agentic-swe.github.io/agentic-swe-site/)

---

## Pipeline at a glance

After **feasibility**, **`lean-track-check`** sets **`pipeline.track`** in **`state.json`**. Tracks merge into **PR creation** → **`approval-wait`** → **completed**.

```mermaid
%%{init: {'theme': 'dark', 'fontFamily': 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif'}}%%
flowchart TD
    start(["/work — start or resume"])
    feasibility["feasibility"]
    check{"lean-track-check<br/>sets pipeline.track"}
    lean["Lean track<br/>lean-track-implementation<br/>validation · pr-creation"]
    std["Standard track<br/>design → verification → test-strategy<br/>implementation → self-review<br/>validation · pr-creation"]
    rig["Rigorous track<br/>design → design-review<br/>verification → test-strategy<br/>implementation → self-review<br/>code-review → permissions-check<br/>validation · pr-creation"]
    gate{{"approval-wait<br/>human gate"}}
    done(["completed"])

    start --> feasibility --> check
    check -->|lean| lean
    check -->|standard| std
    check -->|rigorous| rig
    lean --> gate
    std --> gate
    rig --> gate
    gate --> done

    classDef accent fill:#1f6feb,stroke:#58a6ff,color:#ffffff,stroke-width:2px
    classDef step fill:#21262d,stroke:#30363d,color:#e6edf3,stroke-width:1px
    classDef branch fill:#21262d,stroke:#388bfd,color:#c9d1d9,stroke-width:2px
    classDef decide fill:#21262d,stroke:#d29922,color:#ffdfb8,stroke-width:2px
    classDef gateNode fill:#21262d,stroke:#a371f7,color:#e6edf3,stroke-width:2px

    class start,done accent
    class feasibility step
    class check decide
    class lean,std,rig branch
    class gate gateNode
```

Canonical transitions: **`state-machine.json`** and the fenced graph in **`CLAUDE.md`** (checked in CI).

---

## Install & first run

Beyond the [Quickstart](#quickstart) above, alternate paths:

**Claude Code (plugin marketplace)**

```text
/plugin marketplace add agentic-swe/agentic-swe
/plugin install agentic-swe@agentic-swe-catalog
```

**Other hosts**

| Host | How |
|------|-----|
| **Cursor** | `agentic-swe setup --host cursor` |
| **VS Code** | `agentic-swe setup --host vscode` |
| **Codex** | `agentic-swe setup --host codex` |
| **OpenCode** | `agentic-swe setup --host opencode` |
| **Antigravity** | `agentic-swe setup --host antigravity` |
| **Gemini CLI** | `gemini-extension.json` · **`GEMINI.md`** |

Run setup from the root of the git repository you want to configure. It refuses any other directory, shows the target and the planned changes, and waits for confirmation. `--yes` skips the question. `--dry-run` only prints the plan. Run setup without `--host` to auto-detect installed hosts, or use `--host all`. Run `agentic-swe doctor` to verify an installation. Maintainers see [`docs/PUBLISHING.md`](docs/PUBLISHING.md).

→ [Full installation guide](https://agentic-swe.github.io/agentic-swe-site/docs/installation) · [Golden path (~15 min)](https://agentic-swe.github.io/agentic-swe-site/docs/golden-path)

---

## Commands

| Command | Role |
|---------|------|
| `/work` | Start or resume a work item |
| `/plan-only` | Feasibility / design without implementation |
| `/brainstorm` | Design-first exploration (optional UI server) |
| `/write-plan` · `/execute-plan` | Plan bar then execution |
| `/check budget` · `/check transition` · `/check artifacts` | Enforcement before phases / transitions |
| `/subagent` | Browse / invoke specialists |
| `/repo-scan` · `/test-runner` · `/lint` | Evidence helpers |

**Full list:** [Usage](https://agentic-swe.github.io/agentic-swe-site/docs/usage) · **`commands/`**

---

## Subagents

<!-- catalog-counts:start kind=total-line -->
**138+ specialists** under **`agents/subagents/`**
<!-- catalog-counts:end -->. **Auto-selected** from **`feasibility.md`** signals; manual **`/subagent invoke`** anytime.

<!-- catalog-counts:start kind=inline -->
Across 10 categories — Language Specialists (29), Infrastructure (16), Specialized Domains (15), Quality & Security (14), Data & AI (13), Developer Experience (13), Business & Product (11), Core Development (10), Meta & Orchestration (10), Research & Analysis (7).
<!-- catalog-counts:end -->

**Details:** [Subagent catalog](https://agentic-swe.github.io/agentic-swe-site/docs/subagent-catalog) · [Catalog routing](https://agentic-swe.github.io/agentic-swe-site/docs/catalog-routing)

---

## Work state

**`.worklogs/<id>/`** holds **`state.json`** (source of truth), **`progress.md`** (timeline), **`audit.log`** (append-only), and per-phase markdown (e.g. **`feasibility.md`**, **`implementation.md`**, **`validation-results.md`**, **`pr-link.txt`**).

- **State over chat** — resume from files, not from thread memory alone.
- **Evidence** — tie claims to commands, paths, or CI (`templates/evidence-standard.md`).
- **CI parity** — **`scripts/work-engine.cjs`** enforces **`/check`**-style rules.

---

## Architecture

A single **Hypervisor session** (this one) owns transitions, gates, and synthesis. Three **core agents** — **developer**, **git-operations**, **pr-manager** — carry bounded work. A **design panel** (architect, security, adversarial) reviews in parallel on the rigorous track. All consult the **135+ subagent** catalog, auto-selected from repo signals.

→ [Architecture overview](https://agentic-swe.github.io/agentic-swe-site/docs/architecture) (full diagram)

---

## Extending · CI · License

| Topic | Where |
|-------|--------|
| Extend pipeline | **`/author-pipeline`** · [`references/authoring-pipeline-capabilities.md`](references/authoring-pipeline-capabilities.md) |
| CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — **`npm run ci`** locally |
| Research basis | [`CLAUDE.md` — Research basis](CLAUDE.md#research-basis) |
| License | [MIT](LICENSE) · [Licensing](https://agentic-swe.github.io/agentic-swe-site/docs/licensing) |
