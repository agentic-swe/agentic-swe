# Repo knowledge (optional copy-paste stubs)

Use these to give the pipeline **org- and repo-specific context** without changing the npm package. The **feasibility** phase reads them when present.

## `AGENTS.md` (repository root)

Many Claude Code and agent setups use a root-level `AGENTS.md` for conventions, commands, and boundaries. Create or extend it with:

- Stack and major dependencies
- How to run tests, lint, and build
- What must never be committed (secrets, env files)
- Review and branching expectations

## `docs/agentic-swe/` (optional)

Suggested files (any subset is fine):

| File | Purpose |
|------|---------|
| `CONVENTIONS.md` | Naming, modules, error handling, logging |
| `PITFALLS.md` | Known footguns in this codebase |
| `DECISIONS.md` | ADR-style links or short decision log |
| `PLAYBOOK.md` | Append-only lessons across runs (see `playbook-entry.md`) |

If the directory does not exist, skip; feasibility proceeds with `/repo-scan` and the task only.
