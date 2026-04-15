# Who this is for (adoption one-pager)

A short, honest map for **socializing** agentic-swe. It aligns with the product pillars in **[The North Star](https://github.com/surajSFDC/agentic-swe/blob/main/docs/the-north-star.md)** without claiming features we have not shipped yet (no universal JSON API, no hosted sandbox, no attested enterprise gates in-repo).

## In one sentence

**Teams that already use Claude Code** and want **phased SWE workflows**, **`.worklogs/`** evidence, and **human gates** instead of one long ad-hoc chat thread.

## Fit matrix

| You are a… | Good fit if… | Poor fit if… |
| :--- | :--- | :--- |
| **Team lead / EM** | You want reviewable artifacts and explicit stop points (`approval-wait`, `ambiguity-wait`) | You need SOC2 attested clicks or Jira two-way sync **out of this repo** today |
| **Senior IC** | You want `/work`, tracks, subagents, and `/check` as guardrails on real repos | You expect a **cloud runner** that clones and fixes issues without a local session |
| **Security / platform** | You can accept **markdown policy + human gates** and optional ignore of **`.worklogs/`** | You require **hard state machine enforcement in code** for every transition **today** (that is [Roadmap Phase 1](https://github.com/surajSFDC/agentic-swe/blob/main/docs/roadmap.md)) |
| **Multi-IDE shop** | You can start with **Claude Code** as reference, use **[Host support tiers](host-support-tiers.md)** for OpenCode / Antigravity | You need **identical slash UX** on every IDE next week |

## What you get **today**

- Installable **workflow pack** (policies, phases, **135+** subagent prompts, templates).
- **State + artifacts** under **`.worklogs/<id>/`** when the Hypervisor follows **`CLAUDE.md`**.
- **Slash commands** and plugin resolution on **Claude Code** (primary).
- **Tier B** documented paths for **OpenCode** and **Antigravity**; other hosts per [Multi-platform support](multi-platform-support.md).

## What is explicitly **not** promised here

| North Star pillar (name) | Honest status in this repository |
| :--- | :--- |
| Universal protocol / any-IDE same API | **Roadmap** — session + markdown today |
| Hard enforcement vs policy-only | **Roadmap Phase 1** — `/check` assists; engine does not reject invalid edges programmatically yet |
| Sandboxed “run tests in our cloud” | **Not this product** — see [Product positioning](product-positioning.md) |
| Real-time global cost metering | Budget fields are **policy**; live spend aggregation is **roadmap** |
| Enterprise telemetry / compliance mappings | **Roadmap / separate product** |

## First actions

1. **[Golden path (Claude Code)](golden-path.md)** — about 15 minutes to first **`.worklogs/`** story.
2. **[Examples](examples.md)** — lean vs standard prompt shapes.
3. **[Product positioning](product-positioning.md)** — deeper ICP and messaging.
