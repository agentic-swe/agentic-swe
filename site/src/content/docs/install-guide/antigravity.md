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

## Tool hints

When tool names differ from Claude Code defaults, use **`references/copilot-tools.md`** and other **`references/*-tools.md`** files in the pack.

## Related in-site docs

- **[Antigravity quick reference](../antigravity.md)** (home tile).
- **[Overview tab](/docs/installation#overview)** · **[Multi-platform support](../multi-platform-support.md)**
