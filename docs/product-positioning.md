# Product positioning

Agentic SWE is a **workflow pack for Claude Code**: installable markdown (policies, phases, agents, templates) that runs in the developer’s environment. There is **no hosted orchestrator** in this repository—the runtime is Claude Code plus your repo.

## Primary ICP (ideal customer profile)

**Engineering teams of roughly 2–20 developers** who already use (or are adopting) Claude Code and want:

- Predictable phases instead of ad-hoc chats  
- **Budgets and human gates** so agent work stops for ambiguity or approval  
- **Evidence-backed artifacts** (`state.json`, phase outputs) for review and audit  

**Secondary ICP:** Senior individual contributors who want the same structure for personal or small projects.

## Hero use case (messaging)

**Ship AI-assisted changes with traceable state, iteration budgets, and human gates—not unbounded agent loops.**

Lead with: governance, safety rails, and review-friendly outputs—not “more agents.”

## Differentiators (go-to-market angles)

1. **Failed refactors and runaway agents** — Position budgets, `ambiguity-wait` / `approval-wait`, and escalation paths as the answer to fear of uncontrolled automation.  
2. **Dev workflow product** — Same mental bucket as editor rules and team conventions: buyers already pay for tools; you sell **workflow + safety** for Claude Code specifically.  
3. **Future vertical packs** — Optional paid add-ons (e.g. domain-specific subagent bundles) without changing the core architecture.

## What not to claim

Do not promise a **multi-tenant SaaS** or “our cloud runs your pipeline” unless you ship that separately. The product is the **markdown pack** and any **services or Pro offerings** described in [PRO.md](../PRO.md).
