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
import { spawnSync } from "node:child_process";
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

function runLifecycle() {
  if (process.env.AGENTIC_SWE_HOOK_LIFECYCLE === "0") return "";
  const script = join(repoRoot, "scripts/lib/hooks/lifecycle.cjs");
  const result = spawnSync(
    process.execPath,
    [script, "maintain", "--project-root", process.cwd(), "--plugin-root", repoRoot, "--json"],
    { encoding: "utf8", timeout: 20000 },
  );
  if (result.status !== 0) {
    return "\n\n## Hook failures\n\n- OpenCode lifecycle failed to complete.";
  }
  try {
    const payload = JSON.parse(result.stdout || "{}");
    return payload.notice ? `\n\n${payload.notice}` : "";
  } catch {
    return "";
  }
}

export const experimental = {
  chat: {
    messages: {
      transform(messages) {
        const policy = loadPolicy();
        const notice = runLifecycle();
        const systemMsg = {
          role: "system",
          content: [
            "You are the Hypervisor for the agentic-swe pipeline.",
            "Follow the policy below for state management, transitions, and artifact requirements.",
            "Pipeline files resolve from the plugin root (${CLAUDE_PLUGIN_ROOT}); per-work state lives in .worklogs/<id>/ in the user project.",
            "Memory indexing, reflection refresh, and procedure hygiene run automatically. npm memory commands are bootstrap, diagnostics, and recovery only.",
            "",
            policy,
            notice,
          ].join("\n"),
        };
        return [systemMsg, ...messages];
      },
    },
  },
};
