'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BLOCKED_STATUSES = new Set(['unevaluated', 'deprecated']);

/**
 * Parse metadata map from SKILL.md frontmatter block.
 * @param {string} block
 * @returns {Record<string,string>}
 */
function parseSkillMetadata(block) {
  const meta = {};
  let inMeta = false;
  for (const line of block.split('\n')) {
    if (/^metadata:\s*$/.test(line.trim())) {
      inMeta = true;
      continue;
    }
    if (inMeta) {
      const m = /^\s+([a-zA-Z0-9_-]+):\s*"(.*)"\s*$/.exec(line);
      if (m) {
        meta[m[1]] = m[2].replace(/\\"/g, '"');
        continue;
      }
      if (/^\S/.test(line)) inMeta = false;
    }
  }
  return meta;
}

/**
 * Fail-closed gate: block autonomous use of unevaluated skills.
 * @param {{ pluginRoot: string, projectRoot?: string, skillName: string, autonomous?: boolean }} opts
 * @returns {{ allowed: boolean, reason: string|null, eval_status: string|null }}
 */
function checkSkillEvalGate(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
  const skillName = String(opts.skillName || '').trim();
  const autonomous = opts.autonomous !== false;
  if (!skillName) {
    return { allowed: true, reason: null, eval_status: null };
  }
  let skillPath = path.join(pluginRoot, 'skills', skillName, 'SKILL.md');
  if (projectRoot) {
    const projectPath = path.join(projectRoot, '.agentic-swe', 'skills', skillName, 'SKILL.md');
    if (fs.existsSync(projectPath)) skillPath = projectPath;
  }
  if (!fs.existsSync(skillPath)) {
    if (autonomous) {
      return {
        allowed: false,
        reason: `skill "${skillName}" is unknown; autonomous use blocked (fail-closed)`,
        eval_status: 'unevaluated',
      };
    }
    return { allowed: true, reason: 'unknown skill (manual)', eval_status: null };
  }
  const raw = fs.readFileSync(skillPath, 'utf8');
  if (!raw.startsWith('---\n')) {
    return { allowed: false, reason: 'invalid skill frontmatter', eval_status: null };
  }
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) {
    return { allowed: false, reason: 'invalid skill frontmatter', eval_status: null };
  }
  const block = raw.slice(4, end);
  const meta = parseSkillMetadata(block);
  const status = meta.eval_status || 'unevaluated';
  if (autonomous && BLOCKED_STATUSES.has(status)) {
    return {
      allowed: false,
      reason: `skill "${skillName}" has eval_status=${status}; autonomous use blocked (fail-closed)`,
      eval_status: status,
    };
  }
  return { allowed: true, reason: null, eval_status: status };
}

module.exports = {
  checkSkillEvalGate,
  parseSkillMetadata,
  BLOCKED_STATUSES,
};
