# Google Antigravity

Use **agentic-swe** like other agent-capable hosts: **Hypervisor** policy in the project’s root **`CLAUDE.md`**, state under **`.worklogs/<id>/`**, and command/phase markdown from a **checkout** of this repository (clone, submodule, or fixed path).

## 1. Install Antigravity

Follow Google’s current guide: **[Antigravity — Get started](https://antigravity.google/docs/get-started)** (requirements, sign-in, updates).

## 2. Make the pack available

Clone **[agentic-swe](https://github.com/surajSFDC/agentic-swe)** (or add it as a **submodule**) so **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`**, and **`state-machine.json`** are readable from your workspace.

## 3. Merge policy into your app repo

In the **target** repository, merge this pack’s **`CLAUDE.md`** block using the delimiter rules in **`commands/install.md`**, or from a pack checkout run:

```bash
node scripts/merge-claude-policy.js --target /path/to/your-app
```

Optional: **`--gitignore`** appends **`.worklogs/`** when missing.

## 4. Run the pipeline

There is **no** separate cloud runtime: the **session** follows **`CLAUDE.md`**, reads phases/commands from the pack root, and writes under **`.worklogs/<id>/`**. In Antigravity, attach rules or context that keep **`CLAUDE.md`** and the **documented pack path** in view for your team.

## Tier B happy path (~15 minutes)

This tab is an **official Tier B** path: documented install + policy merge, **not** a first-party marketplace mirror of Claude Code. See **[Host support tiers](../host-support-tiers.md)**.

1. Install Antigravity (section 1) and **clone** this pack (section 2).
2. **Merge `CLAUDE.md`** into your application repo (section 3); optional **`--gitignore`** for **`.worklogs/`**.
3. Open the **app** workspace; start a session with merged policy in context.
4. Ask the agent to run the pipeline for a **tiny** task (e.g. copy **`examples/golden-path-demo/src/counter.js`** into your app and **`/work` / natural-language equivalent** to fix **`countItems`** so tests pass).
5. Inspect **`.worklogs/<id>/`** for **`state.json`** and **`progress.md`**; stop at **approval-wait** before merging.

**Command mapping (vs Claude Code):** there is no single guaranteed **`/work`** slash unless Antigravity exposes pack commands the same way—steer with **explicit phase prompts** from **`${CLAUDE_PLUGIN_ROOT}/phases/`** (or your checkout path) when needed.

## Tool hints

When tool names differ from Claude Code defaults, use **`references/copilot-tools.md`** and other **`references/*-tools.md`** files in the pack.

## Related in-site docs

- **[Antigravity quick reference](../antigravity.md)** (home tile).
- **[Overview tab](/docs/installation#overview)** · **[Multi-platform support](../multi-platform-support.md)**
