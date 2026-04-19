# Cursor plugin

**Quick install**

1. Run the install script (needs **bash**; **node** optional for auto-merge below), then **restart Cursor** or **Developer: Reload Window**:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/surajSFDC/agentic-swe/main/scripts/install-cursor-plugin.sh | bash
   ```

   From a clone of this repo you can use: `bash scripts/install-cursor-plugin.sh`

2. **Merge policy into the app you’re editing** (recommended — same rules as Claude Code **`/install`**):

   ```bash
   AGENTIC_SWE_TARGET_REPO=/path/to/your-app curl -fsSL https://raw.githubusercontent.com/surajSFDC/agentic-swe/main/scripts/install-cursor-plugin.sh | bash
   ```

   Optional: **`AGENTIC_SWE_AUTO_GITIGNORE=1`** adds **`.worklogs/`** to the target **`.gitignore`**.

3. Open the **target project** in Cursor. Use your build’s command UI to open pack **`commands/*.md`** (same prompts as Claude Code). Policy and work state live in that project’s **`CLAUDE.md`** and **`.worklogs/<id>/`**.

**Work dashboard:** Cursor’s **`hooks/hooks-cursor.json`** in this pack only wires **`sessionStart`** (no **`UserPromptSubmit`** hook is assumed). The **local `/swe-dashboard`** server is therefore **Claude Code–first** when using **`hooks/dashboard-on-prompt.sh`** there. In Cursor, start the dashboard yourself from the project root, for example **`npm run swe-dashboard`** (or **`node …/scripts/swe-dashboard-server.cjs --cwd .`**) and open the printed **`http://127.0.0.1:47822/`** URL. See the pack’s **[swe-dashboard command](https://github.com/surajSFDC/agentic-swe/blob/main/commands/swe-dashboard.md)** (`commands/swe-dashboard.md` in the repo).

**Session start:** Same **`hooks/session-start`** as Claude Code — optional **memory prime** when **`AGENTIC_SWE_MEMORY_PRIME=1`**. See [Durable memory](durable-memory.md).

**More detail:** [Installation](installation.md) · [Multi-platform support](multi-platform-support.md) · [Durable memory](durable-memory.md) · [Troubleshooting](troubleshooting.md)
