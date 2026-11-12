'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  checkEvalAttestation,
  isShadowTrusted,
  sha256Text,
} = require('./skill-integrity.cjs');

// lint_passed: only a catalog lint passed, so the skill is manual-only for autonomous use.
const BLOCKED_STATUSES = new Set(['unevaluated', 'deprecated', 'lint_passed']);

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
 * Derive an external attestation from a golden eval_ref corpus (not self-declared status).
 * @param {string} pluginRoot
 * @param {string} evalRef
 * @returns {object|null}
 */
function deriveAttestationFromEvalRef(pluginRoot, evalRef) {
  const ref = String(evalRef || '').trim();
  if (!ref || ref.includes('..')) return null;
  const scoring = path.join(path.resolve(pluginRoot), ref, 'scoring.json');
  if (!fs.existsSync(scoring)) return null;
  const body = fs.readFileSync(scoring, 'utf8');
  const st = fs.statSync(scoring);
  return {
    suite_id: ref,
    result_digest: sha256Text(body),
    timestamp: new Date(st.mtimeMs).toISOString(),
  };
}

function loadSidecarAttestation(skillDir) {
  const file = path.join(skillDir, 'eval-attestation.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Fail-closed gate: block autonomous use of unevaluated / unattested / untrusted-shadow skills.
 * @param {{
 *   pluginRoot: string,
 *   projectRoot?: string,
 *   skillName: string,
 *   autonomous?: boolean,
 *   attestation?: object,
 * }} opts
 * @returns {{
 *   allowed: boolean,
 *   reason: string|null,
 *   eval_status: string|null,
 *   shadow?: string|null,
 *   attestation?: string|null,
 * }}
 */
function checkSkillEvalGate(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
  const skillName = String(opts.skillName || '').trim();
  const autonomous = opts.autonomous !== false;
  if (!skillName) {
    return { allowed: true, reason: null, eval_status: null, shadow: null, attestation: null };
  }

  const packPath = path.join(pluginRoot, 'skills', skillName, 'SKILL.md');
  const projectPath = projectRoot
    ? path.join(projectRoot, '.agentic-swe', 'skills', skillName, 'SKILL.md')
    : null;
  const packExists = fs.existsSync(packPath);
  const projectExists = !!(projectPath && fs.existsSync(projectPath));

  let skillPath = packPath;
  let origin = 'pack';
  let shadow = null;

  if (projectExists && packExists) {
    // SEC-006: no implicit shadowing for autonomous use.
    if (autonomous) {
      if (!isShadowTrusted(projectRoot, skillName)) {
        return {
          allowed: false,
          reason: `skill "${skillName}" project shadow of pack skill blocked without trust entry (SEC-006)`,
          eval_status: null,
          shadow: 'implicit',
          attestation: null,
        };
      }
      skillPath = projectPath;
      origin = 'project';
      shadow = 'explicit';
    } else {
      skillPath = projectPath;
      origin = 'project';
      shadow = 'implicit';
    }
  } else if (projectExists) {
    skillPath = projectPath;
    origin = 'project';
  } else if (!packExists) {
    if (autonomous) {
      return {
        allowed: false,
        reason: `skill "${skillName}" is unknown; autonomous use blocked (fail-closed)`,
        eval_status: 'unevaluated',
        shadow: null,
        attestation: null,
      };
    }
    return { allowed: true, reason: 'unknown skill (manual)', eval_status: null, shadow: null, attestation: null };
  }

  const raw = fs.readFileSync(skillPath, 'utf8');
  if (!raw.startsWith('---\n')) {
    return { allowed: false, reason: 'invalid skill frontmatter', eval_status: null, shadow, attestation: null };
  }
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) {
    return { allowed: false, reason: 'invalid skill frontmatter', eval_status: null, shadow, attestation: null };
  }
  const block = raw.slice(4, end);
  const meta = parseSkillMetadata(block);
  const status = meta.eval_status || 'unevaluated';
  if (autonomous && BLOCKED_STATUSES.has(status)) {
    return {
      allowed: false,
      reason: `skill "${skillName}" has eval_status=${status}; autonomous use blocked (fail-closed)`,
      eval_status: status,
      shadow,
      attestation: null,
    };
  }

  if (autonomous && status === 'evaluated') {
    const skillDir = path.dirname(skillPath);
    const candidate =
      opts.attestation ||
      loadSidecarAttestation(skillDir) ||
      (meta.eval_ref ? deriveAttestationFromEvalRef(pluginRoot, meta.eval_ref) : null);
    // Self-declared eval_status alone (no external digest) → deny.
    const att = checkEvalAttestation(candidate);
    if (!att.ok) {
      return {
        allowed: false,
        reason: `skill "${skillName}" eval_status=evaluated lacks external eval attestation (${att.code})`,
        eval_status: status,
        shadow,
        attestation: att.code,
      };
    }
    return {
      allowed: true,
      reason: null,
      eval_status: status,
      shadow,
      attestation: 'external',
      origin,
    };
  }

  return { allowed: true, reason: null, eval_status: status, shadow, attestation: null, origin };
}

module.exports = {
  checkSkillEvalGate,
  parseSkillMetadata,
  BLOCKED_STATUSES,
  deriveAttestationFromEvalRef,
  loadSidecarAttestation,
};
