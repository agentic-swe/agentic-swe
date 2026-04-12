# Cursor

The pack ships a **Cursor plugin manifest** under **`.cursor-plugin/`** so the same **`commands/`** and **`agents/`** tree as Claude Code can load in **Cursor**. Policy stays in the **target** repo’s root **`CLAUDE.md`**; work state stays under **`.worklogs/<id>/`**.

Cursor’s UI changes over time — treat **[Cursor’s plugin docs](https://cursor.com/docs/plugins.md)** as authoritative for where to click; this page describes what **this repository** provides.

## What you get

| Piece | Role |
|-------|------|
| **`.cursor-plugin/plugin.json`** | Manifest: **`hooks`** → **`hooks/hooks-cursor.json`**; **`commands/`** and **`agents/`** discovered at **repo root** (Cursor default). |
| **`hooks/hooks-cursor.json`** | **Session start** runs **`hooks/session-start`** so the model gets a short orchestration reminder and **`references/session-routing-hint.md`**. |
| **`commands/*.md`** | Same prompts as the Claude pack; exposed as **plugin commands** (exact UI depends on Cursor build). |
| **`agents/**/*.md`** | Specialist prompts the session can open on demand. |

**Not identical to Claude Code:** there is no Anthropic **`/plugin marketplace`** flow. The **`UserPromptSubmit`** hook that auto-starts the brainstorm server (**`hooks/hooks.json`** on Claude) is **not** in **`hooks-cursor.json`** — start that helper manually if you need the UI (**`commands/brainstorm.md`**, **`agents/plugin-runtime/brainstorm-server/`**).

## Prerequisites

- **Git** in the target repo (recommended).
- **`bash`** on **`PATH`** for **`hooks/session-start`**.
- **`node`** on **`PATH`** only if you use the **automated `CLAUDE.md` merge** in the install script.

## One-command install (local plugins)

Cursor loads local plugins from **`~/.cursor/plugins/local/<name>/`** when that folder is a pack root (see [Test plugins locally](https://cursor.com/docs/plugins.md#test-plugins-locally)).

Run **one** of these, then **restart Cursor** or **Developer: Reload Window**:

```bash
curl -fsSL https://raw.githubusercontent.com/surajSFDC/agentic-swe/main/scripts/install-cursor-plugin.sh | bash
```

From a checkout (offline-friendly):

```bash
bash scripts/install-cursor-plugin.sh
```

**Symlink a checkout** (best when developing the pack):

```bash
AGENTIC_SWE_PACK_ROOT=/path/to/agentic-swe bash scripts/install-cursor-plugin.sh
```

Overrides: **`AGENTIC_SWE_REPO_URL`**, **`AGENTIC_SWE_REF`** (default branch **`main`**), **`CURSOR_LOCAL_PLUGINS_DIR`**.

## Automated `CLAUDE.md` merge (same script)

If **`node`** is available, set **`AGENTIC_SWE_TARGET_REPO`** to your **application repository root**:

```bash
AGENTIC_SWE_TARGET_REPO=/path/to/your-app curl -fsSL https://raw.githubusercontent.com/surajSFDC/agentic-swe/main/scripts/install-cursor-plugin.sh | bash
```

Optional: **`AGENTIC_SWE_AUTO_GITIGNORE=1`** appends **`.worklogs/`** to **`.gitignore`** when missing.

**Standalone merge** (pack already on disk):

```bash
node /path/to/agentic-swe/scripts/merge-claude-policy.js --pack /path/to/agentic-swe --target /path/to/your-app
```

## Manual / submodule options

1. Use a checkout whose root contains **`.cursor-plugin/`** next to **`commands/`**, **`phases/`**, **`agents/`**, etc.
2. Run the script above, **symlink** into **`~/.cursor/plugins/local/agentic-swe`**, or use Cursor’s **install local plugin** flow.
3. Open the **target project** in Cursor — it does not need a full copy of the pack unless you vendor it.

**Updates:** `git pull` inside **`~/.cursor/plugins/local/agentic-swe`**, or submodule + **`AGENTIC_SWE_PACK_ROOT`** + re-run the script.

## Configure the target repository

1. **Merge Hypervisor policy** into root **`CLAUDE.md`** (script above, or **`node scripts/merge-claude-policy.js`**, or follow **`commands/install.md`** manually — same contract as Claude **`/install`**).
2. **Work items:** **`.worklogs/<id>/`** and **`state.json`** per **`templates/state.json`** in the pack.
3. **Optional:** merge **`AGENTS.md`** from the pack for Cursor-style project rules.
4. **Optional:** **`.cursor/rules`** so every chat sees **`CLAUDE.md`**, **`.worklogs/`**, and pack paths — start from **`templates/cursor-rules-stub.md`**.

## Running the pipeline

There is **no** separate cloud runtime: the **session** follows **`CLAUDE.md`**, opens **`phases/*.md`** / **`commands/*.md`** from the pack root, and writes artifacts under **`.worklogs/<id>/`**. Use **`/check budget`**, **`/check transition`**, **`/check artifacts`** before changing **`state.json`**. Tool names may differ from Claude Code — see **`references/copilot-tools.md`** and other **`references/*-tools.md`** files in the pack.

## Related in-site docs

- **[Cursor plugin](../cursor-plugin.md)** — short quick reference for the home tile.
- **[Overview tab](/docs/installation#overview)** · **[Multi-platform support](../multi-platform-support.md)** · **[Troubleshooting](../troubleshooting.md)**
