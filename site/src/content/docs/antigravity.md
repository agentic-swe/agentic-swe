# Google Antigravity

**Quick setup**

1. Install **Antigravity** per Google: [Get started](https://antigravity.google/docs/get-started).

2. **Clone** this pack repo (or submodule it) so **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, **`references/`**, and **`state-machine.json`** are on disk.

3. In your **app repo**, merge the pack’s **`CLAUDE.md`** policy block (delimiter-safe). From a pack checkout you can run:

   ```bash
   node scripts/merge-claude-policy.js --target /path/to/your-app
   ```

   Optional: **`--gitignore`** adds **`.worklogs/`** when missing.

4. In Antigravity, keep **root `CLAUDE.md`** and the **pack path** in context. There is no separate runtime: the session follows the policy and writes under **`.worklogs/<id>/`**.

**More detail:** [Installation](installation.md) · [Multi-platform support](multi-platform-support.md)
