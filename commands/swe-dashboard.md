---
name: swe-dashboard
description: "Open a local browser dashboard of all .worklogs work items (metrics, cost, tokens)."
---

# /swe-dashboard

Read-only **local dashboard** for every work item under the target repo’s **`.worklogs/<id>/`**: state, track, task, duration, iteration usage, **estimated cost** (`budget.cost_used` / cap), **token totals** (`budget.usage_totals` when cost sync has run), counters (subagent spawns, panel runs), and **rollup** summaries (full repo, even when the table is paginated). The UI includes **filters** (all / active / completed), **search**, **Refresh** and optional **auto-refresh (30s)**, **Load more** (paged **`GET /api/work-items?limit=&offset=`**, cap **200**), a **Δ cost** column (increase since the previous refresh), **Export JSON/CSV** for the current view (export JSON includes **`api`**, **`projectRoot`**, **`exported_at`**, **`rollup`**), **copy work dir path** and **VS Code** open links per row, a **by-state** bar summary for the **whole repo**, and a compact **transition timeline** from `history`. The page uses the same **visual language** as the project site (Syne / IBM Plex Sans / JetBrains Mono, cyan–violet accents, grid backdrop, cards, and table chrome from **`site/src/index.css`**).

**Demo data:** from a checkout or target repo, run **`npm run seed-dashboard-demo`** (writes **`.worklogs/_demo-active`** and **`.worklogs/_demo-done`**; use **`--force`** to overwrite). Then open the dashboard for that repo.

## Prompt

You are handling **`/swe-dashboard`** for: `$ARGUMENTS`

### Resolve project root

1. **Default:** the **git / project root** for the session (the directory that contains **`.worklogs/`**). If the user passed a path or work id, use it only when it clearly points at a repo root or a **`.worklogs/<id>`** path; otherwise use **`cwd`** from the environment the user is working in.
2. **Claude Code:** the **`UserPromptSubmit`** hook may already have started the server when the prompt begins with **`/swe-dashboard`** (see **`hooks/dashboard-on-prompt.sh`**). If so, tell the user to open **`http://127.0.0.1:47822/`** (or **`SWE_DASHBOARD_PORT`** if set). If the port is still free, start the server as below.

### Start the server (if not already running)

Run from the **target repo** (so **`--cwd`** is the project that owns **`.worklogs/`**):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/swe-dashboard-server.cjs" --cwd "$(pwd)"
```

On **Windows** (cmd), use an absolute **`--cwd`** to that repo. Add **`--no-open`** if you only want the URL printed.

- **Port:** **`SWE_DASHBOARD_PORT`** (default **47822**, separate from brainstorm **47821**).
- **Override cwd:** **`AGENTIC_SWE_DASHBOARD_CWD`** or **`--cwd /abs/path/to/repo`**.

From a checkout of this pack:

```bash
npm run swe-dashboard -- --cwd /path/to/target/repo
```

### After it starts

Print the **`http://127.0.0.1:<port>/`** URL. The UI loads **`GET /api/meta`** (project root) and **`GET /api/work-items`** (optional **`limit`**, **`offset`**; response includes **`items`**, **`rollup`**, **`total_count`**). **`POST /api/rollup`** remains for custom subsets. JSON only reads **`.worklogs/<id>/state.json`** under **`--cwd`**. **No authentication** — localhost only; do not expose beyond the user’s machine.

**Cost attribution:** `budget.cost_used` and `budget.usage_totals` follow the **active** work item selected by the **`Stop`** hook (see **`AGENTIC_SWE_WORK_DIR`** vs newest non-**`completed`** item under **`cwd`**). One Claude Code **session transcript** may include usage for work outside that item; pinning **`AGENTIC_SWE_WORK_DIR`** reduces mis-attribution. Splitting spend across **multiple** transcripts per item is not implemented yet.

### Cursor and other hosts

**Cursor** (and hosts without this pack’s **`hooks/hooks.json`**) will **not** auto-start the server. In those environments, run the **`node … swe-dashboard-server.cjs`** (or **`npm run swe-dashboard`**) command in the terminal yourself, then open the printed URL.

### Stop

Press **Ctrl+C** in the terminal where the server runs, or close that process.
