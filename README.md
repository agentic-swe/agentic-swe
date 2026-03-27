# Autonomous SWE Pipeline for Claude Code

A pure-markdown orchestration pipeline that enables Claude Code to autonomously execute software engineering work — from task analysis through implementation, review, and PR creation.

## What This Is

This repository defines a state machine-driven pipeline with no runtime code. Claude Code itself is the orchestrator, following the policies, phase prompts, and templates defined here. Every decision is evidence-based, every transition is gated, and human approval is required before release actions.

## Architecture

- **Orchestrator pattern**: Claude Code reads `CLAUDE.md` as policy and executes the pipeline by following phase prompts, writing artifacts, and managing state transitions.
- **Evidence-based workflow**: Every phase output follows a four-point evidence standard (observed → inferred → evidence → uncertain). See `templates/evidence-standard.md`.
- **State machine**: A deterministic state machine governs all transitions. Two paths exist — a fast path for simple tasks and a full path for complex work.
- **Human gates**: Execution stops at ambiguity, approval, and escalation points.

## State Machine

```
initialized → feasibility → fast-path-check ─┬─→ fast-implementation → validation ─┐
                                              └─→ design → design-review → verification → test →
                                                   implementation → self-review → code-review → permissions → validation ─┐
                                                                                                             ├─→ pr-created → approval-wait → completed
Escalation exits: escalate-code, escalate-validation, failed
Human gates: ambiguity-wait, approval-wait, escalation states
```

## Installation

### Option A: Slash command (recommended)

Open Claude Code in your target repository and run:

```
/install
```

This scaffolds the `.claude/` directory with all pipeline files automatically.

### Option B: Manual installation

1. **Clone this repository** (or download it):

   ```bash
   git clone https://github.com/surajSFDC/agentic-swe.git /tmp/agentic-swe
   ```

2. **Create the `.claude/` directory** in your target repo:

   ```bash
   cd /path/to/your/repo
   mkdir -p .claude/.work .claude/commands .claude/phases .claude/agents/panel .claude/templates .claude/references
   ```

3. **Copy all pipeline files** into `.claude/`:

   ```bash
   cp /tmp/agentic-swe/commands/*.md       .claude/commands/
   cp /tmp/agentic-swe/phases/*.md         .claude/phases/
   cp /tmp/agentic-swe/agents/*.md         .claude/agents/
   cp /tmp/agentic-swe/agents/panel/*.md   .claude/agents/panel/
   cp /tmp/agentic-swe/templates/*         .claude/templates/
   cp /tmp/agentic-swe/references/*.md     .claude/references/
   touch .claude/.work/.gitkeep
   ```

4. **Set up `CLAUDE.md`**:

   - If your repo **has no `CLAUDE.md`**: copy the pipeline policy directly.

     ```bash
     cp /tmp/agentic-swe/CLAUDE.md .claude/CLAUDE.md
     ```

   - If your repo **already has a `CLAUDE.md`**: append the pipeline policy to preserve your existing instructions.

     ```bash
     echo -e "\n---\n\n<!-- BEGIN autonomous-swe-pipeline policy — do not edit above this line -->" >> CLAUDE.md
     cat /tmp/agentic-swe/CLAUDE.md >> CLAUDE.md
     ```

5. **Add `.work/` to your `.gitignore`** (runtime state should not be committed):

   ```bash
   echo ".claude/.work/" >> .gitignore
   ```

## Getting Started: From Install to First Task

No separate eval, audit, or setup steps are required. The pipeline is self-bootstrapping — just give it a task and it handles the rest.

### Step 1: Open Claude Code in your target repo

```bash
cd /path/to/your/repo
claude
```

### Step 2: Start your first task

```
/work Add retry logic to the API client
```

The pipeline automatically:
- Creates a work branch (`work/add-retry-logic`)
- Runs **feasibility analysis** (scans the repo, identifies relevant files, detects ambiguity)
- Routes to **fast path** (simple tasks) or **full path** (complex tasks)
- Implements, tests, reviews, and validates the change
- Creates a **PR** and stops for your approval

### Step 3: Respond to pipeline stops

The pipeline will pause and wait for you at these points:

| Stop Point | What Happened | What To Do |
|------------|---------------|------------|
| `ambiguity-wait` | The task description is unclear | Answer the questions it asks, then `/work <id>` to resume |
| `approval-wait` | A PR has been created | Review the PR on GitHub, approve or request changes, then `/work <id>` to resume |
| `escalate-code` | Code review failed after max retries | Review the feedback in the work artifacts and decide how to proceed |
| `escalate-validation` | Build/test/lint failed after retries | Check the validation results and fix the environment or task |

### Step 4: Complete the work

After you approve the PR on GitHub, resume to merge:

```
/work add-retry-logic
```

The pipeline detects your approval, merges the PR, and transitions to `completed`.

## Other Commands

| Command | Purpose |
|---------|---------|
| `/work <id>` | Resume paused work by ID |
| `/plan-only <task>` | Run feasibility + design without implementing |
| `/evaluate-work <id>` | Inspect a work item's state, artifacts, and health |
| `/check budget` | Verify iteration and cost budgets |
| `/repo-scan` | Produce a structured codebase snapshot |

## File Structure

```
├── CLAUDE.md                      # Orchestrator policy and state machine (source of truth)
├── README.md                      # This file
│
├── agents/                        # Specialist agents for bounded delegation
│   ├── developer.md               # Implementation specialist
│   ├── git-ops.md                 # Branch management, remote sync, conflicts
│   ├── pr-manager.md              # PR creation and management
│   └── panel/                     # Design panel (parallel review)
│       ├── architect.md           # Structural soundness review
│       ├── security.md            # Security and trust boundary review
│       └── adversarial.md         # Assumption-breaking review
│
├── commands/                      # Slash commands (operator entrypoints)
│   ├── work.md                    # /work — start or resume work
│   ├── check.md                   # /check — budget, transition, artifact validation
│   ├── plan-only.md               # /plan-only — plan without implementing
│   ├── evaluate-work.md           # /evaluate-work — inspect work health
│   ├── install.md                 # /install — scaffold .claude/ in target repo
│   ├── repo-scan.md               # /repo-scan — structured codebase snapshot
│   ├── test-runner.md             # /test-runner — detect and execute tests
│   ├── lint.md                    # /lint — detect and run linters/formatters
│   ├── diff-review.md             # /diff-review — evidence-backed code review
│   ├── ci-status.md               # /ci-status — CI/CD pipeline status
│   ├── conflict-resolver.md       # /conflict-resolver — git conflict resolution
│   └── security-scan.md           # /security-scan — baseline security checks
│
├── phases/                        # Phase prompts (one per pipeline state)
│   ├── feasibility.md             # Task analysis and ambiguity detection
│   ├── fast-path-check.md         # Simple vs complex routing
│   ├── design.md                  # Implementation-ready design
│   ├── design-review.md           # Design approval gate
│   ├── verification.md            # Planning artifact validation
│   ├── test.md                    # Test stub generation and execution
│   ├── fast-implementation.md      # Fast-path implementation with inline test requirement
│   ├── implementation.md          # Code implementation (delegates to developer agent)
│   ├── self-review.md             # Self-critique with rubric scoring before code review
│   ├── code-review.md             # Code approval gate
│   ├── permissions.md             # Non-code operational changes
│   ├── validation.md              # Integrated build/test/lint validation
│   ├── pr-created.md              # PR creation and handoff
│   ├── completion.md              # Post-approval merge, validation, and cleanup
│   ├── escalate-code.md           # Terminal state: code/review escalation
│   ├── escalate-validation.md     # Terminal state: validation escalation
│   └── failed.md                  # Terminal state: pipeline failure
│
├── references/                    # Tool and platform reference docs
│   └── github.md                  # Git and GitHub workflow guidance
│
└── templates/                     # Shared templates
    ├── state.json                 # Work item state schema
    ├── progress.md                # Progress log format
    ├── audit.log                  # Audit trail format
    ├── phase-checklist.md         # Pre-transition checklist
    ├── evidence-standard.md       # Four-point evidence framework
    └── artifact-format.md         # Standard artifact structure
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `/work <task>` | Start a new work item with a task description |
| `/work <id>` | Resume an existing work item by ID |
| `/check budget` | Verify iteration and cost budgets |
| `/check transition <from> <to>` | Validate a state transition |
| `/check artifacts <state>` | Verify required artifacts exist |
| `/plan-only <task>` | Plan without implementing (stops after design) |
| `/evaluate-work <id>` | Inspect work item health and status |
| `/install` | Scaffold `.claude/` pipeline in target repository |
| `/repo-scan` | Produce structured codebase snapshot (languages, tests, CI, linters) |
| `/test-runner [scope]` | Detect and execute tests with structured results |
| `/lint [scope]` | Detect and run linters/formatters in check mode |
| `/diff-review [range]` | Review code changes with evidence-backed findings |
| `/ci-status [PR\|branch]` | Check CI/CD pipeline and mergeability status |
| `/conflict-resolver [command]` | Detect, classify, and resolve git conflicts |
| `/security-scan [scope]` | Run dependency audit, secret scan, and pattern detection |

## Research Basis

This pipeline's design is grounded in current agentic software engineering research:

| Source | Key Contribution |
|--------|-----------------|
| **SASE** (Hassan et al., 2025) | Structured agentic SE framework: BriefingScripts, LoopScripts, MergeReadinessPacks |
| **SWE-agent** (Yang et al., 2024) | Agent-Computer Interface design; tool interface matters as much as model capability |
| **Agentless** (Xia et al., 2024) | Localize→Repair→Validate at $0.34/issue; simple tasks don't need full deliberation |
| **Ambig-SWE** (ICLR, 2025) | Interactive agents achieve 74% improvement on underspecified inputs; stop-and-ask is critical |
| **TDAD** (2026) | 70% regression reduction with test-driven development; TDD without structural context worsens outcomes |
| **SWE-AF** (2025) | Multi-agent fleet with Planner→Coder→Reviewer→Merger→Verifier; parallel isolated worktrees |
| **Agentic AI Fault Taxonomy** (2025) | 385 faults across 3 categories; context window pollution is #1 failure mode |
| **TALE** (2025) | 68% token reduction while maintaining accuracy; declare budgets upfront |
| **OpenHands** (Wang et al., ICLR 2025) | Event stream architecture; every actor action is a first-class event |
| **GitHub Agentic Workflows** (2026) | Read-only default, safe outputs, defense-in-depth; agents produce normal git artifacts |
| **Aider** (2024-26) | Git-as-first-class-citizen; every change committed; rollback always one command away |
| **Reflexion** (Shinn et al., NeurIPS 2023) | Verbal self-reflection in episodic memory; 91% HumanEval pass@1 without weight updates |
| **Self-Refine** (Madaan et al., NeurIPS 2023) | Single-LLM generate→critique→refine loop; ~20% improvement across 7 tasks |
| **AgentCoder** (Huang et al., 2024) | Three-agent code generation with test executor; 45-71% fewer tokens via strategic test placement |
| **LLM-as-a-Judge for SE** (Fan et al., 2025) | Multi-dimensional rubric-based evaluation outperforms single-criterion judgment for code review |
| **Rubric Is All You Need** (Dong et al., 2025) | Task-specific rubrics significantly improve LLM evaluation accuracy over generic criteria |
| **AgentDiet** (2024) | Trajectory reduction via reflection-based condensing; 40-60% input token reduction |

## Extending

- **Add a phase**: Create a new `.md` file in `phases/`, add the state to the state machine in `CLAUDE.md`, and add required artifacts to the table.
- **Add an agent**: Create a new `.md` file in `agents/` and reference it in the Delegation section of `CLAUDE.md`.
- **Modify evidence standards**: Edit `templates/evidence-standard.md` — all phases cite it.
- **Change artifact format**: Edit `templates/artifact-format.md` — all phases cite it.
- **Adjust budgets**: Edit the Budgets And Loops section in `CLAUDE.md` and the defaults in `templates/state.json`.
