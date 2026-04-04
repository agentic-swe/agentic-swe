/**
 * agentic-swe plugin for OpenCode
 *
 * Registers plugin-root pipeline paths (commands, phases, agents, templates, references)
 * and injects orchestration policy into chat context.
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
  return {
    ...cfg,
    paths: {
      ...(cfg.paths || {}),
      commands: join(repoRoot, "commands"),
      phases: join(repoRoot, "phases"),
      agents: join(repoRoot, "agents"),
      templates: join(repoRoot, "templates"),
      references: join(repoRoot, "references"),
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
            "You are the Hypervisor for the agentic-swe pipeline.",
            "Follow the policy below for state management, transitions, and artifact requirements.",
            "Pipeline files resolve from the plugin root (${CLAUDE_PLUGIN_ROOT}); per-work state lives in .worklogs/<id>/ in the user project.",
            "",
            policy,
          ].join("\n"),
        };
        return [systemMsg, ...messages];
      },
    },
  },
};
