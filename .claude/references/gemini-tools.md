# Gemini CLI Tool Mapping

Maps agentic-swe tool and command concepts to Gemini CLI equivalents.

## Agent Delegation

| agentic-swe | Gemini CLI |
|-------------|------------|
| Agent tool (spawn subagent) | Gemini agent dispatch (`@agent`) |
| Background agent | Gemini parallel task execution |
| Agent-to-agent delegation | Chain Gemini agent calls with context passing |

## File Operations

| agentic-swe | Gemini CLI |
|-------------|------------|
| Read file | `read_file` / `view_file` |
| Write file | `write_file` / `create_file` |
| Edit file (str_replace) | `edit_file` / `replace_in_file` |
| Glob (find files) | `list_files` / `find_files` |
| Grep (search content) | `search_files` / `grep` |

## Shell and Git

| agentic-swe | Gemini CLI |
|-------------|------------|
| Bash tool | `run_command` / shell execution |
| Git operations | `run_command` with git, or Gemini git tools |
| TodoWrite | Task tracking via structured output |

## Web and Search

| agentic-swe | Gemini CLI |
|-------------|------------|
| WebSearch | Gemini Search grounding / `google_search` |
| WebFetch | `fetch_url` (if available) |

## Slash Commands

agentic-swe commands live in `.claude/commands/*.md` as markdown prompts.
Gemini CLI does not natively parse these, but the orchestrator can read
and follow them manually:

```
Read .claude/commands/work.md → follow instructions within
```

## Phase Prompts

Phase prompts in `.claude/phases/*.md` define each pipeline stage.
The orchestrator reads the relevant phase file and executes its instructions:

```
Read .claude/phases/feasibility.md → execute feasibility phase
Read .claude/phases/implementation.md → execute implementation phase
```

## Specialist Agents

135+ subagent prompts live under `.claude/agents/subagents/`. Each file
contains a system prompt with role, tools, and model recommendations.
Invoke via Gemini agent dispatch with the prompt content as context.
