# Agentic SWE vs Ruflo (competitive note)

This is an honest positioning note, not a feature checklist contest.

## What each product optimizes for

| | Agentic SWE | Ruflo (formerly Claude Flow) |
|---|---|---|
| Primary job | Take one software task from feasibility to a **reviewable PR** with a human merge gate | Give coding agents a **standing multi-agent runtime** (memory, swarms, plugins, federation) |
| Proof artifact | `/receipt` computed from `.worklogs/` (phases, costs, gates) | Install witness (`ruflo verify`), federation audit trails |
| Learning axis | **Muscle memory** — fingerprint-scoped L0/L1 procedure replay before spending frontier tokens | Vector memory / SONA-style pattern learning across sessions |

## Where Agentic SWE should win

- Explicit state machine and track selection (lean / standard / rigorous)
- Cost-attributed decisions and a shareable receipt
- Required `approval-wait` before `completed`
- Multi-editor host install (Claude Code, Cursor, Codex, OpenCode, and others)
- Procedural replay that reduces tokens on repeated work

## Where Ruflo wins (and we do not copy)

- Large plugin marketplace and MCP tool surface
- Swarm topologies and cross-machine federation
- Community scale and brand awareness

Do **not** claim “more agents than Ruflo” as a win condition. Specialist markdown count is not the same product as a swarm runtime.

## Co-install warning

Both products write Claude Code hooks and `CLAUDE.md`. Running `agentic-swe setup` and `npx ruflo init` in the same repository will conflict. Pick one orchestration layer per repo.

## Design reference

Gap-closure roadmap: [`docs/superpowers/specs/2026-10-03-ruflo-gap-closure-design.md`](superpowers/specs/2026-10-03-ruflo-gap-closure-design.md).
