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
 *
 * Policy: tool.execute.before spawns scripts/hook-pre-tool-policy.cjs --host opencode
 * and throws to block (https://opencode.ai/docs/plugins/).
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

/**
 * Map OpenCode tool ids to Claude-like names so baseline banned_commands / protected_paths apply.
 * @see https://opencode.ai/docs/plugins/ (tool.execute.before: input.tool, output.args)
 */
function canonicalToolName(tool) {
  const t = String(tool || "");
  if (t === "bash" || t === "shell") return "Bash";
  if (t === "write") return "Write";
  if (t === "edit") return "Edit";
  if (t === "read") return "Read";
  return t;
}

function runPolicyHook(input, output, directory) {
  if (process.env.AGENTIC_SWE_HOOK_POLICY === "0") return;
  const script = join(repoRoot, "scripts/hook-pre-tool-policy.cjs");
  const payload = {
    tool_name: canonicalToolName(input && input.tool),
    tool_input: output && output.args != null ? output.args : {},
    cwd: directory || process.cwd(),
  };
  const result = spawnSync(process.execPath, [script, "--host", "opencode"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10000,
    cwd: directory || process.cwd(),
  });
  if (result.status === 0) return;
  const reason = (result.stderr || result.stdout || "agentic-swe policy denied").trim();
  throw new Error(reason || "agentic-swe policy denied");
}

/** OpenCode loads every exported plugin function from this file. */
export const AgenticSwePolicy = async ({ directory }) => {
  return {
    "tool.execute.before": async (input, output) => {
      runPolicyHook(input, output, directory);
    },
  };
};

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
