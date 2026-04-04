# Tooling expectations (Claude Code)

Use this when implementation or permissions touches **external systems**, **MCP**, or **non-repo** surfaces.

## When to use what

| Need | Prefer |
|------|--------|
| Read/search project files | Native file tools / IDE |
| Structured repo overview | `/repo-scan` (read-only) |
| Issue tracker, docs site, APIs | MCP servers configured for the workspace |
| Package install, build, test, lint | Terminal with repo’s documented commands |
| Git operations | Git / `gh` per `${CLAUDE_PLUGIN_ROOT}/agents/git-operations-agent.md` |

## MCP

- Prefer **curated** MCP tools over ad-hoc scraping.
- Do not assume an MCP server is available; check workspace config (e.g. `.mcp.json`, Cursor MCP settings). If missing, say so in artifacts and narrow scope or stop for human setup.

## Safety

- No production credentials in prompts or logs; use existing secret patterns from `/security-scan`.
- Destructive or wide-scope shell commands require explicit alignment with design and **permissions** phase.
- Read-only discovery first; mutate only after design approval (rigorous track) or within lean-track scope.

## Relation to `/repo-scan`

`/repo-scan` does **not** execute code or call network services—it only inspects files. Tooling that **runs** the app or hits APIs belongs in implementation/validation with evidence.
