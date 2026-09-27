# MCP and rules fallback

Use this tier for Cline, Roo Code, Continue, Junie/JetBrains, Zed, and other hosts that can read `AGENTS.md` or connect to an MCP server but do not expose a complete session/transcript hook API.

1. Run `agentic-swe setup --host vscode` when the editor is VS Code-compatible and you want automatic changed-file memory maintenance.
2. Keep the generated root `AGENTS.md` as the host's project rule. Link or copy it into a host-specific rules directory only when that host does not read `AGENTS.md`.
3. Add [`agentic-swe-memory.mcp.json`](agentic-swe-memory.mcp.json) to the host's MCP configuration using that host's documented merge flow.

The server exposes:

- `agentic_swe_memory_refresh` — incremental index, reflection refresh, and procedure hygiene.
- `agentic_swe_memory_prime` — bounded task memory.
- `agentic_swe_memory_status` — database and durable hook-receipt diagnostics.

MCP is an explicit fallback: a host or agent must call these tools. It does not imply transcript access, automatic Stop capture, or evolution. Never replace an existing MCP configuration wholesale; merge the `agentic-swe-memory` entry.
