'use strict';

/**
 * AE-033b / PD-45: permission-diff gate at skill publish.
 * Any new permission vs the prior published version → PERMISSIONS_EXPANDED (auto-reject).
 * No override flag invented here (§15 / PD-33); PD-45 chose auto-reject.
 * Layer: skills (service).
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {unknown} perms
 * @returns {string[]}
 */
function normalizePermissions(perms) {
  if (!Array.isArray(perms)) return [];
  return [
    ...new Set(
      perms
        .map((p) => String(p == null ? '' : p).trim())
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * Diff baseline → candidate permission sets.
 * @param {unknown} baseline
 * @param {unknown} candidate
 * @returns {{
 *   baseline: string[],
 *   candidate: string[],
 *   expanded: string[],
 *   removed: string[],
 *   is_strict_superset: boolean
 * }}
 */
function diffPermissions(baseline, candidate) {
  const base = normalizePermissions(baseline);
  const cand = normalizePermissions(candidate);
  const baseSet = new Set(base);
  const candSet = new Set(cand);
  const expanded = cand.filter((p) => !baseSet.has(p));
  const removed = base.filter((p) => !candSet.has(p));
  const is_strict_superset = expanded.length > 0 && removed.length === 0;
  return {
    baseline: base,
    candidate: cand,
    expanded,
    removed,
    is_strict_superset,
  };
}

/**
 * True when candidate adds any permission not present on baseline (privilege expand).
 * PD-45 / acceptance: added `fs.write` without approval → fail.
 * @param {unknown} baseline
 * @param {unknown} candidate
 */
function hasPermissionExpansion(baseline, candidate) {
  return diffPermissions(baseline, candidate).expanded.length > 0;
}

/**
 * Load prior published permissions for a skill from the registry index.
 * Prefers `compareFromVersion` when set; else highest other semver already indexed.
 * @param {{
 *   registryRoot: string,
 *   skill: string,
 *   excludeVersion?: string,
 *   compareFromVersion?: string,
 *   readIndex?: Function
 * }} opts
 * @returns {{ ok: true, permissions: string[]|null, fromVersion: string|null } | { ok: false, code: string, errors: string[] }}
 */
function loadPriorPermissions(opts) {
  const registryRoot = path.resolve(opts.registryRoot || '');
  const skill = String(opts.skill || '').trim();
  if (!registryRoot || !skill) {
    return { ok: false, code: 'PRIOR_LOOKUP_INVALID', errors: ['registryRoot and skill required'] };
  }

  const indexPath = path.join(registryRoot, 'skills-index.json');
  if (!fs.existsSync(indexPath)) {
    return { ok: true, permissions: null, fromVersion: null };
  }

  let index;
  try {
    if (typeof opts.readIndex === 'function') {
      index = opts.readIndex(indexPath);
    } else {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.skills) {
        const err = new Error('skills index schema invalid');
        err.code = 'INDEX_INVALID';
        throw err;
      }
      index = parsed;
    }
  } catch (err) {
    return {
      ok: false,
      code: err.code || 'INDEX_INVALID',
      errors: [err.message || 'skills index unreadable'],
    };
  }

  const entry = index && index.skills && index.skills[skill];
  if (!entry || !Array.isArray(entry.versions) || !entry.versions.length) {
    return { ok: true, permissions: null, fromVersion: null };
  }

  const exclude = opts.excludeVersion != null ? String(opts.excludeVersion) : '';
  const want = opts.compareFromVersion != null ? String(opts.compareFromVersion).trim() : '';

  if (want) {
    const hit = entry.versions.find(
      (v) => v && v.manifest && String(v.manifest.version) === want
    );
    if (!hit) {
      return {
        ok: false,
        code: 'BASELINE_VERSION_MISSING',
        errors: [`prior version ${want} not found for ${skill}`],
      };
    }
    return {
      ok: true,
      permissions: normalizePermissions(hit.manifest.permissions),
      fromVersion: want,
    };
  }

  const others = entry.versions
    .filter((v) => v && v.manifest && String(v.manifest.version) !== exclude)
    .sort((a, b) =>
      String(b.manifest.version).localeCompare(String(a.manifest.version), undefined, {
        numeric: true,
      })
    );

  if (!others.length) {
    return { ok: true, permissions: null, fromVersion: null };
  }

  const chosen = others[0];
  return {
    ok: true,
    permissions: normalizePermissions(chosen.manifest.permissions),
    fromVersion: String(chosen.manifest.version),
  };
}

/**
 * Publish gate: reject when candidate permissions expand over the prior version (PD-45).
 * @param {object} opts publishSkill-compatible opts
 * @returns {{ ok: true, diff?: object, fromVersion?: string|null } | { ok: false, code: string, errors: string[], expanded?: string[], diff?: object }}
 */
function assertPublishPermissionsGate(opts) {
  const sourceDir = opts.sourceDir ? path.resolve(opts.sourceDir) : null;
  if (!sourceDir) {
    return { ok: true };
  }

  let candidatePerms;
  if (Array.isArray(opts.candidatePermissions)) {
    candidatePerms = normalizePermissions(opts.candidatePermissions);
  } else {
    const mPath = path.join(sourceDir, 'manifest.json');
    if (!fs.existsSync(mPath)) {
      return { ok: true };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      candidatePerms = normalizePermissions(parsed && parsed.permissions);
    } catch {
      return {
        ok: false,
        code: 'MANIFEST_INVALID',
        errors: ['candidate manifest.json unreadable for permission diff'],
      };
    }
  }

  let baselinePerms = null;
  let fromVersion = null;

  if (Array.isArray(opts.baselinePermissions)) {
    baselinePerms = normalizePermissions(opts.baselinePermissions);
    fromVersion = opts.compareFromVersion || null;
  } else if (opts.registryRoot) {
    const identity = (() => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
        return {
          name: String((parsed && parsed.name) || '').trim(),
          version: String((parsed && parsed.version) || '').trim(),
        };
      } catch {
        return { name: '', version: '' };
      }
    })();
    const skill = opts.compareSkill || identity.name;
    if (!skill) {
      return { ok: true };
    }
    const prior = loadPriorPermissions({
      registryRoot: opts.registryRoot,
      skill,
      excludeVersion: identity.version,
      compareFromVersion: opts.compareFromVersion,
    });
    if (!prior.ok) {
      return {
        ok: false,
        code: prior.code || 'PRIOR_LOOKUP_FAILED',
        errors: prior.errors || ['prior permission lookup failed'],
      };
    }
    baselinePerms = prior.permissions;
    fromVersion = prior.fromVersion;
  }

  // First publish / no baseline → nothing to expand over.
  if (baselinePerms == null) {
    return { ok: true, fromVersion: null };
  }

  const diff = diffPermissions(baselinePerms, candidatePerms);
  if (diff.expanded.length > 0) {
    return {
      ok: false,
      code: 'PERMISSIONS_EXPANDED',
      errors: [
        `permission expansion vs prior ${fromVersion || 'version'}: ${diff.expanded.join(', ')}`,
      ],
      expanded: diff.expanded,
      diff,
      fromVersion,
    };
  }

  return { ok: true, diff, fromVersion };
}

module.exports = {
  normalizePermissions,
  diffPermissions,
  hasPermissionExpansion,
  loadPriorPermissions,
  assertPublishPermissionsGate,
};
