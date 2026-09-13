'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { translateActionsForAllHosts } = require('../runtime/hosts.cjs');

function primaryVerifyCommand(pack) {
  return pack.verification_commands?.[0]?.command || pack.muscle_memory?.[0]?.command || null;
}

function typedActionsFromPack(pack) {
  const actions = [];
  const seen = new Set();
  for (const f of pack.scope_files || []) {
    const p = f && f.path;
    if (!p || p === 'state.json' || seen.has(p)) continue;
    seen.add(p);
    actions.push({ type: 'READ_FILE', path: p });
    if (actions.length >= 6) break;
  }
  const verify = primaryVerifyCommand(pack);
  if (verify) actions.push({ type: 'RUN', command: verify });
  return actions;
}

/**
 * Compact markdown + host tool maps so any frontier model can replay muscle memory.
 * @param {object} pack
 * @returns {{ markdown: string, actions: object[], byHost: Record<string, object[]> }}
 */
function delegateBriefFromPack(pack) {
  const actions = typedActionsFromPack(pack);
  const byHost = translateActionsForAllHosts(actions);
  const lines = [
    '### Context pack (delegate brief)',
    '',
    `- **Scope:** ${pack.scope || ''}`,
    `- **skip_llm:** ${(pack.constraints || []).some((c) => /skip_llm_exploration/.test(c)) ? 'yes' : 'no'}`,
    '',
  ];
  if (pack.muscle_memory?.length) {
    lines.push('**Muscle memory (replay, do not re-derive):**');
    for (const m of pack.muscle_memory.slice(0, 6)) {
      lines.push(`- **${m.tier}** \`${m.command}\``);
    }
    lines.push('');
  }
  lines.push('**Host tool names for the same typed actions:**');
  for (const [host, mapped] of Object.entries(byHost)) {
    const names = mapped.map((t) => t.tool).slice(0, 8).join(', ');
    lines.push(`- \`${host}\`: ${names}`);
  }
  lines.push('');
  return { markdown: lines.join('\n'), actions, byHost };
}

function loadWorkContextPack(workDir) {
  const p = path.join(workDir, 'context-pack.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Execute pack reads + primary verify with zero LLM (L0 path).
 * @param {{ pack?: object, workDir?: string, projectRoot: string }} opts
 */
function replayContextPack(opts) {
  const { executeAction } = require('../descent/replay.cjs');
  const projectRoot = path.resolve(opts.projectRoot);
  const pack = opts.pack || (opts.workDir ? loadWorkContextPack(opts.workDir) : null);
  if (!pack) return { ok: false, reason: 'no context-pack.json' };
  const actions = typedActionsFromPack(pack);
  const steps = [];
  for (const a of actions) {
    const r = executeAction(a, projectRoot);
    steps.push({ action: a, ok: r.ok, error: r.error, output: String(r.output || '').slice(0, 4000) });
    if (!r.ok) {
      return { ok: false, escalate: true, reason: r.error || 'action failed', steps };
    }
  }
  return { ok: true, escalate: false, steps, verify: primaryVerifyCommand(pack) };
}

function writeDescentReplayArtifact(workDir, replay) {
  const lines = [
    '# Descent replay',
    '',
    replay.ok ? '**Result:** PASS (zero-LLM pack replay)' : `**Result:** FAIL — ${replay.reason || 'escalate'}`,
    '',
  ];
  for (const s of replay.steps || []) {
    const label = s.action.type === 'RUN' ? s.action.command : s.action.path;
    lines.push(`## ${s.action.type} \`${label}\``);
    lines.push('');
    lines.push(s.ok ? 'ok' : `error: ${s.error}`);
    if (s.output) {
      lines.push('');
      lines.push('```');
      lines.push(String(s.output).slice(0, 2000));
      lines.push('```');
    }
    lines.push('');
  }
  const out = path.join(workDir, 'descent-replay.md');
  fs.writeFileSync(out, lines.join('\n'));
  return out;
}

module.exports = {
  typedActionsFromPack,
  delegateBriefFromPack,
  loadWorkContextPack,
  primaryVerifyCommand,
  replayContextPack,
  writeDescentReplayArtifact,
};
