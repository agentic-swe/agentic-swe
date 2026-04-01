# Installation Guide

## Prerequisites

- **Node.js 18+** (for `npx` / `npm`; the published CLI is the supported install path)
- **Claude Code** CLI, desktop app, or IDE extension ([install guide](https://docs.anthropic.com/en/docs/claude-code))
- **Git** installed and configured
- **GitHub CLI** (`gh`) installed and authenticated (for PR creation)
- A git repository where you want to use the pipeline (recommended; use `agentic-swe -y` if you must install into a non-git tree)

---

## Install (recommended): npm

Package: [agentic-swe on npm](https://www.npmjs.com/package/agentic-swe).

**One-shot:**

```bash
npx agentic-swe /path/to/your/project
```

**Global CLI (run anytime):**

```bash
npm install -g agentic-swe
agentic-swe install /path/to/your/project
```

**Current directory:**

```bash
cd /path/to/your/project
npx agentic-swe
# or: agentic-swe install
```

This installs the `.claude/` tree and merged `CLAUDE.md` policy using the published CLI—no separate source checkout.

- Default target is the **current directory** when you omit a path.
- If the target is **not** a git repository, you are prompted unless you pass **`-y` / `--yes`** (useful for CI).

**Then open Claude Code:**

```bash
cd /path/to/your/project
claude
```

```
/work Add retry logic to the API client
```

### Upgrades and repairs

Run the same command again against the project (e.g. `npx agentic-swe /path/to/your/project`). It updates `.claude/` and refreshes the appended pipeline block in `CLAUDE.md` when the delimiter is present.

### Publish a new version (package maintainers only)

Maintainers publish from their checkout: `npm login`, `npm version patch|minor|major`, `npm publish`. This is **not** an end-user install path.

---

## Slash command `/install` (after npm install)

After the pipeline is installed, your project has `.claude/commands/install.md`, so **`/install`** is available **inside Claude Code in that project** for guided repairs (see the command’s prompt). First-time setup should still use **`npx agentic-swe`** so you do not depend on slash commands existing before `.claude/` exists.

---

## Selective install (subagents only)

If you already have your own Claude Code setup and only want the specialized subagents, install the package in a temporary directory and copy from `node_modules`:

```bash
mkdir -p /tmp/agentic-swe-extract && cd /tmp/agentic-swe-extract
npm install agentic-swe
cp -r node_modules/agentic-swe/.claude/agents/subagents/ /path/to/your/project/.claude/agents/subagents/
cp -r node_modules/agentic-swe/.claude/tools/subagent-catalog/ /path/to/your/project/.claude/tools/subagent-catalog/
cp node_modules/agentic-swe/.claude/commands/subagent.md /path/to/your/project/.claude/commands/
```

You can invoke subagents directly in Claude Code, for example:

```
Use the python-pro subagent to refactor this module with proper type hints
```

---

## Manual copy from the npm tarball (advanced)

If you cannot run the CLI but can use files from the **registry**, unpack the tarball produced by the npm package (`npm pack agentic-swe` downloads the same bits as `npm install`). Do **not** mirror a git checkout—only the published package. Copying by hand is error-prone; prefer `npx agentic-swe` when possible.

---

## Uninstalling

To remove the pipeline from a target repo:

```bash
rm -rf .claude/commands .claude/phases .claude/agents .claude/templates .claude/references .claude/tools .claude/.work
```

If the pipeline policy was appended to your `CLAUDE.md`, remove everything after the `<!-- BEGIN autonomous-swe-pipeline policy` delimiter.
