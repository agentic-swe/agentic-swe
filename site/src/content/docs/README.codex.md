# Codex

**Quick setup**

1. **Clone** this repo (or add it as a submodule) so **`commands/`**, **`phases/`**, **`agents/`**, **`templates/`**, and **`references/`** are on disk where Codex can read them.

2. In your **target app repo** (the code you ship):
   - Copy or merge **`AGENTS.md`** from the pack (or align yours with the same Hypervisor summary).
   - Merge the pack’s **`CLAUDE.md`** block into your root **`CLAUDE.md`** (same idea as **`/install`** on Claude Code).

3. **Expose the pack** to Codex: symlink or multi-root workspace so paths like **`commands/`** resolve from the pack root. Pipeline state always lives under **`.worklogs/<id>/`** in the target repo.

4. Start work with **`/work <task>`** (or open the matching file under **`commands/`** if your host maps commands that way).

**Full Codex layout:** see **`.codex/INSTALL.md`** in the pack repo.

**Optional durable memory:** pack **`scripts/`** CLIs — [Durable memory](durable-memory.md).

**More detail:** [Installation](installation.md) · [Usage](usage.md) · [Multi-platform support](multi-platform-support.md) · [Durable memory](durable-memory.md)
