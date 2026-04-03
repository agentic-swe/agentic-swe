# Installing agentic-swe for Codex

## Prerequisites

- Node.js >= 18
- A target repository where you want the pipeline

## Quick Install

```bash
# Option A — npx (recommended)
cd /path/to/your-repo
npx agentic-swe

# Option B — global install
npm install -g agentic-swe
cd /path/to/your-repo
agentic-swe install
```

Both methods copy `.claude/` and `CLAUDE.md` into your repo.

## Codex-Specific Setup

### 1. Create AGENTS.md

Copy the provided `AGENTS.md` from this repository into your target repo root.
Codex reads `AGENTS.md` as its orchestration entry point.

```bash
cp /path/to/agentic-swe/AGENTS.md /path/to/your-repo/AGENTS.md
```

### 2. Enable Multi-Agent Mode (optional)

If your Codex workspace supports it, enable multi-agent dispatch so the
pipeline can delegate to specialist subagents:

```json
{ "multi_agent": true }
```

### 3. Verify

Open the target repo in Codex. The pipeline policy from `AGENTS.md` should
be active. Run `/work <task description>` to start a work item.

## Symlink Alternative

For local development you can symlink instead of copying:

```bash
ln -s /path/to/agentic-swe/.claude /path/to/your-repo/.claude
ln -s /path/to/agentic-swe/CLAUDE.md /path/to/your-repo/CLAUDE.md
ln -s /path/to/agentic-swe/AGENTS.md /path/to/your-repo/AGENTS.md
```
