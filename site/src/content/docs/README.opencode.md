# OpenCode

**Quick setup**

1. Point **OpenCode** at this repo’s **`.opencode/plugins/agentic-swe.js`** from **`opencode.json`** (see **`.opencode/INSTALL.md`** in the pack for the exact JSON snippet).

2. Keep a **checkout** of the pack whose root has **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`**, and **`state-machine.json`**.

3. Merge the pack’s **Hypervisor** block into your project’s root **`CLAUDE.md`** when you first wire things up (same contract as **`commands/install.md`** / **`/install`**).

4. Run the pipeline from **`/work`** (or your host’s equivalent). State and artifacts live under **`.worklogs/<id>/`** in the **target** repo.

**More detail:** [Installation](installation.md) · [Multi-platform support](multi-platform-support.md) · [Troubleshooting](troubleshooting.md)
