# Usage Guide

## Getting Started

No separate eval, audit, or setup steps are required. The pipeline is self-bootstrapping once the **agentic-swe** Claude Code plugin is enabled — give it a task and it handles the rest. If install or slash commands fail, see [troubleshooting.md](troubleshooting.md), run **`/install`** in the target project for **`CLAUDE.md`** / **`.worklogs/`** setup, and see [installation.md](installation.md). From a checkout of this repo you can run **`claude plugin validate /path/to/agentic-swe`** (repo root) to verify the marketplace manifest.

**See all work items locally:** use slash **`/swe-dashboard`** or **`npm run swe-dashboard -- --cwd "$(pwd)"`** for a browser dashboard (metrics, filters, export). Empty tree? Run **`npm run seed-dashboard-demo`** then refresh. Details: [check-commands.md](check-commands.md) and the pack’s **`commands/swe-dashboard.md`**.

**Step 1: Open Claude Code in your project**

```bash
cd /path/to/your/project
claude
```

**Step 2: Start your first task**

```
/work Add retry logic to the API client
```

The pipeline automatically:
- Creates a work branch (`work/add-retry-logic`)
- Runs **feasibility analysis** (scans the repo, identifies relevant files, detects ambiguity)
- Routes to the **lean track** (simple tasks) or **rigorous track** (complex tasks)
- Implements, tests, reviews, and validates the change
- Creates a **PR** and stops for your approval

**Step 3: Respond to pipeline stops**

The pipeline pauses at these human gates:

| Stop Point | What Happened | What To Do |
|------------|---------------|------------|
| `ambiguity-wait` | The task description is unclear | Answer the questions, then `/work <id>` to resume |
| `approval-wait` | A PR has been created | Review the PR on GitHub, then `/work <id>` to resume |
| `escalate-code` | Code review failed after max retries | Review feedback in work artifacts |
| `escalate-validation` | Build/test/lint failed after retries | Check validation results |

**Step 4: Complete the work**

After you approve the PR on GitHub, resume to merge:

```
/work add-retry-logic
```

The pipeline detects your approval, merges the PR, and transitions to `completed`.

---

## Running the Full Pipeline

The `/work` command is the main entry point. It handles the entire lifecycle:

```
/work <task description>
```

The pipeline decides whether to use the **lean track** (simple, low-risk changes) or the **rigorous track** (complex, multi-file changes with design review).

**Lean track** (typically 3-5 minutes):

```
initialized -> feasibility -> lean-track-check -> lean-track-implementation -> validation -> pr-creation -> approval-wait -> completed
```

**Rigorous track** (typically 10-30 minutes):

```
initialized -> feasibility -> lean-track-check -> design -> design-review -> verification -> test ->
implementation -> self-review -> code-review -> permissions-check -> validation -> pr-creation -> approval-wait -> completed
```

To resume paused work:

```
/work <work-id>
```

---

## Using Specialized Subagents

135+ specialized subagents are available for domain-specific tasks. You can use them in three ways:

### Way 1: Via the `/subagent` command

```
/subagent                           # List all categories and agents
/subagent search kubernetes         # Find agents by keyword
/subagent info python-pro           # View full agent definition
/subagent invoke rust-engineer Fix the borrow checker error in src/parser.rs
```

### Way 2: Direct invocation in conversation

Just describe what you need -- Claude Code will select the right subagent:

```
Use the security-auditor subagent to audit the authentication module

Invoke the typescript-pro agent to add proper generics to the API client

Spawn the devops-engineer to optimize our Docker build
```

### Way 3: Within the pipeline

During pipeline execution, the Hypervisor can automatically delegate to subagents when domain expertise is needed. For example, if the task involves Rust code, it may spawn the `rust-engineer` subagent during implementation.

### Way 4: Headless catalog router (CLI)

From a checkout of **agentic-swe**, you can rank specialists without the IDE:

```bash
npm run catalog:route -- "kubernetes helm rollout" --k 5 --json
npm run catalog:lint
```

Semantic similarity requires **`npm run catalog:index`** first (writes **`.agentic-swe/catalog-embeddings.json`**). See [Catalog routing](catalog-routing.md) for modes, CI, and model tier hints.

### Repo-specific custom subagents

For expertise not covered by the catalog, add definitions under:

**`${CLAUDE_PLUGIN_ROOT}/agents/subagents/custom/`**

Use the same frontmatter and structure as agents under `${CLAUDE_PLUGIN_ROOT}/agents/subagents/<category>/`. Reference them by filename (without `.md`) in `/subagent invoke` or natural-language delegation. Document team conventions in `docs/agentic-swe/CONVENTIONS.md` if needed. Implementation may record unresolved catalog gaps under **`## Capability gaps`** in the work artifact (see `${CLAUDE_PLUGIN_ROOT}/templates/capability-gaps-section.md` in the installed package).

---

## Planning Without Implementing

To analyze a task and produce a design without writing code:

```
/plan-only Add WebSocket support to the notification service
```

This runs feasibility analysis and design phases, then stops. Useful for:
- Estimating complexity before committing
- Getting a design review from the team
- Understanding what files and systems would be affected

---

## Inspecting Work Health

To check the status and health of a work item:

```
/evaluate-work <work-id>
```

This shows:
- Current pipeline state
- Budget usage (iterations remaining)
- Artifact completeness
- Any blockers or escalation risks

---

## Commands Reference

### Pipeline Commands

| Command | Description |
|---------|-------------|
| `/work <task>` | Start a new work item with a task description |
| `/work <id>` | Resume an existing work item by ID |
| `/plan-only <task>` | Plan without implementing (stops after design) |
| `/evaluate-work <id>` | Inspect work item health and status |
| `/install` | Merge `CLAUDE.md`, set up `.worklogs/`, optional `.gitignore` (plugin-first) |

### Enforcement Commands (automatic during pipeline)

| Command | Description |
|---------|-------------|
| `/check budget` | Verify iteration and cost budgets |
| `/check transition <from> <to>` | Validate a state transition |
| `/check artifacts <state>` | Verify required artifacts exist |

### Utility Commands

| Command | Description |
|---------|-------------|
| `/repo-scan` | Produce structured codebase snapshot (languages, tests, CI, linters) |
| `/test-runner [scope]` | Detect and execute tests with structured results |
| `/lint [scope]` | Detect and run linters/formatters in check mode |
| `/diff-review [range]` | Review code changes with evidence-backed findings |
| `/ci-status [PR\|branch]` | Check CI/CD pipeline and mergeability status |
| `/conflict-resolver [command]` | Detect, classify, and resolve git conflicts |
| `/security-scan [scope]` | Run dependency audit, secret scan, and pattern detection |

### Subagent Commands

| Command | Description |
|---------|-------------|
| `/subagent` | List all categories and available subagents |
| `/subagent search <query>` | Find subagents by keyword |
| `/subagent info <name>` | View full subagent definition and capabilities |
| `/subagent invoke <name> <task>` | Spawn a subagent for a specific task |

---

## Durable memory (optional)

Local graph + chunk index under **`.agentic-swe/memory.sqlite`** (`npm run memory-index`), bounded **memory prime** (`npm run memory-prime`), **graph import** (`npm run memory-import`), **transcript sliding summary** (`npm run memory-sliding-summary`), optional **embeddings** / **hybrid** retrieval. Session start **injects memory prime by default** (disable with **`AGENTIC_SWE_MEMORY_PRIME=0`**). Does not replace **`state.json`**. See [Durable memory](durable-memory.md).
