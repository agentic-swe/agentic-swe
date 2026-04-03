/**
 * agentic-swe plugin for OpenCode
 *
 * Registers the .claude/ pipeline paths and injects orchestration policy
 * into chat context so OpenCode sessions follow the agentic-swe state machine.
 *
 * Tool mapping (agentic-swe → OpenCode):
 *   Agent tool        → opencode.agent.spawn
 *   Bash tool         → opencode.shell.exec
 *   Read/Write/Edit   → opencode.file.*
 *   TodoWrite         → opencode.tasks (if available)
 *   WebSearch/Fetch   → opencode.web.* (if available)
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function loadPolicy() {
  const policyPath = join(repoRoot, "CLAUDE.md");
  return readFileSync(policyPath, "utf-8");
}

export function config(cfg) {
  const claudeDir = join(repoRoot, ".claude");

  return {
    ...cfg,
    paths: {
      ...(cfg.paths || {}),
      commands: join(claudeDir, "commands"),
      phases: join(claudeDir, "phases"),
      agents: join(claudeDir, "agents"),
      templates: join(claudeDir, "templates"),
      references: join(claudeDir, "references"),
    },
  };
}

export const experimental = {
  chat: {
    messages: {
      transform(messages) {
        const policy = loadPolicy();
        const systemMsg = {
          role: "system",
          content: [
            "You are the orchestrator for the agentic-swe pipeline.",
            "Follow the policy below for state management, transitions, and artifact requirements.",
            "",
            policy,
          ].join("\n"),
        };
        return [systemMsg, ...messages];
      },
    },
  },
};
