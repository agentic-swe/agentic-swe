# Host support tiers

Not every “supported” host gets the **same** integration. This page defines what we mean by support so expectations stay aligned with what ships today versus what lives on the [Roadmap](https://github.com/surajSFDC/agentic-swe/blob/main/docs/roadmap.md).

## Tier summary

| Tier | You get | Cost to maintain | agentic-swe today |
| :--- | :--- | :--- | :--- |
| **A — Portable policy** | Markdown policy, artifact layout, evidence habits (**`CLAUDE.md`**, **`.worklogs/`**) | Low | Any editor if you paste or sync policy |
| **B — Documented happy path** | Install surface + **command mapping** + known limitations | Medium (docs per host) | **Official for OpenCode and Antigravity** (this release cycle) |
| **C — Packaged integration** | Native plugin / hooks validated in CI | High per host | **Claude Code** (marketplace plugin, **`${CLAUDE_PLUGIN_ROOT}`**), **Cursor** (`.cursor-plugin/`), Codex/OpenCode/Gemini bundles in-repo |
| **D — Protocol + harness** | Same state machine in CI and IDE, enforced transitions | Highest | [Roadmap Phase 1](https://github.com/surajSFDC/agentic-swe/blob/main/docs/roadmap.md) — not claimed as shipped |

## Canonical reference host: Claude Code

The **best first experience** is Claude Code with the marketplace plugin: slash commands, phase prompts from the plugin root, and **`.worklogs/`** in your repo. Follow the **[Golden path](golden-path.md)**.

## Tier B — Official secondaries (happy path docs)

These hosts use the **same Hypervisor policy** (`CLAUDE.md`, phases, templates) but ** differ** in how commands are discovered and how the pack is wired. We document a **15-minute style** path for each; we do **not** claim slash-command parity with Claude Code unless stated.

### OpenCode

| Claude Code (reference) | OpenCode (Tier B) |
| :--- | :--- |
| **`/plugin install …`** | **`opencode.json`** plugin entry + symlink **`agentic-swe.js`** per [OpenCode install tab](/docs/installation#opencode) |
| **`/work …`** | Same command **when** OpenCode exposes pack **`commands/`**; prepended policy via plugin transform — see [OpenCode](README.opencode.md) and [install-guide/opencode](https://github.com/surajSFDC/agentic-swe/blob/main/site/src/content/docs/install-guide/opencode.md) |

**Non-goals today:** identical SessionStart hooks as Claude Code; CI-driven OpenCode UI tests in GitHub-hosted runners.

### Google Antigravity

| Claude Code (reference) | Antigravity (Tier B) |
| :--- | :--- |
| Plugin marketplace | Clone/submodule pack + **merge `CLAUDE.md`** into the app repo — [Antigravity install tab](/docs/installation#antigravity) |
| **`/work …`** | User steers the session using pack commands where the product exposes them; otherwise follow phase prompts from the merged policy — [Antigravity](antigravity.md) |

**Non-goals today:** Google-hosted pack marketplace identical to Claude’s; attested human gates.

## Other hosts (Cursor, Codex, Gemini CLI)

See **[Multi-platform support](multi-platform-support.md)** for the full table. Cursor and Codex often land in **Tier C** packaging in this repo (wiring validated in **`npm test`**) while **Tier B** narrative may be shorter than OpenCode/Antigravity depending on doc freshness — check each page’s install section.

## When Tier B is not enough

If you need **the same transition enforcement in CI** as in chat, that is **Tier D** and triggers [Phase 1 start criteria](https://github.com/surajSFDC/agentic-swe/blob/main/docs/roadmap.md#when-to-start-phase-1) on the roadmap — not “one more markdown page.”
