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

**More detail:** [Installation](installation.md) · [Multi-platform support](multi-platform-support.md) · [Troubleshooting](troubleshooting.md)
